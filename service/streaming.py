"""Adapter for Fermion's official rolling partial/final decoder."""
import time


class LiveTranscriber:
    def __init__(self, model, hotwords, speakers=None, diagnostics=None):
        from fermion._speech.live import LiveSession

        self.speakers = speakers
        self.diagnostics = diagnostics or getattr(speakers, 'diagnostics', None)
        self.last_audio = None
        self.audio_base = 0.0
        self.model = model
        self.backend = model.describe().get("engine", "mlx") if hasattr(model, "describe") else None
        self.hotwords = hotwords
        self.decode_seconds = 0.0
        self.samples = 0
        self.events = []
        self.last_bounds = (0.0, 0.0)
        self.started = time.perf_counter()
        self.session = LiveSession(self, on_partial=self.partial, on_final=self.final)

    def transcribe_array(self, audio):
        import numpy as np
        # Estimate voiced phrase boundaries, excluding leading/trailing silence.
        blocks = [audio[i:i + 800] for i in range(0, len(audio), 800)]
        levels = np.asarray([np.sqrt(np.mean(block * block)) for block in blocks])
        voiced = np.flatnonzero(levels > max(0.004, 0.18 * float(levels.max(initial=0))))
        base = max(0, self.samples - len(audio)) / 16000
        self.last_audio = audio
        self.audio_base = base
        self.last_bounds = (base + voiced[0] * .05, base + min(len(audio), (voiced[-1] + 1) * 800) / 16000) if len(voiced) else (base, self.samples / 16000)
        result = self.model.transcribe_array(audio, hotwords=self.hotwords)
        self.decode_seconds += result[1]
        return result

    def partial(self, text):
        self.events.append({"type": "partial", "final_text": self.session.transcript, "text": text})

    def final(self, text):
        if self.diagnostics is not None:
            self.diagnostics.increment('streaming_finals')
        if self.speakers is not None:
            try:
                turns = self.speakers.transcribe(self.last_audio, self.model, self.hotwords, fallback=text)
                # Build the whole phrase before publishing any of its turns.
                # If a later turn is malformed (or a lazy result raises), do
                # not leave early speaker rows beside the fallback phrase.
                events = [
                    {**turn, "type": "final", "start": self.audio_base + turn["start"], "end": self.audio_base + turn["end"]}
                    for turn in turns
                ]
                self.events.extend(events)
                return
            except Exception:
                if self.diagnostics is not None:
                    self.diagnostics.increment('diarization_failures')
                self.events.append({"type": "warning", "message": "Speaker detection failed for a phrase. Its transcript is saved without a speaker label."})
        self.events.append({"type": "final", "final_text": self.session.transcript, "text": text, "start": float(self.last_bounds[0]), "end": float(self.last_bounds[1])})

    def feed(self, data):
        import numpy as np

        audio = np.frombuffer(data, dtype="<f4").copy()
        if not np.isfinite(audio).all() or (np.abs(audio) > 1.01).any():
            raise ValueError("Audio must contain finite float32 samples between -1 and 1.")
        self.samples += len(audio)
        self.session.feed(audio)
        if self.speakers is not None and any(event['type'] == 'partial' for event in self.events):
            # The pinned Fermion rolling decoder exposes no cadence option. Give
            # speaker inference room by spacing system-audio drafts one second apart.
            self.session._next_partial = self.session._samples + 16000
        events, self.events = self.events, []
        return events

    def finish(self):
        text = self.session.finish()
        duration = self.samples / 16000
        return dict(type="complete", mode="live", text=text, model="phonon-2", backend=self.backend,
                    audio_seconds=duration, decode_seconds=self.decode_seconds,
                    processing_seconds=self.decode_seconds, conversion_seconds=0,
                    session_seconds=time.perf_counter() - self.started,
                    speed_x=duration / self.decode_seconds if self.decode_seconds else 0,
                    words=None, segments=None, truncated=False)
