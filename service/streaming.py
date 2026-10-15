"""Bounded phrase decoding with complete context instead of rolling drafts."""
import time


class InvalidAudioError(ValueError):
    pass


class PhraseSession:
    """Keep short idle pre-roll; decode once at a pause, cap, or explicit stop."""
    RATE = 16000
    SILENCE_SAMPLES = 19200  # 1.2 seconds
    MAX_SAMPLES = 320000  # 20 seconds
    PREROLL_SAMPLES = 8000  # Half a second

    def __init__(self, speech, on_final):
        self.speech = speech
        self.on_final = on_final
        self.finals = []
        self.total_samples = 0
        self._reset()

    def _reset(self):
        from collections import deque
        self._blocks = deque()
        self._samples = 0
        self._voiced = False
        self._last_voice = 0
        self._peak_rms = 0.

    def feed(self, audio):
        import numpy as np
        cursor = 0
        while cursor < len(audio):
            count = min(800, len(audio) - cursor, self.MAX_SAMPLES - self._samples)
            block = audio[cursor:cursor + count].copy()
            cursor += count
            self.total_samples += count
            self._blocks.append(block)
            self._samples += count
            rms = float(np.sqrt(np.mean(block * block)))
            self._peak_rms = max(self._peak_rms, rms)
            if rms > max(.004, .18 * self._peak_rms):
                self._voiced = True
                self._last_voice = self._samples
            if self._voiced:
                if (self._samples - self._last_voice >= self.SILENCE_SAMPLES
                        or self._samples >= self.MAX_SAMPLES):
                    self._finalize()
            else:
                # Discard only known idle audio, without moving the clock.
                excess = self._samples - self.PREROLL_SAMPLES
                while excess > 0:
                    first = self._blocks.popleft()
                    removed = min(excess, len(first))
                    if removed < len(first):
                        self._blocks.appendleft(first[removed:].copy())
                    self._samples -= removed
                    excess -= removed

    def _finalize(self):
        import numpy as np
        audio = np.concatenate(self._blocks)
        # Reset before inference so a failing decode cannot be retried at stop.
        self._reset()
        text, _, _ = self.speech.transcribe_array(audio)
        text = text.strip()
        if text:
            self.finals.append(text)
            self.on_final(text)

    def finish(self):
        if self._voiced:
            self._finalize()
        else:
            self._reset()
        return self.transcript

    @property
    def transcript(self):
        return " ".join(self.finals)


class LiveTranscriber:
    def __init__(self, model, hotwords, speakers=None, diagnostics=None):
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
        self.session = PhraseSession(self, on_final=self.final)

    @property
    def settled_seconds(self):
        # Pending pre-roll can still appear in a future diarized turn. Keep it
        # behind the watermark even when the buffer has not detected speech.
        return (self.session.total_samples - self.session._samples) / 16000

    def transcribe_array(self, audio):
        import numpy as np
        # Estimate voiced phrase boundaries, excluding leading/trailing silence.
        blocks = [audio[i:i + 800] for i in range(0, len(audio), 800)]
        levels = np.asarray([np.sqrt(np.mean(block * block)) for block in blocks])
        voiced = np.flatnonzero(levels > max(0.004, 0.18 * float(levels.max(initial=0))))
        end_samples = self.session.total_samples
        base = max(0, end_samples - len(audio)) / 16000
        self.last_audio = audio
        self.audio_base = base
        self.last_bounds = (base + voiced[0] * .05, base + min(len(audio), (voiced[-1] + 1) * 800) / 16000) if len(voiced) else (base, end_samples / 16000)
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
        if not np.isfinite(audio).all():
            raise InvalidAudioError("Audio must contain finite float32 samples.")
        # Float capture and resampling can overshoot full scale. Limit peaks
        # before inference instead of ending an otherwise valid recording.
        np.clip(audio, -1.0, 1.0, out=audio)
        self.samples += len(audio)
        self.session.feed(audio)
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
