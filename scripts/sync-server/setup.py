#!/usr/bin/env python3
"""Nook standalone WebDAV installer. Ubuntu 22.04+/Debian 12+, root, systemd, Python 3.9+."""
import argparse
import base64
import concurrent.futures
import errno
import fcntl
import grp
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import socket
import ssl
import subprocess
import sys
import time

VERSION = 1
ROOT = Path('/opt/nook-sync')
UNIT_DIR = Path('/etc/systemd/system')
SOURCE = globals().get('__NOOK_INSTALLER_SOURCE__') or Path(__file__).read_text()


def run(args, *, data=None):
    result = subprocess.run(args, input=data, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=900)
    if result.returncode:
        # Command arguments can contain private material; never echo them.
        raise RuntimeError(f'{Path(args[0]).name} 执行失败，请检查服务日志或依赖。\n{result.stderr[-2000:]}')
    return result.stdout


def atomic(path, content, mode=0o600):
    path = Path(path)
    if path.is_symlink():
        raise RuntimeError(f'拒绝写入符号链接：{path}')
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + secrets.token_hex(8) + '.tmp')
    fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, mode)
    os.fchmod(fd, mode)
    with os.fdopen(fd, 'wb') as output:
        output.write(content.encode() if isinstance(content, str) else content)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
    sync_directory(path.parent)


# os.close is needed for raw directory descriptors (not a file object's close method).
def sync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def backup(paths, root):
    folder = root / 'backups' / (time.strftime('%Y%m%d-%H%M%S') + '-' + secrets.token_hex(4))
    folder.mkdir(parents=True, mode=0o700)
    manifest = {}
    for path in paths:
        if not path.exists():
            continue
        if path.is_symlink() or not path.is_file():
            raise RuntimeError('备份源不是普通文件，已停止修改。')
        content = path.read_bytes()
        target = folder / path.name
        atomic(target, content)
        digest = hashlib.sha256(content).hexdigest()
        if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise RuntimeError('备份校验失败，已停止修改。')
        manifest[path.name] = digest
    atomic(folder / 'manifest.json', json.dumps(manifest))
    sync_directory(folder)
    return folder


def normalize_host(host):
    host = host.strip().strip('[]').lower()
    try:
        return str(ipaddress.ip_address(host))
    except ValueError:
        if len(host) > 253 or not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', part) for part in host.split('.')):
            raise ValueError('填写 IP 或域名，不要带协议、路径、端口或空格。')
        return host


def validate(options):
    options.host = normalize_host(options.host)
    if not 1 <= options.port <= 65535:
        raise ValueError('端口必须在 1–65535 之间。')
    try:
        address = ipaddress.ip_address(options.host)
        if address.is_unspecified or address.is_multicast:
            raise ValueError('不能使用未指定地址或组播地址。')
    except ValueError as error:
        if ':' in options.host or re.fullmatch(r'[0-9.]+', options.host):
            raise error
        address = None
    if options.mode == 'ip' and (address is None or not address.is_global):
        raise ValueError('公网 IP 模式需要公网 IP；内网地址请选择 VPN 模式。')
    if options.mode == 'domain':
        if address is not None or '.' not in options.host or options.host.endswith(('.local', '.localhost', '.internal')):
            raise ValueError('域名模式需要可公网验证的完整域名。')
        if options.port != 443:
            raise ValueError('自动域名证书模式使用 HTTPS 443 端口。')
        if not options.email or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', options.email):
            raise ValueError('自动申请证书需要有效邮箱。')
        if not options.accept_acme_terms:
            raise ValueError('申请证书需接受 ACME 服务条款（--accept-acme-terms）。')
    return options


def url_for(state):
    host = '[' + state['host'] + ']' if ':' in state['host'] else state['host']
    return f"https://{host}{':' + str(state['port']) if state['port'] != 443 else ''}/nook/"


def check_ports(ports):
    for port in ports:
        for family, host in [(socket.AF_INET, '0.0.0.0'), (socket.AF_INET6, '::')]:
            try:
                with socket.socket(family, socket.SOCK_STREAM) as test:
                    if family == socket.AF_INET6:
                        test.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                    test.bind((host, port))
            except OSError as error:
                if family == socket.AF_INET6 and error.errno in (errno.EAFNOSUPPORT, errno.EADDRNOTAVAIL):
                    continue
                raise RuntimeError(f'端口 {port} 已被占用，未停止或修改已有服务。')


