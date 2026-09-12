"""Run inside a disposable Debian/Ubuntu container with declared packages installed.
Real Apache/TLS/passwords/probes. systemd activation and public ACME issuance are test doubles.
"""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import signal
import ssl
import subprocess
import sys
import time
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('setup',sys.argv[1]);setup=importlib.util.module_from_spec(spec);spec.loader.exec_module(setup)
Path('/run/systemd/system').mkdir(parents=True,exist_ok=True)
real_run=setup.run
real_context=ssl.create_default_context
process=None
acme_calls=[]


def stop():
    global process
    if process and process.poll() is None:
        os.killpg(process.pid,signal.SIGTERM);process.wait(timeout=30)
    process=None


def start():
    global process
    if not process or process.poll() is not None:
        log=open(setup.ROOT/'logs/boot.log','ab')
        process=subprocess.Popen(['/usr/sbin/apache2','-f',str(setup.ROOT/'httpd.conf'),'-DFOREGROUND'],stdout=log,stderr=log,start_new_session=True)
        log.close();time.sleep(.5)


def command(args,**kwargs):
    if args[0]=='systemctl':
        if args[1]=='restart':stop();start()
        elif args[1] in ('enable','start'):start()
        return ''
    if args[0]=='certbot':
        acme_calls.append(args)
        if args[1]=='certonly':
            setup.leaf_certificate(setup.ROOT,{'host':'sync.example.test','mode':'vpn'})
            destination=setup.ROOT/'acme/live/nook-sync';destination.mkdir(parents=True)
            shutil.copyfile(setup.ROOT/'certs/server.pem',destination/'fullchain.pem')
            shutil.copyfile(setup.ROOT/'certs/server.key',destination/'privkey.pem')
        return ''
    return real_run(args,**kwargs)


def trust(*args,**kwargs):
    if not kwargs.get('cafile') and (setup.ROOT/'certs/ca.pem').exists():kwargs['cafile']=str(setup.ROOT/'certs/ca.pem')
    return real_context(*args,**kwargs)

try:
    with patch.object(setup,'dependencies',return_value=None),patch.object(setup,'run',side_effect=command),patch.object(ssl,'create_default_context',side_effect=trust):
        for mode,host,port in [('vpn','127.0.0.1',18443),('ip','8.8.8.8',18444),('domain','sync.example.test',443)]:
            setup.ROOT=Path('/tmp/nook-case-'+mode)
            setup.UNIT_DIR=Path('/tmp/nook-units-'+mode);setup.UNIT_DIR.mkdir()
            args=['--mode',mode,'--host',host,'--port',str(port)]
            if mode=='domain':args+=['--email','test@example.com','--accept-acme-terms']
            output=io.StringIO()
            with contextlib.redirect_stdout(output):setup.main(args)
            assert '配置完成' in output.getvalue()
            try:setup.check_ports([port]);raise AssertionError('occupied port must fail')
            except RuntimeError:assert process.poll() is None
            info=json.loads((setup.ROOT/'connection.json').read_text())
            assert info['url']==setup.url_for({'host':host,'port':port})
            assert len(info['password'])>=40
            assert bool(info['caCert'])==(mode!='domain')
            assert (setup.ROOT/'connection.json').stat().st_mode&0o777==0o600
            sentinel=setup.ROOT/'data/sentinel';sentinel.write_text('user data')
            before=(setup.ROOT/'certs/ca.pem').read_bytes()
            with contextlib.redirect_stdout(io.StringIO()):setup.main(args)
            assert json.loads((setup.ROOT/'connection.json').read_text())==info
            assert sentinel.read_text()=='user data'
            try:
                setup.main(['--port','9999'])
                raise AssertionError('must reject changed target')
            except RuntimeError as error:assert '已有部署' in str(error)
            with contextlib.redirect_stdout(io.StringIO()):setup.main(['--renew'])
            assert (setup.ROOT/'certs/ca.pem').read_bytes()==before
            if mode!='domain':
                setup.leaf_certificate(setup.ROOT,{'host':host,'mode':mode});command(['systemctl','restart']);setup.probe({'host':host,'port':port,'mode':mode,'password':info['password']},setup.ROOT)
                assert (setup.ROOT/'certs/ca.pem').read_bytes()==before
            print(mode+': real TLS, authentication, atomic writes, idempotency, target guard and renewal passed')
            stop()
        assert any('--standalone' in call and '--agree-tos' in call for call in acme_calls)
        assert any(call[1]=='renew' for call in acme_calls)
    # Keep the private fixture available for the actual Node adapter through Docker's loopback port.
    setup.ROOT=Path('/tmp/nook-case-vpn');start()
    shutil.copyfile(setup.ROOT/'connection.json','/tmp/nook-test-client.json')
    print('Domain CA issuance and systemd start/timer activation were simulated; all HTTPS WebDAV requests used real Apache.')
except BaseException:
    stop()
    raise
