import asyncio
import os
from pathlib import Path
import struct
import sys

from fastapi.testclient import TestClient
from mcp import Client, StdioServerParameters
import pytest

import call_app
from call_store import CallStore, transcript_markdown


def test_library_persistence_search_and_analysis(tmp_path):
    store = CallStore(tmp_path)
    call = store.create('Planning 100%')
    store.append(call['id'], 'system', 1, 4, 'Alice will send the proposal on Friday.')
    store.append(call['id'], 'microphone', 0, 1, 'Let us agree next steps.')
    store.update(call['id'], notes='Budget_2026')
    store.save_analysis(call['id'], 'Decision one', 'Codex')
    store.save_analysis(call['id'], 'Decision two', 'Claude')
    store.finish(call['id'], 5)
    reopened = CallStore(tmp_path)
    assert len(reopened.list('100%')) == 1
    assert not reopened.list('101%')
    assert len(reopened.list('Budget_')) == 1
    assert len(reopened.list('proposal')) == 1
    assert len(reopened.list("' OR 1=1 --")) == 0
    saved = reopened.get(call['id'])
    assert saved['segments'][0]['source'] == 'microphone'
    assert len(saved['analyses']) == 2
    assert 'Others (segment' in transcript_markdown(saved)
    store.archive(call['id'])
    assert store.list() == []
    with pytest.raises(KeyError): store.get(call['id'])


def test_recover_marks_interrupted(tmp_path):
    store = CallStore(tmp_path)
    call = store.create('Interrupted')
    store.append(call['id'], 'microphone', 0, 3, 'Keep this text.')
    store.recover()
    assert store.get(call['id'])['status'] == 'interrupted'
    assert store.get(call['id'])['segments'][0]['text'] == 'Keep this text.'


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(call_app, 'store', CallStore(tmp_path))
    monkeypatch.setattr(call_app, 'TOKEN', 'test-token')
    monkeypatch.setattr(call_app.engine, 'status', 'ready')
    monkeypatch.setattr(call_app.engine, 'busy', False)
    monkeypatch.setattr(call_app, 'speaker_session', lambda: None)
    return TestClient(call_app.app, headers={'x-call-token': 'test-token'})


def test_auth_and_origin(client):
    assert client.get('/api/calls', headers={'x-call-token':''}).status_code == 401
    assert client.post('/api/demo', headers={'origin':'https://evil.example'}).status_code == 403
    assert client.get('/api/calls/missing').status_code == 404


def test_samples_keep_distinct_playback_and_preserve_original(client, monkeypatch, tmp_path):
    samples = tmp_path / 'samples'
    samples.mkdir()
    (samples / 'long-clean.wav').write_bytes(b'briefing audio')
    (samples / 'meeting.wav').write_bytes(b'meeting audio')
    monkeypatch.setattr(call_app, 'ROOT', tmp_path)
    decoded = []
    async def transcribe(function, path, hotwords):
        decoded.append(path.name)
        return {'audio_seconds':120, 'segments':[{'start':0, 'end':120, 'speaker':1, 'text':'Three people discuss next steps.'}]}
    monkeypatch.setattr(call_app, 'engine_call', transcribe)
    original = client.post('/api/demo').json()
    meeting = client.post('/api/demo?sample=meeting').json()
    assert decoded == ['long-clean.wav', 'meeting.wav']
    assert original['source'] == 'sample'
    assert meeting['source'] == 'sample-multiparty'
    assert meeting['segments'][0]['source'] == 'sample'
    assert meeting['status'] == 'complete'
    assert not call_app.engine.busy
    assert client.get('/api/demo/audio').content == b'briefing audio'
    assert client.get('/api/demo/audio?sample=meeting').content == b'meeting audio'
    assert client.post('/api/demo?sample=unknown').status_code == 422
    assert client.get('/api/demo/audio?sample=../calls.sqlite3').status_code == 422
    assert client.get('/api/demo/audio?sample=meeting', headers={'x-call-token':''}).status_code == 401


class FakeLive:
    def __init__(self, *_):
        self.samples=0
        self.events=[]
        self.finished=False
    def feed(self, data):
        self.samples += len(data)//4
        return [{'type':'partial','text':'Draft'}, {'type':'final','text':'Saved phrase'}]
    def finish(self):
        if not self.finished:
            self.events.append({'type':'final','text':'Last phrase'})
        self.finished=True
        return {'text':'Saved phrase Last phrase'}


def test_dual_stream_persistence_and_flush(client, monkeypatch):
    monkeypatch.setattr(call_app, 'LiveTranscriber', FakeLive)
    with client.websocket_connect('/api/record', headers={'origin':'http://testserver'}) as ws:
        ws.send_json({'token':'test-token','sources':['microphone','system'],'title':'Two sides'})
        call_id=ws.receive_json()['call']['id']
        for channel in (0,1):
            ws.send_bytes(bytes([channel])+struct.pack('<800f',*([.1]*800)))
            assert ws.receive_json()['type']=='partial'
            assert ws.receive_json()['type']=='segment'
        assert len(client.get('/api/calls/'+call_id).json()['segments'])==2
        ws.send_json({'type':'stop'})
        assert ws.receive_json()['type']=='segment'
        assert ws.receive_json()['type']=='segment'
        saved=ws.receive_json()['call']
        assert saved['status']=='complete'
        assert len(saved['segments'])==4
    assert not call_app.engine.busy


