"""Nook's root-owned, resumable Docker/Tailscale installer. No DSH home is used."""
import argparse
import base64
import fcntl
import hashlib
import io
import ipaddress
import json
import os
from pathlib import Path
import platform
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

VERSION = '__ASSISTANT_VERSION__'
ARCHIVE_SHA256 = '__DEPLOYMENT_SHA256__'
RELEASE_ROOT = 'https://github.com/voosil/dsh-nook/releases/download/'
ROOT = Path('/opt/nook-sync-assistant')
VOLUME = 'nook-sync-assistant-data'
PROJECT = 'nook-sync-assistant'
UNIT = Path('/etc/systemd/system/nook-sync-assistant.service')
LAUNCHER = Path('/usr/local/bin/nook-sync')
IMAGE = 'ghcr.io/voosil/nook-sync@sha256:67ee7d0fa390d3452a06b8242173d3bbdbe139b87e9b8a97f74935202bfffaa8'


def run(args, capture=True, timeout=600, **kwargs):
    try:
        result = subprocess.run(args, text=True, capture_output=capture, timeout=timeout, **kwargs)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f'{args[0]} 超时；可重新运行继续。') from None
    if result.returncode:
        # Keep package-manager details recoverable without printing potential credentials.
        with tempfile.NamedTemporaryFile(mode='w', prefix='nook-sync-error-', suffix='.log', delete=False) as log:
            log.write((result.stdout or '') + '\n' + (result.stderr or ''))
            diagnostic = log.name
        raise RuntimeError(f'{args[0]} 执行失败（{result.returncode}）；详细原因保存在仅管理员可读的 {diagnostic}')
    return result.stdout if capture else ''


def atomic(path, data, mode=0o600):
    if path.is_symlink():
        raise RuntimeError(f'拒绝写入符号链接：{path}')
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as file:
        temporary = Path(file.name)
        try:
            file.write(data.encode() if isinstance(data, str) else data)
            file.flush()
            os.fsync(file.fileno())
            os.fchmod(file.fileno(), mode)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def download(url, limit=8_000_000):
    with urllib.request.urlopen(url, timeout=45) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise RuntimeError('下载文件超过限制。')
    return data


def checked(data, digest):
    if not re.fullmatch(r'[a-f0-9]{64}', digest) or hashlib.sha256(data).hexdigest() != digest:
        raise RuntimeError('下载校验失败，未执行或安装该文件；请重试。')
    return data


def system_info():
    values = {}
    for line in Path('/etc/os-release').read_text().splitlines():
        if '=' in line:
            key, value = line.split('=', 1)
            values[key] = value.strip('"')
    distro, version = values.get('ID'), values.get('VERSION_ID', '')
    supported = ((distro == 'ubuntu' and version in ('22.04', '24.04', '26.04')) or
                 (distro == 'debian' and version in ('12', '13')))
    arch = {'x86_64': 'amd64', 'aarch64': 'arm64'}.get(platform.machine())
    if not supported or not arch or not Path('/run/systemd/system').is_dir():
        raise RuntimeError('支持使用 systemd 的 Ubuntu 22.04/24.04/26.04、Debian 12/13，amd64 或 arm64。')
    codename = values.get('VERSION_CODENAME', '')
    if not re.fullmatch('[a-z]+', codename):
        raise RuntimeError('无法识别发行版软件源。')
    return distro, codename, arch


def apt(*packages):
    run(['apt-get', 'update'])
    run(['apt-get', 'install', '-y', *packages], env={**os.environ, 'DEBIAN_FRONTEND': 'noninteractive'})


