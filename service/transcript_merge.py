"""Hold completed phrases until both audio sources can be compared locally."""
import re


class TranscriptMerge:
    def __init__(self, detector, dual_source, diagnostics):
        self.detector = detector
        self.dual_source = dual_source
        self.diagnostics = diagnostics
        self.pending = []
        self.dirty = False

    def add(self, segment):
        self.pending.append(segment)
        self.dirty = True

    def drain(self, watermark, force=False):
        suppressed = set()
        if self.dual_source and self.dirty:
            for index, segment in enumerate(self.pending):
                if segment['source'] != 'microphone':
                    continue
                for other in self.pending:
                    if other['source'] == 'system' and self.detector.duplicate(segment, other):
                        suppressed.add(index)
                        self.diagnostics.increment('echo_duplicates_suppressed')
                        break
        self.dirty = False
        ready, waiting = [], []
        for index, segment in enumerate(self.pending):
            if index in suppressed:
                continue
            short = len(re.findall(r"\w+", segment['text'])) < 5
            if force or not self.dual_source or short or segment['end'] <= watermark:
                ready.append(segment)
            else:
                waiting.append(segment)
        self.pending = waiting
        return sorted(ready, key=lambda segment: segment['start'])