def leaf_certificate(root, state):
    certs = root / 'certs'
    certs.mkdir(mode=0o700, exist_ok=True)
    if not (certs / 'ca.pem').exists():
        if (certs / 'ca.key').exists():
            raise RuntimeError('CA 生成曾中断；保留现有文件，请检查后恢复。')
        run(['openssl', 'req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-days', '3650',
             '-subj', '/CN=Nook Sync Private CA', '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
             '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-keyout', str(certs/'ca.key'), '-out', str(certs/'ca.pem')])
    run(['openssl', 'x509', '-in', str(certs/'ca.pem'), '-checkend', '7776000', '-noout'])
    extension = 'IP:' if ':' in state['host'] or re.fullmatch(r'[0-9.]+', state['host']) else 'DNS:'
    atomic(certs/'leaf.ext', f"basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName={extension}{state['host']}\n")
    run(['openssl', 'req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=Nook Sync',
         '-keyout', str(certs/'next.key'), '-out', str(certs/'next.csr')])
    run(['openssl', 'x509', '-req', '-in', str(certs/'next.csr'), '-CA', str(certs/'ca.pem'),
         '-CAkey', str(certs/'ca.key'), '-set_serial', '0x'+secrets.token_hex(16), '-days', '90', '-sha256',
         '-extfile', str(certs/'leaf.ext'), '-out', str(certs/'next.pem')])
    run(['openssl', 'verify', '-CAfile', str(certs/'ca.pem'), str(certs/'next.pem')])
    backup([certs/'server.key', certs/'server.pem'], root)
    atomic(certs/'server.key', (certs/'next.key').read_bytes())
    atomic(certs/'server.pem', (certs/'next.pem').read_bytes())


def cert_paths(root, state):
    if state['mode'] == 'domain':
        directory = root / 'acme/live/nook-sync'
        return directory/'fullchain.pem', directory/'privkey.pem'
    return root/'certs/server.pem', root/'certs/server.key'