def dependencies(info):
    distro, codename, arch = info
    if not shutil.which('docker'):
        print('→ 正在从官方软件源安装 Docker……', flush=True)
        conflicts = subprocess.run(['dpkg-query', '-W', '-f=${db:Status-Status}\n',
                                    'docker.io', 'podman-docker', 'containerd', 'runc'],
                                   capture_output=True, text=True).stdout
        if 'installed' in conflicts:
            raise RuntimeError('检测到已有容器运行时；请先由管理员配置 Docker 和 Compose，助手不会卸载它。')
        apt('ca-certificates')
        key = Path('/etc/apt/keyrings/nook-docker.asc')
        key.parent.mkdir(parents=True, exist_ok=True)
        atomic(key, download(f'https://download.docker.com/linux/{distro}/gpg'), 0o644)
        atomic(Path('/etc/apt/sources.list.d/nook-docker.list'),
               f'deb [arch={arch} signed-by={key}] https://download.docker.com/linux/{distro} {codename} stable\n', 0o644)
        apt('docker-ce', 'docker-ce-cli', 'containerd.io', 'docker-buildx-plugin', 'docker-compose-plugin')
    # Never reconfigure or restart an existing daemon.
    run(['systemctl', 'start', 'docker'])
    run(['docker', 'info'])
    try:
        run(['docker', 'compose', 'version'])
    except RuntimeError:
        # Reuse the administrator's existing repository; never switch an installed engine's vendor.
        available = run(['apt-cache', 'policy', 'docker-compose-plugin'])
        if not re.search(r'Candidate:\s+(?!\(none\))\S+', available):
            raise RuntimeError('已有 Docker 缺少 Compose 插件，请先从其对应软件源安装插件。') from None
        apt('docker-compose-plugin')
        run(['docker', 'compose', 'version'])
    run(['systemctl', 'enable', 'docker'])
    print('✓ Docker 已就绪', flush=True)
    if not shutil.which('tailscale'):
        print('→ 正在从官方软件源安装 Tailscale……', flush=True)
        apt('ca-certificates')
        key = Path('/usr/share/keyrings/nook-tailscale.gpg')
        atomic(key, download(f'https://pkgs.tailscale.com/stable/{distro}/{codename}.noarmor.gpg'), 0o644)
        atomic(Path('/etc/apt/sources.list.d/nook-tailscale.list'),
               f'deb [signed-by={key}] https://pkgs.tailscale.com/stable/{distro} {codename} main\n', 0o644)
        apt('tailscale')
    run(['systemctl', 'enable', '--now', 'tailscaled'])


def tail_address(login=False):
    status = json.loads(run(['tailscale', 'status', '--json']))
    if status.get('BackendState') != 'Running':
        if not login:
            raise RuntimeError('Tailscale 尚未连接；运行 sudo nook-sync repair 并完成登录。')
        print('→ 请按下面的链接完成 Tailscale 登录。', flush=True)
        run(['tailscale', 'up', '--timeout=10m'], capture=False, timeout=660)
    values = run(['tailscale', 'ip', '-4']).strip().splitlines()
    if len(values) != 1 or ipaddress.ip_address(values[0]) not in ipaddress.ip_network('100.64.0.0/10'):
        raise RuntimeError('无法获取唯一的 Tailscale IPv4 地址。')
    return values[0]


def choose_port(host):
    for port in range(8443, 8464):
        with socket.socket() as sock:
            try:
                sock.bind((host, port))
                return port
            except OSError:
                pass
    raise RuntimeError('8443–8463 端口均不可用；请检查端口占用后重试。')


def save(state):
    atomic(ROOT / 'state.json', json.dumps(state))


def read_state():
    path = ROOT / 'state.json'
    if path.is_symlink():
        raise RuntimeError('部署回执不能为符号链接。')
    state = json.loads(path.read_text())
    if (state.get('format') != 'nook-sync-assistant' or
            not re.fullmatch(r'\d+\.\d+\.\d+', state.get('version', '')) or
            ipaddress.ip_address(state['host']) not in ipaddress.ip_network('100.64.0.0/10') or
            not isinstance(state['port'], int) or not 1024 <= state['port'] <= 65535):
        raise RuntimeError('部署回执无效；已保留数据。')
    return state


def compose(state, *args, **kwargs):
    directory = ROOT / 'releases' / state['version']
    return run(['docker', 'compose', '-p', PROJECT, '--env-file', str(ROOT / '.env'),
                '-f', str(directory / 'compose.yaml'), '-f', str(ROOT / 'assistant.yaml'), *args], **kwargs)


