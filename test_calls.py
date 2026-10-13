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
    return TestClient(call_app.app, headers={'x-call-token': 'test-token'})


def test_auth_and_origin(client):
    assert client.get('/api/calls', headers={'x-call-token':''}).status_code == 401
    assert client.post('/api/demo', headers={'origin':'https://evil.example'}).status_code == 403
    assert client.get('/api/calls/missing').status_code == 404


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
    store.append(call['id'],'system',0,4,'Send the proposal on Friday.')
    store.finish(call['id'],4)
    async def check():
        server=StdioServerParameters(command=sys.executable,args=[str(Path(__file__).parent/'call_mcp.py')],env={**os.environ,'CALL_DESK_DATA':str(tmp_path)})
        async with Client(server) as client:
            assert {t.name for t in (await client.list_tools()).tools}=={'list_calls','get_call','save_call_analysis'}
            result=await client.call_tool('list_calls', {'query':'proposal'})
            assert not result.is_error
            assert call['id'] in str(result)
            result=await client.call_tool('get_call', {'call_id':call['id']})
            assert not result.is_error
            assert 'Friday' in str(result)
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