@pytest.mark.parametrize('sources', [['microphone'], ['system'], ['microphone', 'system']])
def test_missing_speaker_model_preserves_recording(client, monkeypatch, sources):
    attempts = []
    def unavailable():
        attempts.append(True)
        raise RuntimeError('Speaker model cannot load')
    monkeypatch.setattr(call_app, 'speaker_session', unavailable)
    monkeypatch.setattr(call_app, 'LiveTranscriber', FakeLive)
    with client.websocket_connect('/api/record', headers={'origin':'http://testserver'}) as ws:
        ws.send_json({'token':'test-token', 'sources':sources})
        ready = ws.receive_json()
        assert ready['type'] == 'ready'
        if 'system' in sources:
            warning = ws.receive_json()
            assert warning['type'] == 'warning'
            assert 'Recording continues' in warning['message']
        for source in sources:
            channel = ('microphone', 'system').index(source)
            ws.send_bytes(bytes([channel])+struct.pack('<800f', *([.1]*800)))
            assert ws.receive_json()['type'] == 'partial'
            segment = ws.receive_json()['segment']
            assert segment['source'] == source
            assert segment['speaker'] is None
        ws.send_json({'type':'stop'})
        for _ in sources:
            assert ws.receive_json()['type'] == 'segment'
        saved = ws.receive_json()['call']
        assert saved['status'] == 'complete'
        assert len(saved['segments']) == 2*len(sources)
        assert {s['source'] for s in saved['segments']} == set(sources)
    assert len(attempts) == int('system' in sources)
    assert not call_app.engine.busy


def test_disconnect_and_malformed_frame(client, monkeypatch):
    monkeypatch.setattr(call_app, 'LiveTranscriber', FakeLive)
    with client.websocket_connect('/api/record', headers={'origin':'http://testserver'}) as ws:
        ws.send_json({'token':'test-token','sources':['microphone']})
        call_id=ws.receive_json()['call']['id']
        ws.send_bytes(b'bad')
        assert ws.receive_json()['type']=='error'
    assert call_app.store.get(call_id)['status']=='interrupted'
    assert not call_app.engine.busy
    with client.websocket_connect('/api/record', headers={'origin':'http://testserver'}) as ws:
        ws.send_json({'token':'wrong','sources':['microphone']})
        assert ws.receive_json()['type']=='error'
    assert not call_app.engine.busy


def test_mcp_stdio_reads_and_saves(tmp_path):
    store=CallStore(tmp_path)
    call=store.create('MCP test')
    store.append(call['id'],'system',0,4,'Send the proposal on Friday.', speaker=2)
    store.finish(call['id'],4)
    async def check():
        server=StdioServerParameters(command=sys.executable,args=[str(Path(__file__).resolve().parents[1]/'service/call_mcp.py')],env={**os.environ,'CALL_DESK_DATA':str(tmp_path)})
        async with Client(server) as client:
            assert {t.name for t in (await client.list_tools()).tools}=={'list_calls','get_call','save_call_analysis'}
            result=await client.call_tool('list_calls', {'query':'proposal'})
            assert not result.is_error
            assert call['id'] in str(result)
            result=await client.call_tool('get_call', {'call_id':call['id']})
            assert not result.is_error
            assert 'Friday' in str(result)
            import json
            assert json.loads(result.content[0].text)['segments'][0]['speaker'] == 2
            result=await client.call_tool('save_call_analysis', {'call_id':call['id'],'markdown':'Send the proposal. [segment 1]','author':'Test'})
            assert not result.is_error
    asyncio.run(check())
    assert store.get(call['id'])['analyses'][0]['author']=='Test'


def test_calendar_metadata_persists_for_mcp(tmp_path):
    store=CallStore(tmp_path)
    event={'id':'meeting-one','title':'Planning','attendees':[{'email':'a@example.com'}]}
    call=store.create('Planning',calendar_event=event)
    assert CallStore(tmp_path).get(call['id'])['calendar_event']==event


def test_live_phrase_timestamps_exclude_idle_silence():
    import numpy as np
    from streaming import LiveTranscriber
    class Model:
        def transcribe_array(self,audio,hotwords):return ('Test phrase.',.001,{})
    session=LiveTranscriber(Model(),[])
    events=[]
    for value,blocks in [(0.,40),(.1,20),(0.,20)]:
        for _ in range(blocks):events.extend(session.feed(np.full(800,value,dtype='<f4').tobytes()))
    final=[event for event in events if event['type']=='final'][0]
    assert final['start']==pytest.approx(2.)
    assert final['end']==pytest.approx(3.)


