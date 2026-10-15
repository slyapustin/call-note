"""Optional local PCM recording; no network transport or analytics."""
import os
import re
import struct
import wave

RATE = 16000


def audio_path(directory, call_id):
    if not isinstance(call_id, str) or not re.fullmatch(r'[0-9a-f]{32}', call_id):
        raise KeyError('Call not found')
    return directory / 'recordings' / (call_id + '.wav')


def audio_info(directory, call_id):
    path = audio_path(directory, call_id)
    if not path.exists():
        return None
    try:
        with wave.open(str(path), 'rb') as audio:
            return {'seconds': audio.getnframes() / audio.getframerate(),
                    'channels': audio.getnchannels(), 'bytes': path.stat().st_size}
    except (OSError, EOFError, wave.Error):
        return None


class CallAudio:
    def __init__(self, directory, call_id, sources):
        self.path = audio_path(directory, call_id)
        self.path.parent.mkdir(mode=0o700, exist_ok=True)
        self.sources = [source for source in ('microphone', 'system') if source in sources]
        if not self.sources or len(self.sources) != len(sources):
            raise ValueError('Invalid recording sources')
        self.positions = {}
        self.frames = 0
        self.file = os.fdopen(os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600), 'w+b')
        self._header()

    def _header(self):
        channels = len(self.sources)
        size = self.frames * channels * 2
        self.file.seek(0)
        self.file.write(struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF', 36+size, b'WAVE', b'fmt ', 16,
                                    1, channels, RATE, RATE*channels*2, channels*2, 16, b'data', size))
        self.file.flush()

    def write(self, source, data, offset):
        import numpy as np
        samples = np.frombuffer(data, dtype='<f4')
        if not np.isfinite(samples).all():
            raise ValueError('Cannot save non-finite audio.')
        position = self.positions.get(source, max(0, round(offset * RATE)))
        if position + len(samples) > RATE * 4 * 3600:
            raise ValueError('Recording exceeds four hours.')
        channels = len(self.sources)
        count = len(samples) * channels * 2
        self.file.seek(44 + position * channels * 2)
        existing = self.file.read(count)
        block = np.frombuffer(existing.ljust(count, b'\0'), dtype='<i2').copy().reshape(-1, channels)
        block[:, self.sources.index(source)] = (np.clip(samples, -1, 1) * 32767).astype('<i2')
        self.file.seek(44 + position * channels * 2)
        self.file.write(block.tobytes())
        self.positions[source] = position + len(samples)
        self.frames = max(self.frames, self.positions[source])
        self._header()

    def close(self):
        self.file.close()
