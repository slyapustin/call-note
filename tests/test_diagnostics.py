import json
import numpy as np
from types import SimpleNamespace
from fastapi.testclient import TestClient

import call_app
from call_store import CallStore
from diarization import SpeakerDiagnostics, SpeakerSession
from streaming import LiveTranscriber


def test_speaker_diagnostics_count_outcomes_without_retaining_vectors():
    diagnostics = SpeakerDiagnostics()
    speakers = SpeakerSession(None, diagnostics)

    assert speakers.identify(np.array([1.0, 0.0])) == 1
    assert speakers.identify(np.array([0.99, 0.01])) == 1
    assert speakers.identify(np.array([0.5, 0.8660254])) is None
    assert diagnostics.snapshot() == {
        'processed_phrases': 0,
        'speaker_known_matches': 1,
        'speaker_new_identities': 1,
        'speaker_uncertain': 1,
        'diarization_failures': 0,
        'overlap_intervals': 0,
        'streaming_finals': 0,
        'echo_duplicates_suppressed': 0,
    }
    assert all(type(value) is int for value in diagnostics.snapshot().values())
    assert diagnostics.increment('speaker_new_identities', 2**40) is None
    assert diagnostics.snapshot()['speaker_new_identities'] == SpeakerDiagnostics.LIMIT


def test_phrase_and_overlap_counters_are_updated_during_speaker_processing():
    diagnostics = SpeakerDiagnostics()
    turns = [SimpleNamespace(start=0.0, end=4.0, speaker=0),
             SimpleNamespace(start=3.0, end=7.0, speaker=1)]
    vectors = iter([np.array([1.0, 0.0]), np.array([0.0, 1.0])])
    diarizer = SimpleNamespace(
        model=SimpleNamespace(process=lambda audio: SimpleNamespace(sort_by_start_time=lambda: turns)),
        embedding=lambda audio: next(vectors),
    )
    speakers = SpeakerSession(diarizer, diagnostics)
    result = speakers.turns(np.r_[np.zeros(4 * 16000), np.ones(3 * 16000)].astype('float32'))
    assert any(turn['speaker'] is None for turn in result)
    assert diagnostics.snapshot()['overlap_intervals'] == 1

    speakers.turns = lambda audio: []
    class Model:
        def transcribe_array(self, audio, hotwords):
            raise AssertionError('fallback phrase should avoid a model call')
    speakers.transcribe(np.zeros(16000, dtype='float32'), Model(), [], fallback='Fallback.')
    assert diagnostics.snapshot()['processed_phrases'] == 1


def test_diagnostics_endpoint_uses_existing_auth_and_returns_only_aggregate(monkeypatch):
    monkeypatch.setattr(call_app, 'TOKEN', 'diagnostics-token')
    monkeypatch.setattr(call_app, 'store', None)
    monkeypatch.setattr(call_app.engine, 'status', 'ready')
    monkeypatch.setattr(call_app, 'diarizer', None)
    monkeypatch.setattr(call_app, 'latest_diagnostics', SpeakerDiagnostics())
    monkeypatch.setattr(call_app, 'latest_has_call', False)
    call_app.latest_diagnostics.increment('processed_phrases', 3)

    client = TestClient(call_app.app)
    assert client.get('/api/diagnostics').status_code == 401
    response = client.get('/api/diagnostics', headers={'x-call-token': 'diagnostics-token'})
    assert response.status_code == 200
    body = response.json()
    assert body == {
        'scope': 'latest_call',
        'has_call': False,
        'counters': {
            'processed_phrases': 3,
            'speaker_known_matches': 0,
            'speaker_new_identities': 0,
            'speaker_uncertain': 0,
            'diarization_failures': 0,
            'overlap_intervals': 0,
            'streaming_finals': 0,
        'echo_duplicates_suppressed': 0,
        },
        'runtime': {'engine_status': 'ready', 'speaker_model_loaded': False},
    }
    assert not ({'text', 'audio', 'embedding', 'similarity', 'name', 'call_id'} & set(str(body).lower().split()))


