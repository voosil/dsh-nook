"""Run only INSIDE a disposable Linux container; installs real Docker/Tailscale packages.

Host daemons are substituted because this container has no systemd or Docker socket.
"""
import importlib.util
from pathlib import Path
import subprocess
from unittest.mock import patch


def main():
    if not Path('/.dockerenv').exists() or Path('/var/run/docker.sock').exists():
        raise RuntimeError('This test requires a disposable container without a host Docker socket')
    spec = importlib.util.spec_from_file_location('assistant', '/source/scripts/sync-server/assistant.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    original = module.run

    def run(args, **kwargs):
        if args[0] == 'systemctl' or args[:2] == ['docker', 'info']:
            return ''
        return original(args, **kwargs)

    # Verify the production platform detection without pretending the container boots systemd.
    Path('/run/systemd/system').mkdir(parents=True, exist_ok=True)
    info = module.system_info()
    with patch.object(module, 'run', side_effect=run):
        module.dependencies(info)
        module.dependencies(info)
    for args in [['docker', '--version'], ['docker', 'compose', 'version'], ['tailscale', 'version']]:
        subprocess.run(args, check=True)
    unit = Path('/tmp/nook-sync-assistant.service')
    unit.write_text(module.unit_text())
    subprocess.run(['systemd-analyze', 'verify', str(unit)], check=True)
    subprocess.run(['/usr/bin/python3', '/source/tests/sync-server/verify_bootstrap.py'], check=True)
    print('Official package installation, dependency reuse and generated systemd unit passed:', info)


if __name__ == '__main__':
    main()
