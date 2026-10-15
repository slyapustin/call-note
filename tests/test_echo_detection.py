import numpy as np
import pytest

from service.echo_detection import EchoDetector


RATE = 16000
TEXT = 'We should review the final launch checklist tomorrow morning'


def segment(source, start=0, end=2, text=TEXT):
    return {'source': source, 'start': start, 'end': end, 'text': text}


def pcm(seed=1, seconds=2):
    return (np.random.default_rng(seed).normal(size=round(seconds * RATE)) * 0.1).astype('<f4')


def populated(first, second, offset=0):
    detector = EchoDetector()
    detector.add('system', first.tobytes(), offset)
    detector.add('microphone', second.tobytes(), offset)
    return detector


@pytest.mark.parametrize('delay,scale', [(0, 0.3), (0.12, 0.25), (0.25, 0.6), (-0.2, -0.4)])
def test_delayed_scaled_echo_requires_audio_match(delay, scale):
    original = pcm(seconds=3)
    shifted = np.zeros_like(original)
    samples = round(abs(delay) * RATE)
    if samples == 0:
        shifted[:] = original * scale
    elif delay > 0:
        shifted[samples:] = original[:-samples] * scale
    else:
        shifted[:-samples] = original[samples:] * scale
    detector = populated(original, shifted, offset=12)
    a, b = segment('system', 12, 15), segment('microphone', 12, 15)
    assert detector.duplicate(a, b)
    assert detector.duplicate(b, a)


def test_text_alone_independent_speech_and_silence_do_not_match():
    a, b = segment('system'), segment('microphone')
    assert not EchoDetector().duplicate(a, b)
    assert not populated(pcm(1), pcm(2)).duplicate(a, b)
    assert not populated(np.zeros(2 * RATE), np.zeros(2 * RATE)).duplicate(a, b)
    assert not populated(pcm(), np.full(2 * RATE, 0.1, dtype='<f4')).duplicate(a, b)


def test_echo_with_quiet_background_noise_matches_but_mixed_speech_does_not():
    audio, other_speech = pcm(1), pcm(2)
    assert populated(audio, 0.3 * audio + 0.02 * other_speech).duplicate(segment('system'), segment('microphone'))
    assert not populated(audio, 0.3 * audio + 0.4 * other_speech).duplicate(segment('system'), segment('microphone'))


def test_short_replies_different_text_and_sequential_repetition_are_preserved():
    audio = pcm(seconds=4)
    detector = populated(audio, audio)
    assert not detector.duplicate(segment('system', text='Yes that sounds good'), segment('microphone', text='Yes that sounds good'))
    assert not detector.duplicate(segment('system'), segment('microphone', text='We need something entirely different from this proposal'))
    assert not detector.duplicate(segment('system'), segment('microphone', start=2, end=4))
    assert not detector.duplicate(segment('system'), segment('system'))


def test_small_transcription_variation_and_chunk_global_offsets():
    detector = EchoDetector()
    audio = pcm()
    for source in ('system', 'microphone'):
        detector.add(source, audio[:RATE].tobytes(), 8)
        detector.add(source, audio[RATE:].tobytes(), 9)
    assert detector.duplicate(segment('system', 8, 10), segment('microphone', 8, 10, TEXT.replace('final', 'full')))
    assert not detector.duplicate(segment('system', 0, 2), segment('microphone', 0, 2))


def test_missing_chunks_nonfinite_audio_and_expired_history_do_not_match():
    audio = pcm()
    detector = populated(audio, audio)
    for source in ('system', 'microphone'):
        detector.add(source, audio.tobytes(), 3)
    assert not detector.duplicate(segment('system', 1, 4), segment('microphone', 1, 4))
    for source in ('system', 'microphone'):
        detector.add(source, audio.tobytes(), 100)
    assert not detector.duplicate(segment('system'), segment('microphone'))
    assert detector.duplicate(segment('system', 100, 102), segment('microphone', 100, 102))
    audio[100] = np.nan
    assert not populated(audio, audio).duplicate(segment('system'), segment('microphone'))


def test_memory_is_bounded_and_old_chunks_cannot_restore_expired_audio():
    audio = pcm(seconds=100)
    detector = populated(audio, audio)
    for samples, valid, latest in detector._audio.values():
        assert samples.size == valid.size == 90 * RATE
        assert latest == 100 * RATE
    detector.add('system', pcm().tobytes(), 0)
    assert not detector.duplicate(segment('system'), segment('microphone'))
    assert detector.duplicate(segment('system', 98, 100), segment('microphone', 98, 100))
    assert not detector.duplicate(segment('system', 70, 100), segment('microphone', 70, 100))


def test_lag_outside_limit_and_tiny_timestamp_overlap_are_rejected():
    audio = pcm(seconds=3)
    shifted = np.zeros_like(audio)
    shifted[RATE // 2:] = audio[:-RATE // 2]
    assert not populated(audio, shifted).duplicate(segment('system', 0, 3), segment('microphone', 0, 3))
    assert not populated(audio, audio).duplicate(segment('system', 0, 2), segment('microphone', 1.9, 3))
