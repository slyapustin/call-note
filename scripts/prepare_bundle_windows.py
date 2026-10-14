"""Build the Windows x64 CPU service with Python 3.13 and offline model assets.

Run on Windows with uv on PATH. The pinned Mac release is only an asset source:
no Mac executable, library, or Python package is copied into this bundle.
"""
from pathlib import Path
import hashlib
import os
import platform
import shutil
import stat
import subprocess
import sys
import urllib.request
import zipfile

import prepare_bundle as common

ASSET_URL = 'https://github.com/slyapustin/call-note/releases/download/v0.2.7/Call-Note-0.2.7-macOS-arm64.zip'
ASSET_SHA256 = '070cd070665b157baa413be712c40595b3b51578c79954eecf518335ee93da09'
MODEL = 'model_phonon2_c4c_int6'
ASSET_FILES = [
    *(f'models/{MODEL}/{name}' for name in ('config.json', 'model.fermion', 'packed_manifest.json')),
    'models/diarization/segmentation.onnx', 'models/diarization/embedding.onnx',
    'samples/long-clean.wav', 'samples/meeting.wav',
]


def checksum(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def extract_assets(archive, root):
    """Allowlisted files only; never extract executable files or archive paths."""
    prefix = 'Call Note.app/Contents/Resources/service/'
    with zipfile.ZipFile(archive) as source:
        for relative in ASSET_FILES:
            member = source.getinfo(prefix + relative)
            if stat.S_ISLNK(member.external_attr >> 16):
                raise RuntimeError(f"Asset must be a regular file: {relative}")
            data = source.read(member)
            if relative.startswith(f'models/{MODEL}/'):
                target = root / '.cache/fermion/speech/FermionResearch__Phonon-2' / relative.removeprefix('models/')
            else:
                target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)


def prepare_assets():
    archive = common.BUILD / 'downloads' / 'call-note-0.2.7-assets.zip'
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists() or checksum(archive) != ASSET_SHA256:
        temporary = archive.with_suffix('.partial')
        try:
            urllib.request.urlretrieve(ASSET_URL, temporary)
            if checksum(temporary) != ASSET_SHA256:
                raise RuntimeError('The Call Note asset archive failed its pinned SHA256 check.')
            temporary.replace(archive)
        finally:
            temporary.unlink(missing_ok=True)
    extract_assets(archive, common.ROOT)


def main():
    if sys.platform != 'win32' or platform.machine().lower() not in ('amd64', 'x86_64'):
        raise SystemExit('Build the Windows x64 release on Windows x64.')
    if sys.version_info[:2] != (3, 13):
        raise SystemExit('Build with Python 3.13.')
    common.BUILD.mkdir(parents=True, exist_ok=True)
    python = common.BUILD / 'python' / f'cpython-{common.PYTHON_VERSION}-windows-x86_64-none'
    if not (python / 'python.exe').is_file():
        subprocess.run(['uv', 'python', 'install', common.PYTHON_VERSION, '--install-dir', str(common.BUILD / 'python'), '--no-bin'], check=True)
    target = common.BUNDLE / 'python'
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(python, target, symlinks=False, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    executable = target / 'python.exe'
    subprocess.run(['uv', 'pip', 'install', '--python', str(executable), '--only-binary', ':all:', '-r', str(common.ROOT / 'requirements-windows.txt')], check=True)
    subprocess.run(['uv', 'pip', 'check', '--python', str(executable)], check=True)
    prepare_assets()
    common.prepare_service(architecture='x64', platform='win32')
    shutil.copy2(common.ROOT / 'requirements-windows.txt', common.BUNDLE / 'service/requirements-windows.txt')
    environment = {**os.environ, 'PYTHONNOUSERSITE': '1', 'FERMION_DEVICE': 'cpu'}
    subprocess.run([str(executable), '-I', '-B', str(common.ROOT / 'scripts/bundle_smoke.py'), str(common.BUNDLE / 'service')], env=environment, check=True)
    print('Windows CPU bundle prepared and offline smoke passed:', common.BUNDLE)


if __name__ == '__main__':
    main()
