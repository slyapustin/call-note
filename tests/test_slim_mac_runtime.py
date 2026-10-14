from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from slim_mac_runtime import slim_runtime
from release_mac import validate_bundle_links


def runtime(tmp_path):
    target = tmp_path / 'python'
    packages = target / 'lib/python3.13/site-packages'
    packages.mkdir(parents=True)
    (target / 'bin').mkdir()
    for name in ('python', 'python3', 'python3.13'):
        (target / 'bin' / name).write_bytes(b'interpreter')
    return target, packages


def test_prunes_cpu_and_build_tools_without_removing_inference_or_notices(tmp_path):
    target, packages = runtime(tmp_path)
    for name in ('torch', 'torchgen', 'functorch', 'torch-2.14.1.dist-info',
                 'sympy', 'networkx', 'mpmath', 'pip', 'pytest', '_pytest',
                 'mlx', 'transformers', 'scipy', 'sherpa_onnx'):
        (packages / name).mkdir()
    (packages / 'mlx/LICENSE').write_text('retained license')
    slim_runtime(target)
    assert sorted(p.name for p in packages.iterdir()) == ['mlx', 'scipy', 'sherpa_onnx', 'transformers']
    assert (packages / 'mlx/LICENSE').read_text() == 'retained license'
    for name in ('python', 'python3'):
        assert (target / 'bin' / name).is_symlink()
        assert (target / 'bin' / name).resolve() == target / 'bin/python3.13'
    slim_runtime(target)


def test_rejects_an_external_python_alias(tmp_path):
    target, _ = runtime(tmp_path)
    alias = target / 'bin/python'
    alias.unlink()
    alias.symlink_to('/usr/bin/python3')
    with pytest.raises(ValueError, match='Unexpected Python alias'):
        slim_runtime(target)


@pytest.mark.parametrize('destination', ['absolute-inside', 'outside', 'missing'])
def test_signing_rejects_links_that_will_not_survive_relocation(tmp_path, destination):
    app = tmp_path / 'Call Note.app'
    app.mkdir()
    (app / 'python3.13').write_bytes(b'interpreter')
    (tmp_path / 'outside').write_bytes(b'outside')
    target = {'absolute-inside': app / 'python3.13', 'outside': Path('../outside'), 'missing': Path('missing')}[destination]
    (app / 'python').symlink_to(target)
    with pytest.raises(SystemExit, match='Nonportable symbolic link'):
        validate_bundle_links(app)


def test_signing_accepts_relative_internal_aliases(tmp_path):
    (tmp_path / 'python3.13').write_bytes(b'interpreter')
    (tmp_path / 'python').symlink_to('python3.13')
    validate_bundle_links(tmp_path)