def test_permanent_delete_removes_call_children_and_preserves_other_calls(tmp_path):
    store = CallStore(tmp_path)
    target = store.create('Delete me', calendar_event={'title': 'Meeting'})
    other = store.create('Keep me')
    for call in [target, other]:
        store.append(call['id'], 'microphone', 0, 1, 'Saved transcript')
        store.update(call['id'], notes='Saved notes')
        store.save_analysis(call['id'], 'Saved analysis', 'Codex')
        store.finish(call['id'], 1)
    store.delete(target['id'])
    with pytest.raises(KeyError):
        store.get(target['id'])
    assert store.get(other['id'])['notes'] == 'Saved notes'
    with store.connect() as db:
        for table, column in [('calls', 'id'), ('segments', 'call_id'), ('analyses', 'call_id')]:
            assert db.execute(f'SELECT COUNT(*) FROM {table} WHERE {column}=?', (target['id'],)).fetchone()[0] == 0
            assert db.execute(f'SELECT COUNT(*) FROM {table} WHERE {column}=?', (other['id'],)).fetchone()[0] == 1


def test_delete_api_rejects_active_call_and_requires_authentication(client):
    call = call_app.store.create('Active')
    call_app.store.append(call['id'], 'microphone', 0, 1, 'Keep live transcript')
    url = '/api/calls/' + call['id']
    assert client.delete(url, headers={'x-call-token': ''}).status_code == 401
    assert client.delete(url).status_code == 409
    assert call_app.store.get(call['id'])['segments'][0]['text'] == 'Keep live transcript'
    call_app.store.finish(call['id'], 1)
    assert client.delete(url).json() == {'deleted': True}
    assert client.get(url).status_code == 404
    assert client.delete(url).status_code == 404


def test_speaker_names_persist_and_export_without_merging_uncertain_lines(tmp_path):
    store = CallStore(tmp_path)
    call = store.create('Naming')
    cid = call['id']
    first = store.append(cid, 'system', 0, 4, 'First', 1)
    second = store.append(cid, 'system', 4, 8, 'Second', 1)
    unknown = store.append(cid, 'system', 8, 9, 'Unknown')
    other_unknown = store.append(cid, 'system', 9, 10, 'Other unknown')
    store.name_speaker(cid, first['id'], 'Alice')
    store.name_speaker(cid, second['id'], 'Bob', 'segment')
    store.name_speaker(cid, unknown['id'], 'Alice', 'segment')
    saved = CallStore(tmp_path).get(cid)
    assert [row['display_name'] for row in saved['segments']] == ['Alice', 'Bob', 'Alice', None]
    assert 'Alice (segment' in transcript_markdown(saved)
    assert 'Bob (segment' in transcript_markdown(saved)
    with pytest.raises(ValueError):
        store.name_speaker(cid, other_unknown['id'], 'Everyone')
    store.name_speaker(cid, second['id'], '', 'segment')
    assert store.get(cid)['segments'][1]['display_name'] == 'Alice'
    store.name_speaker(cid, first['id'], '')
    assert not store.get(cid)['segments'][0]['display_name']
    other = store.create('Separate call')
    separate = store.append(other['id'], 'system', 0, 5, 'Separate', 1)
    assert not store.get(other['id'])['segments'][0]['display_name']
    with pytest.raises(KeyError):
        store.name_speaker(cid, separate['id'], 'Wrong call')
    store.finish(cid, 10)
    store.delete(cid)
    with store.connect() as db:
        assert db.execute('SELECT COUNT(*) FROM speaker_names WHERE call_id=?', (cid,)).fetchone()[0] == 0


def test_speaker_name_api_validation_and_export(client):
    call = call_app.store.create('API names')
    row = call_app.store.append(call['id'], 'microphone', 0, 4, 'Hello')
    path = f"/api/calls/{call['id']}/segments/{row['id']}/speaker"
    assert client.patch(path, json={'name':'Sergey'}).status_code == 200
    assert 'Sergey (segment' in client.get(f"/api/calls/{call['id']}/export").text
    for body in [{'name':'a\nb'}, {'name':'x'*101}, {'name':'Name', 'scope':'all'}, {'name':None}]:
        assert client.patch(path, json=body).status_code == 422
    assert client.patch(path, json={'name':'No'}, headers={'x-call-token':''}).status_code == 401


def test_speaker_names_migration_backs_up_old_database(tmp_path):
    import sqlite3
    store = CallStore(tmp_path)
    call = store.create('Existing')
    store.append(call['id'], 'system', 0, 5, 'Keep me', 2)
    with sqlite3.connect(store.path) as db:
        db.execute('ALTER TABLE segments DROP COLUMN speaker_name')
        db.execute('DROP TABLE speaker_names')
    reopened = CallStore(tmp_path)
    backups = list((tmp_path / 'backups').glob('calls-before-speaker-names-*.sqlite3'))
    assert len(backups) == 1
    assert reopened.get(call['id'])['segments'][0]['text'] == 'Keep me'
    with sqlite3.connect(backups[0]) as db:
        assert 'speaker_name' not in {row[1] for row in db.execute('PRAGMA table_info(segments)')}
    CallStore(tmp_path)
    assert len(list((tmp_path / 'backups').glob('*.sqlite3'))) == 1
