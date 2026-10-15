import numpy as np

from streaming import LiveTranscriber


class Model:
    def transcribe_array(self, audio, hotwords):
        return "And um", 0.001, {}


def test_live_session_finalizes_once_and_keeps_repeated_phrases():
    live = LiveTranscriber(Model(), [])
    events = []

    def phrase():
        for value, count in [(0.1, 20), (0.0, 15)]:
            for _ in range(count):
                events.extend(live.feed(np.full(800, value, dtype="<f4").tobytes()))

    phrase()
    live.finish()
    events.extend(live.events)
    live.events = []
    phrase()
    live.finish()
    events.extend(live.events)

    finals = [event for event in events if event["type"] == "final"]
    assert [event["text"] for event in finals] == ["And um", "And um"]
    assert finals[0]["start"] < finals[1]["start"]


def test_failed_late_speaker_turn_does_not_publish_partial_phrase():
    class Speakers:
        def transcribe(self, *args, **kwargs):
            # Models a lazy or malformed result that fails after one valid turn.
            return [
                {"start": 0.0, "end": 0.4, "speaker": 3, "text": "And um"},
                {"end": 0.8, "speaker": None, "text": "And um"},
            ]

    live = LiveTranscriber(Model(), [], Speakers())
    live.last_audio = np.ones(16000, dtype="float32")
    live.audio_base = 10.0
    live.last_bounds = (10.0, 11.0)
    live.final("And um")

    finals = [event for event in live.events if event["type"] == "final"]
    assert len(finals) == 1
    assert finals[0]["text"] == "And um"
    assert "speaker" not in finals[0]
    assert [event["type"] for event in live.events] == ["warning", "final"]


def test_finite_capture_peaks_are_limited_without_interrupting_stream():
    live = LiveTranscriber(Model(), [])
    received = []
    live.session.feed = lambda audio: received.append(audio.copy())
    live.feed(np.array([1.02, -1.2, 0.25, 0.0], dtype='<f4').tobytes())
    live.feed(np.array([0.1], dtype='<f4').tobytes())
    np.testing.assert_array_equal(received[0], [1.0, -1.0, 0.25, 0.0])
    assert live.samples == 5
    assert len(received) == 2


def test_nonfinite_capture_is_rejected_before_decoder():
    import pytest
    from streaming import InvalidAudioError
    for value in [float('nan'), float('inf'), -float('inf')]:
        live = LiveTranscriber(Model(), [])
        live.session.feed = lambda audio: pytest.fail('Invalid audio reached decoder')
        with pytest.raises(InvalidAudioError):
            live.feed(np.array([value], dtype='<f4').tobytes())
        assert live.samples == 0
