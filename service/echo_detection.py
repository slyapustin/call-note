"""Conservative, transient cross-source echo matching for final segments."""
import math
import re
from difflib import SequenceMatcher

import numpy as np
from scipy.signal import correlate


class EchoDetector:
    SAMPLE_RATE = 16000
    HISTORY_SECONDS = 90
    MAX_PHRASE_SECONDS = 20
    MAX_LAG_SECONDS = 0.25

    def __init__(self):
        self._capacity = self.SAMPLE_RATE * self.HISTORY_SECONDS
        self._audio = {}

    def add(self, source, data, offset):
        """Add mono little-endian float32 PCM at its global chunk-start time."""
        if source not in ('microphone', 'system'):
            raise ValueError('Invalid audio source')
        if not isinstance(offset, (int, float)) or not math.isfinite(offset) or offset < 0:
            raise ValueError('Invalid audio offset')
        if len(data) % 4:
            raise ValueError('Invalid float32 audio length')
        samples = np.frombuffer(data, dtype='<f4')
        if not len(samples):
            return
        start = round(offset * self.SAMPLE_RATE)
        end = start + len(samples)
        if source not in self._audio:
            self._audio[source] = (np.zeros(self._capacity, dtype=np.float32),
                                   np.zeros(self._capacity, dtype=bool), end)
        audio, valid, previous_end = self._audio[source]
        latest = max(end, previous_end)
        if latest > previous_end:
            cleared = np.arange(max(previous_end, latest - self._capacity), latest) % self._capacity
            valid[cleared] = False
        retained_start = max(start, latest - self._capacity)
        if retained_start < end:
            retained = samples[retained_start - start:]
            indices = np.arange(retained_start, end) % self._capacity
            finite = np.isfinite(retained)
            audio[indices] = np.where(finite, retained, 0)
            valid[indices] = finite
        self._audio[source] = (audio, valid, latest)

    def _read(self, source, start, end):
        if source not in self._audio:
            return None
        audio, valid, latest = self._audio[source]
        if start < max(0, latest - self._capacity) or end > latest or end <= start:
            return None
        indices = np.arange(start, end) % self._capacity
        if not valid[indices].all():
            return None
        return audio[indices].astype(np.float64)

    def duplicate(self, segment_a, segment_b):
        """Return true only when matching final text is backed by matching audio."""
        try:
            if {segment_a['source'], segment_b['source']} != {'microphone', 'system'}:
                return False
            times = [float(segment[key]) for segment in (segment_a, segment_b) for key in ('start', 'end')]
            if not all(math.isfinite(value) and value >= 0 for value in times):
                return False
            a_start, a_end, b_start, b_end = times
            durations = (a_end - a_start, b_end - b_start)
            if min(durations) <= 0 or max(durations) > self.MAX_PHRASE_SECONDS:
                return False
            start, end = max(a_start, b_start), min(a_end, b_end)
            if end - start < max(0.5, min(durations) / 2):
                return False
            words = [re.findall(r'\w+', segment['text'].casefold()) for segment in (segment_a, segment_b)]
            if min(map(len, words)) < 5 or SequenceMatcher(None, *words, autojunk=False).ratio() < 0.85:
                return False
            first, last = round(start * self.SAMPLE_RATE), round(end * self.SAMPLE_RATE)
            x = self._read(segment_a['source'], first, last)
            y = self._read(segment_b['source'], first, last)
        except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
            return False
        if x is None or y is None:
            return False
        length = len(x)
        lag = min(round(self.MAX_LAG_SECONDS * self.SAMPLE_RATE), length // 4)
        shifts = np.arange(-lag, lag + 1)
        x_start, y_start = np.maximum(shifts, 0), np.maximum(-shifts, 0)
        count = length - np.abs(shifts)
        sums_x, sums_y = np.r_[0., np.cumsum(x)], np.r_[0., np.cumsum(y)]
        squares_x, squares_y = np.r_[0., np.cumsum(x * x)], np.r_[0., np.cumsum(y * y)]
        sx = sums_x[x_start + count] - sums_x[x_start]
        sy = sums_y[y_start + count] - sums_y[y_start]
        energy_x = np.maximum(0, squares_x[x_start + count] - squares_x[x_start] - sx * sx / count)
        energy_y = np.maximum(0, squares_y[y_start + count] - squares_y[y_start] - sy * sy / count)
        usable = (energy_x / count > 1e-8) & (energy_y / count > 1e-8)
        if not usable.any():
            return False
        product = correlate(x, y, mode='full', method='fft')[length - 1 + shifts] - sx * sy / count
        score = np.abs(product[usable]) / np.sqrt(energy_x[usable] * energy_y[usable])
        return bool(np.any(score >= 0.92))
