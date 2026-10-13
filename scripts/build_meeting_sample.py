"""Build a local three-voice meeting fixture with known turn boundaries."""
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / 'samples'


def main():
    turns = json.loads((SAMPLES / 'meeting-script.json').read_text())
    audio, boundaries, position = [], [], 0
    with tempfile.TemporaryDirectory(prefix='call-note-sample-') as directory:
        temporary = Path(directory)
        for index, turn in enumerate(turns):
            source, wav = temporary / f'{index}.aiff', temporary / f'{index}.wav'
            subprocess.run(['say', '-v', turn['voice'], '-r', str(turn['rate']), '-o', str(source), turn['text']], check=True)
            subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source), '-ar', '16000', '-ac', '1', str(wav)], check=True)
            speech, rate = sf.read(wav)
            if rate != 16000 or len(speech) < 16000 or np.max(np.abs(speech)) < .01:
                raise RuntimeError(f"Voice {turn['voice']} produced no usable speech; run outside the sandbox.")
            speech *= .85 / np.max(np.abs(speech))
            boundaries.append({**turn, 'start':position / rate, 'end':(position + len(speech)) / rate})
            gap = np.zeros(5600)
            audio.extend([speech, gap])
            position += len(speech) + len(gap)
    sf.write(SAMPLES / 'meeting.wav', np.concatenate(audio), 16000, subtype='PCM_16')
    (SAMPLES / 'meeting-turns.json').write_text(json.dumps(boundaries, indent=2) + '\n')
    print(f'Three-voice meeting: {position / 16000:.1f}s; {len(turns)} turns; Samantha, Alex, Daniel')


if __name__ == '__main__':
    main()
