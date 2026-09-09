"""Container lifecycle for the same verified Apache WebDAV and certificate helpers."""
import argparse
import fcntl
import http.client
import json
import os
from pathlib import Path
import pwd
import signal
import socket
import ssl
import subprocess
import sys
import time

import setup

ROOT = Path('/var/lib/nook-sync')


def options():
    mode = os.environ.get('NOOK_MODE', 'vpn')
    if mode not in ('vpn', 'ip', 'domain'):
        raise ValueError('NOOK_MODE 必须是 vpn、ip 或 domain。')
    return setup.validate(argparse.Namespace(
        mode=mode, host=os.environ.get('NOOK_HOST', ''),
        port=int(os.environ.get('NOOK_PORT', '8443')),
        email=os.environ.get('NOOK_EMAIL', ''),
        accept_acme_terms=os.environ.get('NOOK_ACCEPT_ACME_TERMS') == 'true'))


def prepare(root, args):
    state_file = root / 'state.json'
    if state_file.is_symlink():
        raise RuntimeError('部署回执不能是符号链接。')
    if state_file.exists():
        state = json.loads(state_file.read_text())
        if state.get('version') != setup.VERSION or state.get('deployment') != 'container':
            raise RuntimeError('数据卷不是兼容的 Nook 容器部署，已保留数据。')
        if any(state[key] != getattr(args, key) for key in ('mode', 'host', 'port')):
            raise RuntimeError('已有部署的模式、地址或端口不同，已保留数据和凭据；请恢复原配置。')
    else:
        if set(p.name for p in root.iterdir()) - {'.container.lock'}:
            raise RuntimeError('数据卷非空但缺少部署回执，拒绝接管。')
        state = dict(version=setup.VERSION, deployment='container', mode=args.mode,
                     host=args.host, port=args.port, email=args.email,
                     password=setup.secrets.token_urlsafe(32), complete=False)
        setup.atomic(state_file, json.dumps(state))
    identity = pwd.getpwnam('nook-sync')
    for name in ('data', 'run', 'logs', 'certs', 'acme', 'acme-work', 'backups'):
        directory = root / name
        if directory.is_symlink():
            raise RuntimeError('数据卷包含不支持的符号链接目录。')
        directory.mkdir(mode=0o750 if name in ('data', 'run', 'logs') else 0o700, exist_ok=True)
        if name in ('data', 'run', 'logs'):
            os.chown(directory, identity.pw_uid, identity.pw_gid)
    if not (root / 'passwords').exists():
        if state['complete']:
            raise RuntimeError('已有密码文件缺失，请从备份恢复。')
        hashed = setup.run(['htpasswd', '-niB', 'nook'], data=state['password'] + '\n')
        setup.atomic(root / 'passwords', hashed, 0o640)
        os.chown(root / 'passwords', 0, identity.pw_gid)
    cert, key = setup.cert_paths(root, state)
    if state['complete'] and (not cert.exists() or not key.exists() or
                             (state['mode'] != 'domain' and not (root / 'certs/ca.pem').exists())):
        raise RuntimeError('已有证书文件缺失，请从备份恢复。')
    if cert.exists() and key.exists():
        setup.certificate(root, state, renew=True)
    else:
        setup.certificate(root, state)
    config = setup.apache_config(root, state)
    path = root / 'httpd.conf'
    if path.exists() and path.read_text() != config:
        setup.backup([path], root)
    setup.atomic(path, config, 0o640)
    setup.run(['/usr/sbin/apache2', '-t', '-f', str(path)])
    return state


def health(root):
    state = json.loads((root / 'state.json').read_text())
    if not state['complete']:
        raise RuntimeError('启动验证尚未完成。')
    context = ssl.create_default_context(cafile=str(root / 'certs/ca.pem') if state['mode'] != 'domain' else None)
    connection = http.client.HTTPSConnection(state['host'], state['port'], timeout=5, context=context)
    sock = socket.create_connection(('127.0.0.1', state['port']), timeout=5)
    try:
        connection.sock = context.wrap_socket(sock, server_hostname=state['host'])
        auth = setup.base64.b64encode(('nook:' + state['password']).encode()).decode()
        connection.request('GET', '/nook/.health-' + setup.secrets.token_hex(16), headers={'Authorization': 'Basic ' + auth})
        if connection.getresponse().status != 404:
            raise RuntimeError('HTTPS / 认证健康检查失败。')
    finally:
        connection.close()
        sock.close()


class Stopping(BaseException):
    pass


def serve(root):
    args = options()
    if root.is_symlink():
        raise RuntimeError('数据卷根目录不能是符号链接。')
    root.mkdir(mode=0o755, parents=True, exist_ok=True)
    fd = os.open(root / '.container.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('数据卷已由另一个同步服务使用，拒绝并发启动。')
        root.chmod(0o755)
        process = None
        def stop():
            nonlocal process
            if process is not None:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=25)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
                process = None
        def start():
            return subprocess.Popen(['/usr/sbin/apache2', '-f', str(root / 'httpd.conf'), '-DFOREGROUND'], start_new_session=True)
        def stopping(_signum, _frame):
            raise Stopping()
        previous = {sig: signal.signal(sig, stopping) for sig in (signal.SIGTERM, signal.SIGINT)}
        try:
            state = prepare(root, args)
            process = start()
            for attempt in range(5):
                try:
                    setup.probe(state, root)
                    break
                except (OSError, RuntimeError, http.client.HTTPException):
                    if attempt == 4 or process.poll() is not None:
                        raise
                    time.sleep(2)
            state['complete'] = True
            setup.atomic(root / 'state.json', json.dumps(state))
            setup.export_connection(root, state)
            print('配置完成：HTTPS、认证和并发写入检查通过。使用 compose exec -T sync python3 container.py export 导出连接配置。', flush=True)
            renewal = time.monotonic() + 43200
            while True:
                if process.poll() is not None:
                    raise RuntimeError('Apache 意外退出。请检查数据卷中的 logs/apache.log。')
                if time.monotonic() >= renewal:
                    # Fully stop the process group before certificate replacement/restart;
                    # never leave two Apache generations writing the same volume.
                    stop()
                    setup.certificate(root, state, renew=True)
                    process = start()
                    setup.probe(state, root)
                    renewal = time.monotonic() + 43200
                time.sleep(1)
        finally:
            for sig in previous:
                signal.signal(sig, signal.SIG_IGN)
            stop()
            for sig, handler in previous.items():
                signal.signal(sig, handler)


def main():
    os.umask(0o077)
    command = sys.argv[1] if len(sys.argv) == 2 else 'serve'
    if command == 'serve':
        serve(ROOT)
    elif command in ('health', 'export'):
        health(ROOT)
        if command == 'export':
            # Explicit export only: secrets never appear in normal startup logs.
            print(json.dumps(setup.connection_info(ROOT, json.loads((ROOT / 'state.json').read_text())), ensure_ascii=False, indent=2))
    else:
        raise ValueError('支持 serve、health 或 export。')


if __name__ == '__main__':
    try:
        main()
    except Stopping:
        pass
    except Exception as error:
        print(f'同步服务未就绪：{error}；数据和凭据已保留。', file=sys.stderr)
        sys.exit(1)
