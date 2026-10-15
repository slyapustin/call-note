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


class CountingModel:
    def __init__(self):
        self.audio = []

    def transcribe_array(self, audio, hotwords):
        self.audio.append(audio.copy())
        return "A complete phrase", .001, {}


def feed_seconds(live, seconds, value):
    events = []
    for _ in range(round(seconds * 20)):
        events.extend(live.feed(np.full(800, value, dtype='<f4').tobytes()))
    return events


def test_complete_phrase_waits_for_pause_without_partial_inference():
    model = CountingModel()
    live = LiveTranscriber(model, [])
    assert feed_seconds(live, 2., .1) == []
    assert feed_seconds(live, 1.15, 0.) == []
    assert not model.audio
    finals = feed_seconds(live, .05, 0.)
    assert [event['type'] for event in finals] == ['final']
    assert len(model.audio) == 1
    assert len(model.audio[0]) == 51200
    assert finals[0]['start'] == 0.
    assert finals[0]['end'] == 2.
    live.finish()
    assert len(model.audio) == 1


def test_long_monologue_cap_and_stop_preserve_every_sample_and_offset():
    model = CountingModel()
    live = LiveTranscriber(model, [])
    # One unusually large feed also exercises timestamps for internal cuts.
    audio = np.full(41 * 16000, .1, dtype='<f4')
    events = live.feed(audio.tobytes())
    live.finish()
    events.extend(live.events)
    assert [(event['start'], event['end']) for event in events] == [(0.,20.),(20.,40.),(40.,41.)]
    assert [len(block) for block in model.audio] == [320000,320000,16000]
    np.testing.assert_array_equal(np.concatenate(model.audio), audio)
    assert live.settled_seconds == 41.
    live.events = []
    live.finish()
    assert live.events == []
    assert len(model.audio) == 3


def test_idle_preroll_is_bounded_and_preserves_absolute_phrase_time():
    model = CountingModel()
    live = LiveTranscriber(model, [])
    feed_seconds(live, 65., 0.)
    assert not model.audio
    assert live.session._samples == 8000
    assert sum(len(block) for block in live.session._blocks) == 8000
    assert live.settled_seconds == 64.5
    feed_seconds(live, 1., .1)
    assert live.settled_seconds == 64.5
    live.finish()
    assert len(model.audio[0]) == 24000
    assert live.events[0]['start'] == 65.
    assert live.events[0]['end'] == 66.
    assert live.settled_seconds == 66.


def test_repeated_complete_phrases_remain_separate_after_silence():
    model = CountingModel()
    live = LiveTranscriber(model, [])
    finals = []
    for _ in range(2):
        finals.extend(feed_seconds(live, 1., .1))
        finals.extend(feed_seconds(live, 1.2, 0.))
    assert len(finals) == 2
    assert finals[0]['text'] == finals[1]['text']
    assert finals[0]['end'] < finals[1]['start']
    assert live.session.transcript == 'A complete phrase A complete phrase'



def test_short_pause_keeps_context_together_and_idle_stop_never_decodes():
    model = CountingModel()
    live = LiveTranscriber(model, [])
    feed_seconds(live, 3., 0.)
    live.finish()
    assert model.audio == []
    assert live.settled_seconds == 3.
    feed_seconds(live, 1., .1)
    feed_seconds(live, .8, 0.)
    feed_seconds(live, 1., .1)
    assert model.audio == []
    live.finish()
    assert len(model.audio) == 1
    assert len(model.audio[0]) == 44800
    assert live.events[0]['start'] == 3.
    assert live.events[0]['end'] == 5.8
