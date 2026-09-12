"""Exercise the actual copied command and both checksum gates in a disposable Linux container."""
import fcntl
import os
from pathlib import Path
import subprocess
import tempfile
import termios


def main():
    if not Path('/.dockerenv').exists():
        raise RuntimeError('Requires a disposable Linux container')
    artifacts = Path('/source/.pack/sync-server')
    command = (artifacts / 'install-command.txt').read_text()
    Path('/run/systemd/system').mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='nook-bootstrap-test-') as directory:
        root = Path(directory)
        sentinel = root / 'executed'
        curl = root / 'curl'
        curl.write_text('''#!/bin/sh
while [ "$#" -gt 0 ]; do
 case "$1" in
  https://*) name=${1##*/} ;;
  -o) shift; output=$1 ;;
 esac
 shift
done
cp "/source/.pack/sync-server/$name" "$output"
if [ "$name" = "$NOOK_TEST_TAMPER" ]; then printf '\\nchanged\\n' >> "$output"; fi
''')
        python = root / 'python3'
        python.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$NOOK_TEST_EXECUTED"\n')
        curl.chmod(0o700)
        python.chmod(0o700)
        for tamper in ('', 'install.sh', 'assistant.py'):
            sentinel.unlink(missing_ok=True)
            master, slave = os.openpty()
            def controlling_terminal():
                os.setsid()
                fcntl.ioctl(0, termios.TIOCSCTTY, 0)
            try:
                os.write(master, b'\n')
                result = subprocess.run(['/bin/bash', '-c', command], stdin=slave, capture_output=True, text=True,
                                        timeout=30, preexec_fn=controlling_terminal,
                                        env={**os.environ, 'PATH': directory + ':' + os.environ['PATH'],
                                             'NOOK_TEST_TAMPER': tamper, 'NOOK_TEST_EXECUTED': str(sentinel)})
                if tamper:
                    assert result.returncode != 0 and not sentinel.exists(), result.stdout + result.stderr
                else:
                    assert result.returncode == 0, result.stdout + result.stderr
                    assert sentinel.read_text().splitlines()[1:] == ['install', '--yes']
            finally:
                os.close(master)
                os.close(slave)
    print('Copied command: root without sudo, source handoff and both tamper rejection gates passed')


if __name__ == '__main__':
    main()
