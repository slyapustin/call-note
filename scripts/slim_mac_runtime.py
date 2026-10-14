"""Remove development and CPU-only dependencies from the Mac MLX bundle."""
from pathlib import Path
import shutil


EXCLUDED = {
    'torch': ('torch', 'torchgen', 'functorch'),
    'sympy': ('sympy',),
    'networkx': ('networkx',),
    'mpmath': ('mpmath',),
    'pytest': ('pytest', '_pytest'),
    'iniconfig': ('iniconfig',),
    'pluggy': ('pluggy',),
    'pip': ('pip',),
}


def slim_runtime(target: Path):
    packages = target / 'lib/python3.13/site-packages'
    if not packages.is_dir() or not (target / 'bin/python3.13').is_file():
        raise ValueError('Expected a copied macOS Python 3.13 runtime')
    for distribution, modules in EXCLUDED.items():
        for path in [*(packages / name for name in modules), *packages.glob(f'{distribution}-*.dist-info')]:
            if path.is_symlink():
                path.unlink()
            elif path.is_dir():
                shutil.rmtree(path)
    for name in ('pip', 'pip3', 'pip3.13'):
        (target / 'bin' / name).unlink(missing_ok=True)
    for name in ('python', 'python3'):
        alias = target / 'bin' / name
        if alias.is_symlink():
            if alias.readlink() != Path('python3.13'):
                raise ValueError(f'Unexpected Python alias: {alias}')
        else:
            if alias.read_bytes() != (target / 'bin/python3.13').read_bytes():
                raise ValueError(f'Python alias differs from interpreter: {alias}')
            alias.unlink()
            alias.symlink_to('python3.13')
