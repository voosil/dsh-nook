"""Real Docker installer lifecycle; Tailscale identity/systemd calls are test substitutes.

Uses a uniquely named disposable Compose project and volume. Never installs host packages.
"""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import uuid
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[2]


def main():
    subprocess.run(['node', 'scripts/sync-server/package.mjs'], cwd=REPO, check=True)
    artifacts = REPO / '.pack/sync-server'
    spec = importlib.util.spec_from_file_location('assistant', artifacts / 'assistant.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    project = 'nook-assistant-test-' + uuid.uuid4().hex[:12]
    with tempfile.TemporaryDirectory(prefix='nook-assistant-test-') as directory:
        root = Path(directory) / 'install'
        root.mkdir()
        module.ROOT = root
        module.UNIT = Path(directory) / 'nook-sync-assistant.service'
        module.LAUNCHER = Path(directory) / 'nook-sync'
        module.PROJECT = project
        module.VOLUME = project + '-data'
        original_run = module.run
        original_compose = module.compose

        def run(args, **kwargs):
            if args[0] == 'systemctl':
                return ''
            return original_run(args, **kwargs)

        def compose(state, *args, **kwargs):
            # Only the network boundary is substituted: Docker Desktop cannot bind a
            # fabricated Tailscale address. Actual TLS/auth/CAS and persistence remain real.
            (root / '.env').write_text('NOOK_MODE=vpn\nNOOK_HOST=127.0.0.1\nNOOK_BIND_IP=127.0.0.1\nNOOK_PORT=18444\n')
            return original_compose(state, *args, **kwargs)

        archive = (artifacts / f'nook-sync-assistant-{module.VERSION}.tar.gz').read_bytes()
        with patch.object(module, 'system_info', return_value=('debian', 'bookworm', 'arm64')), \
             patch.object(module, 'dependencies'), \
             patch.object(module, 'tail_address', return_value='100.101.102.103'), \
             patch.object(module, 'choose_port', return_value=18444), \
             patch.object(module, 'download', return_value=archive), \
             patch.object(module, 'compose', side_effect=compose), \
             patch.object(module, 'run', side_effect=run):
            state = None
            try:
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    module.install(yes=True)
                assert 'NOOK-SYNC-1:' in output.getvalue()
                state = module.read_state()
                info = json.loads(compose(state, 'exec', '-T', 'sync', 'python3', 'container.py', 'export'))
                compose(state, 'exec', '-T', 'sync', 'python3', '-c',
                        "from pathlib import Path; Path('/var/lib/nook-sync/data/sentinel').write_text('keep me')")
                with contextlib.redirect_stdout(io.StringIO()):
                    module.install(yes=True)
                    backup = module.backup(state)
                assert json.loads(compose(state, 'exec', '-T', 'sync', 'python3', 'container.py', 'export')) == info
                assert compose(state, 'exec', '-T', 'sync', 'cat', '/var/lib/nook-sync/data/sentinel') == 'keep me'
                module.verify_backup(backup / 'nook-sync.tar.gz', json.loads((backup / 'manifest.json').read_text()))
                # Restore only into a disposable test volume, retain the original and compare every file.
                restored = project + '-restored'
                original_run(['docker', 'volume', 'create', restored])
                try:
                    with (backup / 'nook-sync.tar.gz').open('rb') as file:
                        subprocess.run(['docker', 'run', '--rm', '-i', '-v', f'{restored}:/restore', '--entrypoint', 'tar',
                                        module.IMAGE, '-C', '/restore', '-xzf', '-'], stdin=file, check=True, timeout=90)
                    restored_manifest = json.loads(original_run(['docker', 'run', '--rm', '-v', f'{restored}:/var/lib/nook-sync:ro',
                                                                 '--entrypoint', 'python3', module.IMAGE, '-c', module.MANIFEST]))
                    assert restored_manifest == json.loads((backup / 'manifest.json').read_text())
                finally:
                    original_run(['docker', 'volume', 'rm', restored])
                # Recreate containers as on a reboot, then validate identity and existing data.
                compose(state, 'down')
                module.boot(state)
                assert json.loads(compose(state, 'exec', '-T', 'sync', 'python3', 'container.py', 'export')) == info
                logs = compose(state, 'logs', '--no-color', 'sync')
                assert info['password'] not in logs and 'NOOK-SYNC-1:' not in logs
                print('Assistant: real pinned image, install/retry, export, backup/restore, recreation and credential preservation passed')
            finally:
                if (root / 'state.json').exists():
                    # Only the unique disposable project and its fresh test volume are removed.
                    compose(module.read_state(), 'down', '-v', '--remove-orphans')


if __name__ == '__main__':
    main()