def stage():
    print('→ 正在下载并校验固定版本部署包……', flush=True)
    data = checked(download(f'{RELEASE_ROOT}sync-assistant-v{VERSION}/nook-sync-assistant-{VERSION}.tar.gz'), ARCHIVE_SHA256)
    destination = ROOT / 'releases' / VERSION
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        members = archive.getmembers()
        if len({m.name for m in members}) != len(members):
            raise RuntimeError('部署包包含重复文件。')
        for member in members:
            if not member.isfile() or '/' in member.name or member.name in ('.', '..') or member.size > 2_000_000:
                raise RuntimeError('部署包包含不支持的文件。')
        for member in members:
            atomic(destination / member.name, archive.extractfile(member).read())
    return destination


def unit_text():
    return f'''[Unit]
Description=Nook Sync over Tailscale
Wants=network-online.target tailscaled.service docker.service
After=network-online.target tailscaled.service docker.service
StartLimitIntervalSec=0

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/python3 {ROOT}/assistant.py boot
ExecStop=/usr/bin/python3 {ROOT}/assistant.py stop
Restart=on-failure
RestartSec=15
TimeoutStartSec=300
TimeoutStopSec=90
UMask=0077

[Install]
WantedBy=multi-user.target
'''


def install(yes=False):
    info = system_info()
    existing = (ROOT / 'state.json').exists()
    if not yes:
        print('将在此服务器安装 Nook 同步服务，自动安装缺少的 Docker 和 Tailscale；已有数据保留。')
        if input('按回车开始，输入 q 退出：').strip():
            return
    if shutil.disk_usage(ROOT).free < 2 * 1024 ** 3:
        raise RuntimeError('可用磁盘空间不足 2 GB。')
    state = read_state() if existing else None
    if state and tuple(map(int, VERSION.split('.'))) < tuple(map(int, state['version'].split('.'))):
        raise RuntimeError('安装命令版本早于现有部署；请使用服务器上的 nook-sync 菜单。')
    if not existing:
        if any(p.name != '.lock' for p in ROOT.iterdir()):
            raise RuntimeError('安装目录非空且缺少部署回执，拒绝接管。')
        for path in (UNIT, LAUNCHER):
            if path.exists() or path.is_symlink():
                raise RuntimeError(f'{path} 已存在，拒绝覆盖。')
    dependencies(info)
    host = tail_address(login=True)
    print('✓ Tailscale 已连接', flush=True)
    if state and state['host'] != host:
        raise RuntimeError('Tailscale 地址与原部署不同。请恢复原设备身份；未修改目标或数据。')
    if not state:
        volumes = run(['docker', 'volume', 'ls', '--format', '{{.Name}}']).splitlines()
        containers = run(['docker', 'ps', '-a', '--filter', f'label=com.docker.compose.project={PROJECT}', '--format', '{{.ID}}']).strip()
        if VOLUME in volumes or containers:
            raise RuntimeError('已有同名数据卷但缺少部署回执，拒绝接管。')
        state = dict(format='nook-sync-assistant', version=VERSION, host=host, port=choose_port(host), complete=False)
        save(state)
    stage()
    # Pull before downtime; a failed download leaves the previous service running.
    print('→ 正在获取同步服务镜像……', flush=True)
    run(['docker', 'pull', IMAGE])
    if state['version'] != VERSION:
        backup(state)
        compose(state, 'stop', 'sync')
    previous = dict(state)
    previous_source = (ROOT / 'assistant.py').read_bytes() if (ROOT / 'assistant.py').exists() else None
    state['version'] = VERSION
    state['complete'] = False
    atomic(ROOT / '.env', f"NOOK_MODE=vpn\nNOOK_HOST={host}\nNOOK_BIND_IP={host}\nNOOK_PORT={state['port']}\n")
    # systemd owns boot ordering; Docker may restart a crashed container after it has started.
    atomic(ROOT / 'assistant.yaml', f'services:\n  sync:\n    restart: on-failure\nvolumes:\n  sync-data:\n    name: {VOLUME}\n')
    save(state)
    try:
        compose(state, 'up', '-d', '--wait', '--wait-timeout', '180')
        source = Path(__file__).read_bytes()
        atomic(ROOT / 'assistant.py', source)
        atomic(LAUNCHER, f'#!/bin/sh\nif [ "$(id -u)" -ne 0 ]; then exec sudo /usr/bin/python3 {ROOT}/assistant.py "$@"; fi\nexec /usr/bin/python3 {ROOT}/assistant.py "$@"\n', 0o755)
        atomic(UNIT, unit_text(), 0o644)
        run(['systemctl', 'daemon-reload'])
        run(['systemctl', 'enable', 'nook-sync-assistant.service'])
        state['complete'] = True
        save(state)
    except Exception:
        if previous['version'] != VERSION:
            save(previous)
            if previous_source:
                atomic(ROOT / 'assistant.py', previous_source)
            # Restore only program selection, never overwrite data from an archive.
            compose(previous, 'up', '-d', '--wait', '--wait-timeout', '180')
        raise
    print('✓ 同步服务、HTTPS、认证和并发写入检查通过\n✓ 开机启动已配置', flush=True)
    print('服务器已就绪。各台电脑也需登录同一 Tailscale 网络；在 Nook 粘贴以下连接信息并验证。')
    show_connection(state)
    return True


