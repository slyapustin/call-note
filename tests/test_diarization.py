import sqlite3
from types import SimpleNamespace

import numpy as np
import pytest

from call_store import CallStore, transcript_markdown
from diarization import SpeakerSession
from streaming import LiveTranscriber


def test_speakers_persist_and_old_library_migrates(tmp_path):
    store = CallStore(tmp_path)
    call = store.create('Existing call')
    store.append(call['id'], 'system', 0, 2, 'Original text')
    with sqlite3.connect(store.path) as db:
        db.execute('ALTER TABLE segments DROP COLUMN speaker')
    store = CallStore(tmp_path)
    assert store.get(call['id'])['segments'][0]['text'] == 'Original text'
    backups = list((tmp_path / 'backups').glob('*.sqlite3'))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as db:
        assert db.execute('SELECT text FROM segments').fetchone()[0] == 'Original text'
        assert 'speaker' not in {row[1] for row in db.execute('PRAGMA table_info(segments)')}
    store.append(call['id'], 'system', 2, 4, 'Returning voice', speaker=2)
    saved = CallStore(tmp_path).get(call['id'])
    assert [s['speaker'] for s in saved['segments']] == [None, 2]
    assert 'Speaker 2 (segment' in transcript_markdown(saved)
    assert 'Others (segment' in transcript_markdown(saved)
    with pytest.raises(ValueError):
        store.append(call['id'], 'system', 4, 5, 'Bad label', speaker=0)


def test_identity_is_per_call_and_handles_unknowns():
    first = SpeakerSession(None)
    assert first.identify(np.array([1., 0.])) == 1
    assert first.identify(np.array([0., 1.])) == 2
    assert first.identify(np.array([.99, .01])) == 1
    assert first.identify(None) is None
    assert SpeakerSession(None).identify(np.array([0., 1.])) == 1


def test_live_splits_final_phrase_without_losing_timing():
    class Model:
        def transcribe_array(self, audio, hotwords):
            return ('First voice. Second voice.', .001, {})
    class Speakers:
        def transcribe(self, audio, model, hotwords, fallback):
            return [dict(start=.5, end=1., speaker=1, text='First voice.'),
                    dict(start=1., end=1.5, speaker=2, text='Second voice.')]
    live = LiveTranscriber(Model(), [], Speakers())
    events = []
    for value, count in [(0., 40), (.1, 20), (0., 24)]:
        for _ in range(count):
            events.extend(live.feed(np.full(800, value, dtype='<f4').tobytes()))
    finals = [e for e in events if e['type'] == 'final']
    assert [(e['speaker'], e['start'], e['end']) for e in finals] == [(1, 2., 2.5), (2, 2.5, 3.)]


def test_speaker_failure_keeps_transcription():
    class Model:
        def transcribe_array(self, audio, hotwords):
            return ('Keep these words.', .001, {})
    class Broken:
        def transcribe(self, *args, **kwargs):
            raise RuntimeError('Model failure')
    live = LiveTranscriber(Model(), [], Broken())
    live.feed(np.full(800, .1, dtype='<f4').tobytes())
    live.finish()
    assert live.events[-2]['type'] == 'warning'
    assert live.events[-1]['text'] == 'Keep these words.'
    assert 'speaker' not in live.events[-1]


def test_turns_merge_same_voice_but_keep_a_new_voice():
    turns = [SimpleNamespace(start=0., end=2., speaker=0),
             SimpleNamespace(start=2.2, end=4., speaker=0),
             SimpleNamespace(start=4.1, end=7., speaker=1)]
    result = SimpleNamespace(sort_by_start_time=lambda: turns)
    embeddings = iter([np.array([1., 0.]), np.array([0., 1.])])
    diarizer = SimpleNamespace(model=SimpleNamespace(process=lambda audio: result),
                              embedding=lambda audio: next(embeddings))
    assert SpeakerSession(diarizer).turns(np.zeros(16000*7, dtype='float32')) == [
        dict(start=0., end=4., speaker=1), dict(start=4.1, end=7., speaker=2)]


def test_transcription_padding_does_not_duplicate_neighbor_or_chunk_audio():
    audio = np.arange(16000*30, dtype='float32')
    session = SpeakerSession(None)
    session.turns = lambda _: [dict(start=1., end=27., speaker=1),
                               dict(start=27., end=29., speaker=2)]
    chunks = []
    class Model:
        def transcribe_array(self, chunk, hotwords):
            chunks.append(chunk)
            return ('Words.', .001, {})
    result = session.transcribe(audio, Model(), [])
    assert [row['speaker'] for row in result] == [1, 1, 2]
    expected = [(int(.95*16000), 26*16000), (26*16000, 27*16000),
                (27*16000, int(29.05*16000))]
    for chunk, (start, end) in zip(chunks, expected):
        np.testing.assert_array_equal(chunk, audio[start:end])


def test_short_or_ambiguous_phrase_cannot_invent_a_speaker():
    session = SpeakerSession(None)
    assert session.identify(np.array([1., 0.]), duration=1.2) is None
    assert session.voices == []
    assert session.identify(np.array([1., 0.]), duration=4.) == 1
    assert session.identify(np.array([0., 1.]), duration=1.2) is None
    assert session.identify(np.array([.5, .8660254]), duration=4.) is None
    assert len(session.voices) == 1
    assert session.identify(np.array([0., 1.]), duration=4.) == 2


def test_reference_adapts_only_on_clear_long_matches():
    session = SpeakerSession(None)
    session.identify(np.array([1., 0.]))
    before = session.voices[0].copy()
    assert session.identify(np.array([.8, .6]), duration=1.) == 1
    np.testing.assert_array_equal(session.voices[0], before)
    assert session.identify(np.array([.8, .6]), duration=4.) == 1
    assert session.voices[0][1] > 0
    assert np.linalg.norm(session.voices[0]) == pytest.approx(1.)
    assert session.identify(np.array([np.nan, 0.])) is None


def test_overlapping_turns_are_transcribed_once_with_uncertain_identity():
    turns = [SimpleNamespace(start=0., end=4., speaker=0),
             SimpleNamespace(start=3., end=7., speaker=1)]
    result = SimpleNamespace(sort_by_start_time=lambda: turns)
    embeddings = iter([np.array([1., 0.]), np.array([0., 1.])])
    diarizer = SimpleNamespace(model=SimpleNamespace(process=lambda audio: result),
                              embedding=lambda audio: next(embeddings))
    session = SpeakerSession(diarizer)
    assert session.turns(np.zeros(16000*7, dtype='float32')) == [
        dict(start=0., end=3., speaker=1),
        dict(start=3., end=4., speaker=None),
        dict(start=4., end=7., speaker=2)]


def test_ambiguous_match_between_established_voices_stays_unknown():
    session = SpeakerSession(None)
    session.identify(np.array([1., 0.]))
    session.identify(np.array([0., 1.]))
    assert session.identify(np.array([1., 1.]), duration=4.) is None
    assert len(session.voices) == 2