def test_recording_resets_and_persists_only_valid_aggregate_counters(monkeypatch, tmp_path):
    old = SpeakerDiagnostics()
    old.increment('processed_phrases', 8)
    call_app.persist_diagnostics(tmp_path, old, True)
    path = tmp_path / call_app.DIAGNOSTICS_FILE
    payload = json.loads(path.read_text())
    payload.update({'text': 'must be dropped', 'call_id': 'private-id', 'embedding': [0.1, 0.2]})
    payload['counters']['unexpected'] = 'must be dropped'
    path.write_text(json.dumps(payload))

    loaded, has_call = call_app.load_diagnostics(tmp_path)
    assert has_call is True
    assert loaded.snapshot()['processed_phrases'] == 8
    assert set(loaded.snapshot()) == set(SpeakerDiagnostics.FIELDS)

    call_app.latest_diagnostics = loaded
    call_app.latest_has_call = has_call
    call_app.store = CallStore(tmp_path)
    monkeypatch.setattr(call_app, 'TOKEN', 'record-token')
    monkeypatch.setattr(call_app.engine, 'status', 'ready')
    monkeypatch.setattr(call_app.engine, 'busy', False)
    monkeypatch.setattr(call_app, 'speaker_session', lambda: None)

    class FakeLive:
        def __init__(self, *args):
            self.samples = 0
            self.events = []
        def finish(self):
            return {'text': ''}

    async def direct_engine_call(function, *args):
        return function(*args)

    monkeypatch.setattr(call_app, 'LiveTranscriber', FakeLive)
    monkeypatch.setattr(call_app, 'engine_call', direct_engine_call)
    client = TestClient(call_app.app, headers={'x-call-token': 'record-token'})
    with client.websocket_connect('/api/record', headers={'origin': 'http://testserver'}) as socket:
        socket.send_json({'token': 'record-token', 'sources': ['microphone']})
        assert socket.receive_json()['type'] == 'ready'
        socket.send_json({'type': 'stop'})
        assert socket.receive_json()['type'] == 'complete'

    # Loading the file again models a service recycle: the prior real call is
    # still known, and the new call's counters replaced the older snapshot.
    restarted, has_call = call_app.load_diagnostics(tmp_path)
    assert has_call is True
    assert restarted.snapshot() == dict.fromkeys(SpeakerDiagnostics.FIELDS, 0)
    saved = json.loads(path.read_text())
    assert set(saved) == {'has_call', 'counters'}
    assert set(saved['counters']) == set(SpeakerDiagnostics.FIELDS)
    assert 'text' not in saved and 'call_id' not in saved and 'embedding' not in saved
    assert path.stat().st_mode & 0o777 == 0o600


def test_sample_speaker_counters_do_not_change_latest_real_call(monkeypatch, tmp_path):
    import sys

    real_call = SpeakerDiagnostics()
    real_call.increment('processed_phrases', 4)
    call_app.latest_diagnostics = real_call
    monkeypatch.setitem(sys.modules, 'soundfile', SimpleNamespace(
        read=lambda path, dtype: (np.zeros(16000, dtype='float32'), 16000)))

    class SampleSpeakers:
        def __init__(self, diagnostics):
            self.diagnostics = diagnostics
        def transcribe(self, audio, model, hotwords):
            self.diagnostics.increment('processed_phrases')
            return []

    sampled = []
    monkeypatch.setattr(call_app, 'speaker_session', lambda diagnostics=None: sampled.append(
        SampleSpeakers(diagnostics)) or sampled[-1])
    result = call_app.transcribe_sample(tmp_path / 'sample.wav', [])
    assert result['segments'] == []
    assert real_call.snapshot()['processed_phrases'] == 4
    assert sampled[0].diagnostics is not real_call
    assert sampled[0].diagnostics.snapshot()['processed_phrases'] == 1


def test_streaming_diagnostics_count_final_and_diarization_failure():
    class Model:
        def transcribe_array(self, audio, hotwords):
            return 'Phrase.', 0.001, {}

    class BrokenSpeakers:
        def transcribe(self, *args, **kwargs):
            raise RuntimeError('private model detail')

    diagnostics = SpeakerDiagnostics()
    live = LiveTranscriber(Model(), [], BrokenSpeakers(), diagnostics)
    live.final('Phrase.')
    assert diagnostics.snapshot()['streaming_finals'] == 1
    assert diagnostics.snapshot()['diarization_failures'] == 1
    assert 'private model detail' not in str(diagnostics.snapshot())