def show_connection(state):
    source = compose(state, 'exec', '-T', 'sync', 'python3', 'container.py', 'export')
    value = json.loads(source)
    if value.get('format') != 'nook-sync-connection' or value.get('version') != 1:
        raise RuntimeError('服务导出了不支持的连接格式。')
    encoded = base64.b64encode(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()).decode()
    print('\n连接信息含密码，仅粘贴到自己的 Nook：\nNOOK-SYNC-1:' + encoded + '\n')


MANIFEST = """import hashlib,json,pathlib
r=pathlib.Path('/var/lib/nook-sync')
out={}
for p in sorted(r.rglob('*')):
 if p.is_symlink(): raise RuntimeError('symlink in backup')
 if p.is_file():
  h=hashlib.sha256()
  with p.open('rb') as f:
   for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
  out[str(p.relative_to(r))]=h.hexdigest()
print(json.dumps(out))
"""


def verify_backup(path, expected):
    actual = {}
    with tarfile.open(path, 'r:gz') as archive:
        for member in archive:
            name = member.name.removeprefix('./')
            if member.isdir():
                continue
            if not member.isfile() or name.startswith('/') or '..' in Path(name).parts or name in actual:
                raise RuntimeError('备份包含不支持的条目。')
            digest = hashlib.sha256()
            with archive.extractfile(member) as file:
                for chunk in iter(lambda: file.read(1024 * 1024), b''):
                    digest.update(chunk)
            actual[name] = digest.hexdigest()
    if actual != expected:
        raise RuntimeError('备份文件与源数据不一致，已中止后续操作。')


def backup(state):
    directory = ROOT / 'backups' / (time.strftime('%Y%m%d-%H%M%S') + '-' + os.urandom(4).hex())
    directory.mkdir(parents=True, mode=0o700)
    compose(state, 'stop', 'sync')
    try:
        # A read-only mount prevents backup helpers from modifying the business volume.
        helper = ['docker', 'run', '--rm', '-v', f'{VOLUME}:/var/lib/nook-sync:ro', '--entrypoint']
        expected = json.loads(run([*helper, 'python3', IMAGE, '-c', MANIFEST]))
        archive = directory / 'nook-sync.tar.gz'
        with archive.open('xb') as file:
            result = subprocess.run([*helper, 'tar', IMAGE, '-C', '/var/lib/nook-sync', '-czf', '-', '.'],
                                    stdout=file, stderr=subprocess.PIPE, timeout=3600)
            file.flush()
            os.fsync(file.fileno())
        if result.returncode:
            raise RuntimeError('数据归档失败。')
        verify_backup(archive, expected)
        atomic(directory / 'manifest.json', json.dumps(expected))
        atomic(directory / 'state.json', json.dumps(state))
        atomic(directory / 'assistant.py', (ROOT / 'assistant.py').read_bytes())
        configuration = directory / 'configuration'
        configuration.mkdir(mode=0o700)
        for name, source in [('compose.yaml', ROOT / 'releases' / state['version'] / 'compose.yaml'),
                             ('assistant.yaml', ROOT / 'assistant.yaml'), ('.env', ROOT / '.env'),
                             ('nook-sync-assistant.service', UNIT), ('nook-sync', LAUNCHER)]:
            data = source.read_bytes()
            atomic(configuration / name, data)
            checked((configuration / name).read_bytes(), hashlib.sha256(data).hexdigest())
        print(f'✓ 备份及逐文件校验完成：{directory}')
    finally:
        compose(state, 'up', '-d', '--wait', '--wait-timeout', '180')
    return directory


