"""Actual Compose lifecycle acceptance; every container/volume is disposable test data."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[4]


def command(args, **kwargs):
    result = subprocess.run(args, text=True, capture_output=True, timeout=240, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed: {result.stderr[-3000:]}')
    return result.stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--client', action='store_true')
    args = parser.parse_args()
    project = 'nook-sync-test-' + uuid.uuid4().hex[:12]
    with tempfile.TemporaryDirectory(prefix='nook-docker-test-') as temp:
        env = Path(temp) / '.env'
        env.write_text('NOOK_MODE=vpn\nNOOK_HOST=127.0.0.1\nNOOK_PORT=18443\nNOOK_BIND_IP=127.0.0.1\n')
        compose = ['docker', 'compose', '-p', project, '--env-file', str(env),
                   '-f', str(ROOT / 'scripts/sync-server/compose.yaml'),
                   '-f', str(ROOT / 'scripts/sync-server/compose.build.yaml')]
        def execute(*values):
            return command([*compose, 'exec', '-T', 'sync', *values])
        try:
            command([*compose, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '180'])
            info = json.loads(execute('python3', 'container.py', 'export'))
            assert info['format'] == 'nook-sync-connection' and info['version'] == 1
            assert info['url'] == 'https://127.0.0.1:18443/nook/'
            assert 'BEGIN CERTIFICATE' in info['caCert'] and len(info['password']) >= 40
            permissions = execute('stat', '-c', '%a', '/var/lib/nook-sync/connection.json').strip()
            assert permissions == '600', permissions
            execute('python3', '-c', "from pathlib import Path; Path('/var/lib/nook-sync/data/sentinel').write_text('keep me')")
            logs = command([*compose, 'logs', '--no-color', 'sync'])
            assert info['password'] not in logs and info['caCert'] not in logs
            # A second process sharing the volume must fail without serving requests.
            duplicate = subprocess.run([*compose, 'run', '--rm', '--no-deps', 'sync'], capture_output=True, text=True, timeout=30)
            assert duplicate.returncode != 0 and '另一个同步服务' in duplicate.stderr
            # Force a real certificate replacement using the production backup helper,
            # then recreate the whole container and verify the same CA/data/credentials.
            command([*compose, 'stop', 'sync'])
            renewal = "import json,setup; from pathlib import Path; r=Path('/var/lib/nook-sync'); setup.leaf_certificate(r,json.loads((r/'state.json').read_text()))"
            command([*compose, 'run', '--rm', '--no-deps', '--entrypoint', 'python3', 'sync', '-c', renewal])
            command([*compose, 'up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '180'])
            assert json.loads(execute('python3', 'container.py', 'export')) == info
            assert execute('cat', '/var/lib/nook-sync/data/sentinel') == 'keep me'
            # Changed target is rejected even after the old container stops.
            command([*compose, 'stop', 'sync'])
            changed = subprocess.run([*compose, 'run', '--rm', '--no-deps', '-e', 'NOOK_HOST=127.0.0.2', 'sync'], capture_output=True, text=True, timeout=30)
            assert changed.returncode != 0 and '地址或端口不同' in changed.stderr
            command([*compose, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '180'])
            if args.client:
                connection = Path(temp) / 'connection.json'
                connection.write_text(json.dumps(info))
                connection.chmod(0o600)
                print(command(['node', '--import', 'tsx', str(ROOT / 'tests/fixtures/sync-server/client.ts'), str(connection)], cwd=ROOT), end='')
            print('Docker: real Compose/TLS/auth/CAS, private export, volume lock, recreation, certificate backup and target guard passed')
        finally:
            # Only the uniquely named, newly created test project is removed.
            command([*compose, 'down', '-v', '--remove-orphans'])


if __name__ == '__main__':
    main()
