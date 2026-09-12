"""Shared Python entrypoint for the Node dispatcher and Python-only CI containers."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def main(paths):
    files = set()
    for value in paths:
        path = Path(value).resolve()
        candidates = path.rglob('test_*.py') if path.is_dir() else [path]
        for candidate in candidates:
            relative = candidate.relative_to(ROOT / 'tests')
            if {'helpers', 'fixtures', '__pycache__'}.intersection(relative.parts):
                continue
            if not candidate.is_file() or not candidate.name.startswith('test_') or candidate.suffix != '.py':
                raise RuntimeError(f'Not a Python test: {candidate}')
            if 'posix' in relative.parts and sys.platform == 'win32':
                raise RuntimeError(f'Explicit POSIX acceptance requires a POSIX system: {relative}')
            if 'linux' in relative.parts and sys.platform != 'linux':
                raise RuntimeError(f'Explicit Linux acceptance requires Linux: {relative}')
            files.add(candidate)
    if not files:
        raise RuntimeError('No Python tests selected; refusing an empty success')
    for file in sorted(files):
        print(f'Python test: {file.relative_to(ROOT)}', flush=True)
        subprocess.run([sys.executable, str(file)], cwd=ROOT, check=True)


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
