"""Run inside the bundled Python, independent of Homebrew and the source checkout."""
import asyncio
import importlib.util
import json
from pathlib import Path
import os
import sys
import tempfile

sys.dont_write_bytecode=True
cache=tempfile.TemporaryDirectory(prefix='call-note-smoke-cache-')
os.environ.update(PYTHONDONTWRITEBYTECODE='1', FERMION_CACHE_DIR=cache.name+'/fermion', HF_HOME=cache.name+'/huggingface')
service=Path(sys.argv[1]).resolve()
manifest=json.loads((service/'bundle.json').read_text())
if manifest.get('runtime_profile')=='macos-mlx':
    assert all(importlib.util.find_spec(name) is None for name in ('torch','sympy','networkx','mpmath','pytest','pip'))
sys.path.insert(0,str(service))
os.environ.update(CALL_NOTE_MODEL=str(service/'models/model_phonon2_c4c_int6'),HF_HUB_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1')
from app import Engine
engine=Engine()
engine.load()
assert engine.status=='ready',engine.error
if manifest.get('runtime_profile')=='macos-mlx':
    assert engine.backend=='mlx',engine.backend
result=engine.transcribe_wav(service/'samples/long-clean.wav',[])
assert 'project review' in result['text'].lower(),result['text']
print('Offline model:',engine.status,'sample duration:',round(result['audio_seconds'],1),'decode:',round(result['processing_seconds'],2))
from diarization import Diarizer, SpeakerSession
import soundfile as sf
audio, rate = sf.read(service/'samples/meeting.wav', dtype='float32')
assert rate == 16000
turns = SpeakerSession(Diarizer(service/'models/diarization')).turns(audio[:160000])
assert turns and {turn['speaker'] for turn in turns} == {1}, turns
print('Bundled speaker detection: passed')
from streaming import LiveTranscriber
import numpy as np
speech, rate = sf.read(service/'samples/long-clean.wav', dtype='float32')
assert rate == 16000
live = LiveTranscriber(engine.model, ['project review'])
for chunk in np.array_split(np.concatenate([speech[:160000], np.zeros(16000, dtype=np.float32)]), 220):
    live.feed(chunk.astype('<f4').tobytes())
assert live.finish()['text'].strip(), 'Streaming transcription returned no text'
print('Bundled streaming and hotwords: passed')
engine.pool.shutdown()
from mcp import Client, StdioServerParameters
from call_store import CallStore
with tempfile.TemporaryDirectory(prefix='call-note-bundle-test-') as data:
    store=CallStore(data)
    call=store.create('Bundled runtime test')
    store.append(call['id'],'sample',0,result['audio_seconds'],result['text'])
    store.finish(call['id'],result['audio_seconds'])
    async def check():
        server=StdioServerParameters(command=sys.executable,args=['-B',str(service/'call_mcp.py')],env={**os.environ,'CALL_DESK_DATA':data})
        async with Client(server) as client:
            response=await client.call_tool('get_call',{'call_id':call['id']})
            assert not response.is_error
            assert 'project review' in str(response).lower()
    asyncio.run(check())
print('Bundled MCP: passed')
print('Python:',sys.executable)
print('Import roots:',sys.path)
