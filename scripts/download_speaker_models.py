"""Fetch the public sherpa-onnx speaker models and verify their pinned hashes."""
import hashlib
from pathlib import Path
import tarfile
import tempfile
from urllib.request import urlretrieve

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/'
MODELS = {
    'segmentation.onnx': ('speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2',
                          '220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079'),
    'embedding.onnx': ('speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx',
                       '1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b'),
}


def main():
    directory = ROOT / 'models/diarization'
    directory.mkdir(parents=True, exist_ok=True)
    for name, (url, checksum) in MODELS.items():
        target = directory / name
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == checksum:
            print(f'{name}: verified')
            continue
        with tempfile.TemporaryDirectory(dir=directory) as temporary:
            download = Path(temporary) / 'download'
            urlretrieve(BASE + url, download)
            if name == 'segmentation.onnx':
                with tarfile.open(download) as archive:
                    with archive.extractfile('sherpa-onnx-pyannote-segmentation-3-0/model.onnx') as stream:
                        data = stream.read()
            else:
                data = download.read_bytes()
            if hashlib.sha256(data).hexdigest() != checksum:
                raise RuntimeError(f'Integrity check failed for {name}')
            ready = Path(temporary) / name
            ready.write_bytes(data)
            ready.replace(target)
            print(f'{name}: downloaded and verified')


if __name__ == '__main__':
    main()
