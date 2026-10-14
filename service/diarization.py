"""Local speaker turns and per-call voice matching; no audio or voiceprints on disk."""
from pathlib import Path
import numpy as np

RATE = 16000


class Diarizer:
    def __init__(self, directory):
        import sherpa_onnx as s
        directory = Path(directory)
        embedding = s.SpeakerEmbeddingExtractorConfig(
            model=str(directory / 'embedding.onnx'), num_threads=2)
        config = s.OfflineSpeakerDiarizationConfig(
            segmentation=s.OfflineSpeakerSegmentationModelConfig(
                pyannote=s.OfflineSpeakerSegmentationPyannoteModelConfig(
                    model=str(directory / 'segmentation.onnx')), num_threads=2),
            embedding=embedding,
            clustering=s.FastClusteringConfig(num_clusters=-1, threshold=0.7),
            min_duration_on=0.5, min_duration_off=0.5)
        if not config.validate():
            raise RuntimeError('Speaker models are missing. Run scripts/download_speaker_models.py.')
        self.model = s.OfflineSpeakerDiarization(config)
        self.extractor = s.SpeakerEmbeddingExtractor(embedding)

    def embedding(self, audio):
        stream = self.extractor.create_stream()
        stream.accept_waveform(RATE, audio)
        stream.input_finished()
        if not self.extractor.is_ready(stream):
            return None
        vector = np.asarray(self.extractor.compute(stream), dtype=np.float32)
        norm = np.linalg.norm(vector)
        return vector / norm if norm > 0 and np.isfinite(vector).all() else None


class SpeakerSession:
    def __init__(self, diarizer):
        self.diarizer = diarizer
        self.voices = []

    def identify(self, vector):
        if vector is None:
            return None
        similarities = [float(np.dot(vector, voice)) for voice in self.voices]
        if similarities and max(similarities) >= 0.55:
            return similarities.index(max(similarities)) + 1
        # Bound memory even on unusually noisy, long recordings.
        if len(self.voices) >= 32:
            return None
        self.voices.append(vector)
        return len(self.voices)

    def turns(self, audio):
        if len(audio) < RATE * 0.5:
            return []
        raw = self.diarizer.model.process(audio).sort_by_start_time()
        groups = {}
        for turn in raw:
            groups.setdefault(turn.speaker, []).append(audio[int(turn.start*RATE):int(turn.end*RATE)])
        labels = {}
        for key, pieces in groups.items():
            voice_audio = np.concatenate(pieces)
            labels[key] = self.identify(self.diarizer.embedding(voice_audio)) if len(voice_audio) >= RATE else None
        result = []
        for turn in raw:
            speaker = labels[turn.speaker]
            start, end = max(0., float(turn.start)), min(len(audio)/RATE, float(turn.end))
            if end <= start:
                continue
            if result and result[-1]['speaker'] == speaker and start - result[-1]['end'] < 0.8:
                result[-1]['end'] = max(end, result[-1]['end'])
            else:
                result.append(dict(start=start, end=end, speaker=speaker))
        return result

    def transcribe(self, audio, model, hotwords, fallback=None):
        turns = self.turns(audio)
        if not turns:
            text = fallback if fallback is not None else model.transcribe_array(audio, hotwords=hotwords)[0]
            return [dict(start=0., end=len(audio)/RATE, speaker=None, text=text)] if text else []
        if len(turns) == 1 and fallback is not None:
            return [{**turns[0], 'text': fallback}]
        result = []
        for index, turn in enumerate(turns):
            start, end = turn['start'], turn['end']
            previous_end = turns[index-1]['end'] if index else 0.
            next_start = turns[index+1]['start'] if index+1 < len(turns) else len(audio)/RATE
            # Pad only into gaps, not neighboring speech or artificial chunk cuts.
            padded_start = max(0., start-.05, min(start, previous_end))
            padded_end = min(len(audio)/RATE, end+.05, max(end, next_start))
            for offset in np.arange(start, end, 25.):
                stop = min(float(offset)+25., end)
                left = padded_start if offset == start else float(offset)
                right = padded_end if stop == end else stop
                chunk = audio[int(left*RATE):int(right*RATE)]
                text = model.transcribe_array(chunk, hotwords=hotwords)[0]
                if text.strip():
                    result.append(dict(start=float(offset), end=stop, speaker=turn['speaker'], text=text))
        if not result and fallback:
            return [dict(start=0., end=len(audio)/RATE, speaker=None, text=fallback)]
        return result
