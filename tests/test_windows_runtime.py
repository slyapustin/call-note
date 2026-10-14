"""Portability regressions runnable on macOS; native Windows smoke runs in CI."""
import builtins
from pathlib import Path
import sys
from types import SimpleNamespace
import zipfile

import app
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import prepare_bundle_windows as bundle


def test_cpu_engine_load_never_imports_mlx(monkeypatch):
    model = SimpleNamespace(describe=lambda: {'engine': 'cpu'})
    monkeypatch.setitem(sys.modules, 'fermion', SimpleNamespace(load_speech=lambda *args, **kwargs: model))
    monkeypatch.setitem(sys.modules, 'fermion._speech.backends', SimpleNamespace(resolve=lambda command: 'cpu'))
    monkeypatch.setitem(sys.modules, 'fermion._speech.live', SimpleNamespace(warm_up=lambda model: 0.1))
    original = builtins.__import__
    def guarded(name, *args, **kwargs):
        if name.startswith('mlx'):
            raise AssertionError('CPU initialization imported MLX')
        return original(name, *args, **kwargs)
    monkeypatch.setattr(builtins, '__import__', guarded)
    engine = app.Engine()
    try:
        engine.load()
        assert engine.status == 'ready', engine.error
        assert engine.backend == 'cpu'
        assert engine.info['device']['type'] == 'cpu'
        monkeypatch.setattr(app, 'engine', engine)
        assert app.status()['backend'] == 'cpu'
    finally:
        engine.pool.shutdown()


def test_failed_backend_selection_is_reported(monkeypatch):
    monkeypatch.setitem(sys.modules, 'fermion', SimpleNamespace())
    def unavailable(command):
        raise SystemExit('CPU requires AVX2')
    monkeypatch.setitem(sys.modules, 'fermion._speech.backends', SimpleNamespace(resolve=unavailable))
    engine = app.Engine()
    try:
        engine.load()
        assert engine.status == 'error'
        assert engine.error == 'CPU requires AVX2'
        assert engine.backend is None
    finally:
        engine.pool.shutdown()


def test_asset_extraction_only_copies_allowlisted_data(tmp_path):
    archive = tmp_path / 'assets.zip'
    root = tmp_path / 'project'
    prefix = 'Call Note.app/Contents/Resources/service/'
    with zipfile.ZipFile(archive, 'w') as output:
        for name in bundle.ASSET_FILES:
            output.writestr(prefix + name, b'fixture')
        output.writestr(prefix + '../../escape', b'bad')
        output.writestr(prefix + 'app.py', b'bad')
        output.writestr('Call Note.app/Contents/MacOS/Call Note', b'bad')
    bundle.extract_assets(archive, root)
    assert (root / 'samples/meeting.wav').read_bytes() == b'fixture'
    assert (root / '.cache/fermion/speech/FermionResearch__Phonon-2' / bundle.MODEL / 'model.fermion').exists()
    assert not (root / 'app.py').exists()
    assert len(list(path for path in root.rglob('*') if path.is_file())) == len(bundle.ASSET_FILES)


def test_asset_download_rejects_digest_mismatch(tmp_path, monkeypatch):
    monkeypatch.setattr(bundle.common, 'BUILD', tmp_path)
    monkeypatch.setattr(bundle.urllib.request, 'urlretrieve', lambda url, target: target.write_bytes(b'corrupt'))
    with pytest.raises(RuntimeError, match='SHA256'):
        bundle.prepare_assets()
    assert not list(tmp_path.rglob('*.zip'))
    assert not list(tmp_path.rglob('*.partial'))


def test_windows_dependencies_exclude_mlx():
    from packaging.requirements import Requirement
    root = Path(__file__).resolve().parents[1]
    dependencies = [Requirement(line) for line in (root / 'requirements.txt').read_text().splitlines() if line and not line.startswith('#')]
    windows = {'sys_platform': 'win32', 'platform_machine': 'AMD64'}
    mac = {'sys_platform': 'darwin', 'platform_machine': 'arm64'}
    mlx = [dependency for dependency in dependencies if dependency.name.startswith('mlx')]
    assert len(mlx) == 4
    assert all(not dependency.marker.evaluate(windows) for dependency in mlx)
    assert all(dependency.marker.evaluate(mac) for dependency in mlx)


def test_idle_release_and_reload(monkeypatch):
    import weakref
    class Model:
        def describe(self):
            return {'engine': 'cpu'}
    loads = []
    def load(*args, **kwargs):
        model = Model()
        loads.append(weakref.ref(model))
        return model
    monkeypatch.setitem(sys.modules, 'fermion', SimpleNamespace(load_speech=load))
    monkeypatch.setitem(sys.modules, 'fermion._speech.backends', SimpleNamespace(resolve=lambda command: 'cpu'))
    monkeypatch.setitem(sys.modules, 'fermion._speech.live', SimpleNamespace(warm_up=lambda model: 0.1))
    engine = app.Engine()
    try:
        assert engine.status == 'idle'
        engine.ensure_loaded()
        engine.ensure_loaded()
        assert len(loads) == 1
        engine.unload()
        assert loads[0]() is None
        assert engine.model is None and engine.info == {} and engine.status == 'idle'
        engine.ensure_loaded()
        assert len(loads) == 2 and engine.status == 'ready'
    finally:
        engine.unload()
        engine.pool.shutdown()


def test_asset_symlink_is_rejected(tmp_path):
    import stat
    archive = tmp_path / 'symlink.zip'
    member = zipfile.ZipInfo('Call Note.app/Contents/Resources/service/' + bundle.ASSET_FILES[0])
    member.create_system = 3
    member.external_attr = (stat.S_IFLNK | 0o777) << 16
    with zipfile.ZipFile(archive, 'w') as output:
        output.writestr(member, '../../outside')
    with pytest.raises(RuntimeError, match='regular file'):
        bundle.extract_assets(archive, tmp_path / 'project')
