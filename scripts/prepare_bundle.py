"""Build a relocatable service tree from the pinned, tested environment."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
BUILD=ROOT/'.build'
BUNDLE=BUILD/'bundle'
PYTHON_VERSION='3.13.16'

def main():
    if sys.version_info[:2] != (3, 13):raise SystemExit('Build with the Python 3.13 project environment.')
    if sys.platform!='darwin':raise SystemExit('Build the macOS release on a Mac.')
    python=BUILD/'python'/f'cpython-{PYTHON_VERSION}-macos-aarch64-none'
    if not python.exists():
        subprocess.run(['uv','python','install',PYTHON_VERSION,'--install-dir',str(BUILD/'python'),'--no-bin','--cache-dir',str(BUILD/'uv-cache')],check=True)
    BUNDLE.mkdir(parents=True,exist_ok=True)
    target=BUNDLE/'python'
    if target.exists():shutil.rmtree(target)
    shutil.copytree(python,target,symlinks=False,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    source=ROOT/'.venv/lib/python3.13/site-packages'
    packages=target/'lib/python3.13/site-packages'
    shutil.copytree(source,packages,dirs_exist_ok=True,symlinks=False,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    service=BUNDLE/'service'
    if service.exists():shutil.rmtree(service)
    service.mkdir()
    for name in ['app.py','call_app.py','call_store.py','call_mcp.py','streaming.py','connect_mcp.py','diarization.py']:
        shutil.copy2(ROOT/'service'/name,service/name)
    for name in ['static','desktop/ui','desktop/licenses']:
        shutil.copytree(ROOT/name,service/name)
    (service/'samples').mkdir()
    for name in ['long-clean.wav','long-expected.txt','meeting.wav','meeting-script.json']:
        shutil.copy2(ROOT/'samples'/name,service/'samples'/name)
    model=ROOT/'.cache/fermion/speech/FermionResearch__Phonon-2/model_phonon2_c4c_int6'
    shutil.copytree(model,service/'models'/model.name)
    (service/'models/diarization').mkdir()
    for name in ['segmentation.onnx','embedding.onnx']:
        shutil.copy2(ROOT/'models/diarization'/name, service/'models/diarization'/name)
    shutil.copy2(ROOT/'requirements.txt',service/'requirements.txt')
    manifest={'python':PYTHON_VERSION,'model_sha256':hashlib.sha256((model/'model.fermion').read_bytes()).hexdigest(),'architecture':'arm64','model_license':'CC-BY-4.0','runtime_license':'Apache-2.0'}
    (service/'bundle.json').write_text(json.dumps(manifest,indent=2)+'\n')
    # Check native linkage: a release must not require this machine's Homebrew.
    external=[]
    for path in target.rglob('*'):
        if path.is_symlink():
            if not path.resolve().is_relative_to(target.resolve()):external.append(str(path)+' -> '+str(path.resolve()))
            continue
        if not path.is_file() or path.suffix not in ('.so','.dylib') and path.name!='python3.13':continue
        result=subprocess.run(['/usr/bin/otool','-L',str(path)],capture_output=True,text=True)
        if result.returncode:continue
        identity=subprocess.run(['/usr/bin/otool','-D',str(path)],capture_output=True,text=True).stdout.splitlines()[1:]
        for line in result.stdout.splitlines()[1:]:
            if not line.startswith('\t'):continue
            dependency=line.strip().split(' (')[0]
            if dependency in identity:continue
            if dependency.startswith('/') and not dependency.startswith(('/usr/lib/','/System/Library/')):
                external.append(f'{path.relative_to(target)}: {dependency}')
    if external:raise SystemExit('Nonportable native dependencies:\n'+'\n'.join(external))
    print('Portable bundle prepared:',BUNDLE)

if __name__=='__main__':main()