def boot(state, login=False):
    host = tail_address(login=login)
    if host != state['host']:
        raise RuntimeError('Tailscale 地址已变化，保留原配置；请恢复原设备身份。')
    compose(state, 'up', '-d', '--wait', '--wait-timeout', '180')


def update():
    releases = json.loads(download('https://api.github.com/repos/voosil/dsh-nook/releases?per_page=100'))
    versions = [r['tag_name'].removeprefix('sync-assistant-v') for r in releases
                if not r.get('draft') and not r.get('prerelease') and
                re.fullmatch(r'sync-assistant-v\d+\.\d+\.\d+', r.get('tag_name', ''))]
    version = max(versions, key=lambda v: tuple(map(int, v.split('.'))), default=VERSION)
    if tuple(map(int, version.split('.'))) <= tuple(map(int, VERSION.split('.'))):
        print('已是最新稳定版。')
        return
    base = f'{RELEASE_ROOT}sync-assistant-v{version}/'
    sums = download(base + 'SHA256SUMS').decode().splitlines()
    matches = [line.split()[0] for line in sums if line.split()[1:] == ['install.sh']]
    if len(matches) != 1:
        raise RuntimeError('发布校验文件无效。')
    source = checked(download(base + 'install.sh'), matches[0])
    with tempfile.TemporaryDirectory(prefix='nook-update-') as temp:
        path = Path(temp) / 'install.sh'
        atomic(path, source)
        # The parent releases its install lock before launching the replacement installer.
        return path.read_bytes()


def main():
    parser = argparse.ArgumentParser(description='Nook 同步服务器安装助手')
    parser.add_argument('command', nargs='?', default='menu', choices=['install', 'menu', 'info', 'status', 'repair', 'backup', 'update', 'diagnose', 'boot', 'stop'])
    parser.add_argument('--yes', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('请使用 sudo 运行。')
    if ROOT.is_symlink():
        raise RuntimeError('安装目录不能为符号链接。')
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.umask(0o077)
    command = args.command
    if command == 'menu':
        if not (ROOT / 'state.json').exists():
            command = 'install'
        else:
            print('Nook 同步服务器\n1 显示连接信息\n2 检查并修复启动\n3 创建并校验备份\n4 更新服务\n5 查看诊断\n6 查看状态')
            command = {'1': 'info', '2': 'repair', '3': 'backup', '4': 'update', '5': 'diagnose', '6': 'status'}.get(input('请选择（回车退出）：'))
            if not command:
                return
    replacement = None
    installed = False
    with os.fdopen(os.open(ROOT / '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600), 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('另一个安装或维护任务正在运行，请稍后重试。') from None
        if command == 'install':
            installed = install(args.yes)
        elif command == 'info':
            state = read_state()
            show_connection(state)
        elif command in ('boot', 'repair'):
            state = read_state()
            boot(state, login=command == 'repair')
            if command == 'repair':
                print('✓ 服务已就绪；请在 Nook 验证连接。')
        elif command == 'stop':
            compose(read_state(), 'stop', 'sync')
        elif command == 'backup':
            backup(read_state())
        elif command == 'update':
            replacement = update()
        elif command in ('status', 'diagnose'):
            state = read_state()
            compose(state, 'ps', capture=False)
            if command == 'diagnose':
                run(['tailscale', 'status'], capture=False)
                compose(state, 'logs', '--tail', '50', 'sync', capture=False)
                print('若容器正常但 Nook 超时：检查电脑 Tailscale、访问策略及 TCP ' + str(state['port']) + '。')
    if installed:
        run(['systemctl', 'start', 'nook-sync-assistant.service'])
    if replacement:
        with tempfile.TemporaryDirectory(prefix='nook-update-') as temp:
            path = Path(temp) / 'install.sh'
            atomic(path, replacement)
            run(['bash', str(path)], capture=False, timeout=3600)


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print(f'\n未完成：{error or "操作已取消"}。已有数据和凭据保留；重新执行安装命令可继续。', file=sys.stderr)
        sys.exit(1)