def certificate(root, state, renew=False):
    if state['mode'] != 'domain':
        cert, _ = cert_paths(root, state)
        if renew and cert.exists():
            status = subprocess.run(['openssl','x509','-in',str(cert),'-checkend','2592000','-noout'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if status.returncode == 0:
                return False
        leaf_certificate(root, state)
        return True
    common = ['--config-dir',str(root/'acme'),'--work-dir',str(root/'acme-work'),'--logs-dir',str(root/'logs/acme')]
    if renew:
        cert,_=cert_paths(root,state)
        before=cert.read_bytes()
        run(['certbot','renew','--quiet','--cert-name','nook-sync',*common])
        return cert.read_bytes()!=before
    else:
        check_ports([80])
        run(['certbot','certonly','--standalone','--non-interactive','--agree-tos','--email',state['email'],
             '--preferred-challenges','http','--cert-name','nook-sync','-d',state['host'],*common])
    return True


def apache_config(root, state, user='nook-sync', modules='/usr/lib/apache2/modules'):
    cert, key = cert_paths(root, state)
    names = ['mpm_prefork','authn_core','authn_file','authz_core','authz_user','auth_basic','alias','dav','dav_fs','ssl','socache_shmcb']
    loads = '\n'.join(f'LoadModule {name}_module {modules}/mod_{name}.so' for name in names)
    return f'''ServerRoot "{root}"
ServerName {url_for(state).removesuffix('/nook/')}
Listen {state['port']}
PidFile "{root}/run/httpd.pid"
DefaultRuntimeDir "{root}/run"
{loads}
User {user}
Group {user}
ServerLimit 1
StartServers 1
MinSpareServers 1
MaxSpareServers 2
MaxRequestWorkers 1
MaxConnectionsPerChild 0
KeepAlive Off
Timeout 25
ServerTokens Prod
ServerSignature Off
ErrorLog "{root}/logs/apache.log"
LogLevel warn
DavLockDB "{root}/run/DavLock"
SSLSessionCache none
SSLProtocol -all +TLSv1.2 +TLSv1.3
<Directory />
    AllowOverride None
    Require all denied
</Directory>
<VirtualHost *:{state['port']}>
    SSLEngine On
    SSLCertificateFile "{cert}"
    SSLCertificateKeyFile "{key}"
    Alias /nook/ "{root}/data/"
    <Directory "{root}/data/">
        Dav On
        Options None
        AllowOverride None
        AuthType Basic
        AuthName "Nook Sync"
        AuthUserFile "{root}/passwords"
        Require valid-user
    </Directory>
</VirtualHost>
'''


def units(root):
    return {
        'nook-sync.service': f'''# Managed by nook-sync setup v{VERSION}
[Unit]
Description=Nook private WebDAV sync
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
ExecStart=/usr/sbin/apache2 -f {root}/httpd.conf -DFOREGROUND
Restart=on-failure
RestartSec=3
KillMode=control-group
TimeoutStopSec=30
PrivateTmp=true
UMask=0077
[Install]
WantedBy=multi-user.target
''',
        'nook-sync-renew.service': f'''# Managed by nook-sync setup v{VERSION}
[Unit]
Description=Renew Nook sync certificate
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 {root}/setup.py --renew
UMask=0077
''',
        'nook-sync-renew.timer': f'''# Managed by nook-sync setup v{VERSION}
[Unit]
Description=Check Nook certificate twice daily
[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=1800
Persistent=true
[Install]
WantedBy=timers.target
'''}


def probe(state, root):
    # Strong TLS validation including SAN and expiry, with a connection-local private CA.
    context = ssl.create_default_context(cafile=str(root/'certs/ca.pem') if state['mode'] != 'domain' else None)
    auth = 'Basic '+base64.b64encode(f"nook:{state['password']}".encode()).decode()
    class LocalConnection(http.client.HTTPSConnection):
        def connect(self):
            # Public IPs can be NAT mappings without hairpin routing. Probe the local
            # service while still verifying the exact hostname clients will use.
            connection = socket.create_connection(('127.0.0.1', self.port), self.timeout)
            try:
                self.sock = context.wrap_socket(connection, server_hostname=self.host)
            except BaseException:
                connection.close()
                raise
    def request(method, path, body=None, condition=None, authenticated=True):
        connection = LocalConnection(state['host'], state['port'], timeout=30, context=context)
        headers = {'Authorization':auth} if authenticated else {}
        if condition:
            headers.update(condition)
        try:
            connection.request(method, '/nook/'+path, body=body, headers=headers)
            response = connection.getresponse()
            data = response.read(1024*1024+1)
            if len(data)>1024*1024:
                raise RuntimeError('探测响应超出限制。')
            return response.status, response.getheader('ETag'), data
        finally:
            connection.close()
    def read(path):
        for _ in range(4):
            result = request('GET', path)
            if result[1] and not result[1].startswith('W/'):
                return result
            time.sleep(1.1)
        return result
    if request('GET','',authenticated=False)[0] not in (401,403):
        raise RuntimeError('未认证请求未被拒绝，部署验证失败。')
    if request('MKCOL','probes/')[0] not in (201,405):
        raise RuntimeError('同步目录不可写。')
    path='probes/setup-'+secrets.token_hex(16)
    def race(values, condition):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            return list(pool.map(lambda data:request('PUT',path,data,condition)[0],values))
    try:
        created=race([b'nook-a',b'nook-a'],{'If-None-Match':'*'})
        if sorted(created) not in ([201,412],[204,412],[200,412]):
            raise RuntimeError('服务器没有保证原子条件创建。')
        code,etag,body=read(path)
        if code != 200 or body != b'nook-a' or not etag or not re.fullmatch(r'"[^"\r\n]+"',etag):
            raise RuntimeError('强 ETag 或字节一致性检查失败。')
        if request('GET',path,authenticated=False)[0] not in (401,403):
            raise RuntimeError('匿名请求可以读取存储文件，部署验证失败。')
        changed=race([b'nook-b',b'nook-c'],{'If-Match':etag})
        if changed.count(412)!=1 or sum(c in (200,201,204) for c in changed)!=1:
            raise RuntimeError('服务器没有保证原子条件更新。')
        code,new_etag,body=read(path)
        expected=b'nook-b' if changed[0]!=412 else b'nook-c'
        if code!=200 or body!=expected or new_etag==etag or request('PUT',path,b'nook-d',{'If-Match':etag})[0]!=412:
            raise RuntimeError('条件更新或读回校验失败。')
    finally:
        # Only this invocation's disposable probe is removed, never user records.
        request('DELETE',path)


def connection_info(root, state):
    ca=(root/'certs/ca.pem').read_text() if state['mode']!='domain' else ''
    return {'format':'nook-sync-connection','version':1,'url':url_for(state),'username':'nook','password':state['password'],'caCert':ca}


def export_connection(root, state):
    info=connection_info(root,state)
    atomic(root/'connection.json',json.dumps(info,ensure_ascii=False,indent=2)+'\n')
    return info


def show(root, state):
    info=export_connection(root,state)
    ca=info['caCert']
    print('\n配置完成，并已通过本机 HTTPS / 认证 / 并发写入检查。\n在 Nook → 数据同步中填写：')
    print(f"\nWebDAV 同步目录：{info['url']}\n存储用户名：nook\n存储密码或应用令牌：{info['password']}")
    if ca:
        print('\n服务器 CA 证书（完整复制到 Nook 同名字段，仅信任此连接）：\n'+ca)
    else:
        print('\n服务器 CA 证书：留空（使用公开可信证书）')
    print(f'\n连接信息：{root}/connection.json（仅 root 可读）\n数据目录：{root}/data\n查看服务：sudo systemctl status nook-sync\n重新显示信息：sudo python3 {root}/setup.py --info')
    print(f"请在客户端点击“验证并开启同步”确认实际网络可达；确保 VPN / 防火墙允许 TCP {state['port']}。")
    if state['mode']=='domain':
        print('自动续期还需要公网 TCP 80 可达。')
    print('不要分享 connection.json 或密码；备份整个安装目录。工具不会修改防火墙、路由或已有 Web 服务。')
    print('推荐：把 connection.json 安全下载到本机，在 Nook → 数据同步选择“导入连接配置”，核对地址后点击“验证并开启同步”。')


def dependencies(domain):
    release={}
    for line in Path('/etc/os-release').read_text().splitlines():
        if '=' in line:
            k,v=line.split('=',1);release[k]=v.strip('"')
    if release.get('ID') not in ('ubuntu','debian'):
        raise RuntimeError('当前支持 Ubuntu 22.04+ 和 Debian 12+。')
    minimum=22 if release['ID']=='ubuntu' else 12
    if int(release.get('VERSION_ID','0').split('.')[0])<minimum:
        raise RuntimeError('系统版本过旧，请使用 Ubuntu 22.04+ 或 Debian 12+。')
    packages=['apache2-bin','apache2-utils','openssl']+(['certbot'] if domain else [])
    print('正在安装服务器依赖，首次运行可能需要几分钟…', flush=True)
    run(['apt-get','update'])
    run(['apt-get','install','-y',*packages])


def prompt(text, default=None):
    # Also works when launched from a downloaded/embedded one-line command.
    with open('/dev/tty','r+') as terminal:
        terminal.write(text+(f' [{default}]' if default else '')+'：');terminal.flush()
        value=terminal.readline().strip()
        return value or default or ''


def main(argv=None):
    parser=argparse.ArgumentParser(description='Nook Linux 同步服务器一键配置；重复执行保留数据、密码和证书。')
    parser.add_argument('--mode',choices=['vpn','ip','domain'])
    parser.add_argument('--host')
    parser.add_argument('--port',type=int)
    parser.add_argument('--email')
    parser.add_argument('--accept-acme-terms',action='store_true')
    parser.add_argument('--info',action='store_true')
    parser.add_argument('--renew',action='store_true')
    args=parser.parse_args(argv)
    if sys.platform!='linux' or os.geteuid()!=0:
        raise RuntimeError('请在 Linux 服务器上使用 sudo python3 执行。')
    if not Path('/run/systemd/system').exists():
        raise RuntimeError('需要使用 systemd 的 Linux 主机。')
    os.umask(0o077)
    if ROOT.is_symlink():
        raise RuntimeError('安装目录不能是符号链接。')
    # Lock outside the destination so two installers cannot race initial creation.
    descriptor=os.open('/run/lock/nook-sync-setup.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    if os.fstat(descriptor).st_uid != 0:
        os.close(descriptor)
        raise RuntimeError('安装锁不属于 root，已停止。')
    with os.fdopen(descriptor,'a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        state_file=ROOT/'state.json'
        if state_file.exists():
            state=json.loads(state_file.read_text())
            if state.get('version')!=VERSION:
                raise RuntimeError('不支持的安装版本，已保留现有部署。')
            for key in ['mode','host','port']:
                supplied=getattr(args,key)
                if supplied is not None and supplied!=state[key]:
                    raise RuntimeError('已有部署的模式、地址或端口不同；未覆盖现有数据和证书。请使用原配置。')
            if args.renew:
                if certificate(ROOT,state,renew=True):
                    run(['/usr/sbin/apache2','-t','-f',str(ROOT/'httpd.conf')])
                    run(['systemctl','restart','nook-sync.service'])
                return
        else:
            if args.info or args.renew:
                raise RuntimeError('尚未完成安装。')
            if ROOT.exists():
                raise RuntimeError('安装目录已有内容但缺少回执，已保留原目录，请检查。')
            if not args.mode:
                print('选择部署环境：1 内网 / VPN；2 只有公网 IP；3 公网域名（自动 HTTPS）')
                args.mode={'1':'vpn','2':'ip','3':'domain'}.get(prompt('选择','1'))
                if not args.mode:raise ValueError('请选择 1、2 或 3。')
            args.host=args.host or prompt('填写其他设备使用的 IP 或域名')
            args.port=args.port or int(prompt('HTTPS 端口','8443' if args.mode=='vpn' else '443'))
            if args.mode=='domain':
                args.email=args.email or prompt('证书通知邮箱')
                if not args.accept_acme_terms:
                    print('自动申请证书会向 Let’s Encrypt 提交域名和邮箱。条款：https://letsencrypt.org/repository/')
                    args.accept_acme_terms=prompt('接受条款并申请证书？输入 yes')=='yes'
            validate(args)
            check_ports([args.port]+([80] if args.mode=='domain' else []))
            for name in units(ROOT):
                if (UNIT_DIR/name).exists():raise RuntimeError(f'{name} 已存在，未覆盖其他服务。')
            dependencies(args.mode=='domain')
            try:pwd.getpwnam('nook-sync')
            except KeyError:run(['useradd','--system','--user-group','--home-dir',str(ROOT/'data'),'--no-create-home','--shell','/usr/sbin/nologin','nook-sync'])
            identity=pwd.getpwnam('nook-sync')
            if identity.pw_uid == 0 or grp.getgrnam('nook-sync').gr_gid != identity.pw_gid:
                raise RuntimeError('已有 nook-sync 用户或组不适用于独立服务，未接管。')
            ROOT.mkdir(mode=0o755)
            ROOT.chmod(0o755)
            state={'version':VERSION,'mode':args.mode,'host':args.host,'port':args.port,'email':args.email,'password':secrets.token_urlsafe(32),'complete':False}
            atomic(state_file,json.dumps(state))
        if not state['complete']:
            print('正在配置专属存储、HTTPS 证书和系统服务…', flush=True)
            identity=pwd.getpwnam('nook-sync')
            for name in ['data','run','logs']:
                directory=ROOT/name;directory.mkdir(mode=0o750,exist_ok=True);os.chown(directory,identity.pw_uid,identity.pw_gid)
            if not (ROOT/'passwords').exists():
                hashed=run(['htpasswd','-niB','nook'],data=state['password']+'\n')
                atomic(ROOT/'passwords',hashed,0o640);os.chown(ROOT/'passwords',0,identity.pw_gid)
            certificate(ROOT,state)
            atomic(ROOT/'httpd.conf',apache_config(ROOT,state),0o640)
            atomic(ROOT/'setup.py',SOURCE,0o700)
            run(['/usr/sbin/apache2','-t','-f',str(ROOT/'httpd.conf')])
            for name,body in units(ROOT).items():
                target=UNIT_DIR/name
                if target.exists() and not target.read_text().startswith('# Managed by nook-sync setup'):
                    raise RuntimeError('服务配置已被其他程序占用，未覆盖。')
                if target.exists():backup([target],ROOT)
                atomic(target,body,0o644)
            run(['systemctl','daemon-reload'])
            run(['systemctl','enable','--now','nook-sync.service','nook-sync-renew.timer'])
        else:
            run(['systemctl','start','nook-sync.service'])
        error=None
        print('正在检查 HTTPS、认证及并发写入…', flush=True)
        for _ in range(5):
            try:probe(state,ROOT);error=None;break
            except (OSError,RuntimeError,http.client.HTTPException) as exc:error=exc;time.sleep(2)
        if error:raise RuntimeError(f'配置已保留，但连通性检查未通过：{error}\n检查域名解析、网络、防火墙和 systemctl status nook-sync 后，重新运行本命令。')
        state['complete']=True
        atomic(state_file,json.dumps(state))
        show(ROOT,state)


if __name__=='__main__':
    try:main()
    except (Exception,KeyboardInterrupt) as error:
        print(f'\n未完成：{error}\n已有数据、凭据和证书均保留。',file=sys.stderr)
        sys.exit(1)
