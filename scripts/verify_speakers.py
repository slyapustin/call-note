"""Verify real speaker models against bundled audio, optionally through live decoding."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_MEETING = [1, 2, 3, 1, 2, 3, 1, 3, 2, 1]
RATE = 16000


def normalized_speakers(turns, *, collapse=False):
    identities = {}
    sequence = []
    for turn in turns:
        speaker = turn.get("speaker")
        if speaker is None:
            raise AssertionError("A detected turn has no speaker label.")
        normalized = identities.setdefault(speaker, len(identities) + 1)
        if not collapse or not sequence or sequence[-1] != normalized:
            sequence.append(normalized)
    return sequence


def load_audio(path):
    import numpy as np
    import soundfile as sf

    audio, rate = sf.read(path, dtype="float32")
    if rate != RATE or audio.ndim != 1 or not len(audio):
        raise ValueError(f"Expected nonempty mono 16 kHz audio: {path}")
    if not np.isfinite(audio).all() or (np.abs(audio) > 1.01).any():
        raise ValueError(f"Audio contains invalid samples: {path}")
    return audio


def verify_batch(diarizer, name, audio):
    from diarization import SpeakerSession

    started = time.perf_counter()
    turns = SpeakerSession(diarizer).turns(audio)
    elapsed = time.perf_counter() - started
    sequence = normalized_speakers(turns)
    if name == "meeting":
        assert sequence == EXPECTED_MEETING, f"Meeting speaker sequence: {sequence}"
    else:
        assert set(sequence) == {1}, f"Solo sample speaker sequence: {sequence}"
    return {
        "sample": name,
        "turns": len(turns),
        "speaker_sequence": sequence,
        "audio_seconds": len(audio) / RATE,
        "processing_seconds": round(elapsed, 3),
    }


def verify_chunks(diarizer, name, audio):
    from diarization import SpeakerSession

    session = SpeakerSession(diarizer)
    labels = []
    for offset in range(0, len(audio), RATE * 3):
        labels.extend(turn['speaker'] for turn in session.turns(audio[offset:offset + RATE * 3]))
    expected = 3 if name == 'meeting' else 1
    assert len(session.voices) == expected, f'{name}: {len(session.voices)} identities in short chunks'
    return {'sample': name, 'window_seconds': 3, 'identities': len(session.voices),
            'turns': len(labels), 'uncertain_turns': labels.count(None)}


def verify_stream(diarizer, audio):
    from app import Engine
    from diarization import SpeakerSession
    from streaming import LiveTranscriber

    engine = Engine()

    def run():
        engine.load()
        if engine.status != "ready":
            raise RuntimeError(f"Phonon could not load: {engine.error}")
        transcriber = LiveTranscriber(engine.model, [], SpeakerSession(diarizer))
        events = []
        started = time.perf_counter()
        for offset in range(0, len(audio), 800):
            events.extend(transcriber.feed(audio[offset:offset + 800].astype("<f4").tobytes()))
        transcriber.finish()
        events.extend(transcriber.events)
        elapsed = time.perf_counter() - started
        warnings = [event for event in events if event["type"] == "warning"]
        assert not warnings, f"Streaming speaker warnings: {warnings}"
        turns = [event for event in events if event["type"] == "final"]
        sequence = normalized_speakers(turns, collapse=True)
        assert set(sequence) == {1, 2, 3}, f"Streaming identities: {sequence}"
        assert sequence == EXPECTED_MEETING, f"Streaming speaker sequence: {sequence}"
        return {
            "sample": "meeting",
            "final_segments": len(turns),
            "speaker_sequence": sequence,
            "audio_seconds": len(audio) / RATE,
            "processing_seconds": round(elapsed, 3),
            "warnings": len(warnings),
            "model_load_seconds": engine.load_seconds,
        }

    try:
        return engine.pool.submit(run).result()
    finally:
        engine.pool.shutdown(wait=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--stream", action="store_true",
        help="Also load Phonon-2 and verify speaker identity through the rolling live decoder.",
    )
    parser.add_argument('--chunks', action='store_true', help='Verify identities across independent three-second chunks.')
    args = parser.parse_args()
    sys.path.insert(0, str(ROOT / "service"))
    from diarization import Diarizer

    diarizer = Diarizer(ROOT / "models/diarization")
    meeting = load_audio(ROOT / "samples/meeting.wav")
    briefing = load_audio(ROOT / "samples/long-clean.wav")
    report = {"batch": [
        verify_batch(diarizer, "meeting", meeting),
        verify_batch(diarizer, "briefing", briefing),
    ]}
    if args.chunks:
        report['chunks'] = [verify_chunks(diarizer, 'meeting', meeting), verify_chunks(diarizer, 'briefing', briefing)]
    if args.stream:
        report["stream"] = verify_stream(diarizer, meeting)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
