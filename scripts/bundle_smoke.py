"""Run inside the bundled Python, independent of Homebrew and the source checkout."""
import asyncio
from pathlib import Path
import os
import sys
import tempfile

sys.dont_write_bytecode=True
cache=tempfile.TemporaryDirectory(prefix='call-note-smoke-cache-')
os.environ.update(PYTHONDONTWRITEBYTECODE='1', FERMION_CACHE_DIR=cache.name+'/fermion', HF_HOME=cache.name+'/huggingface')
service=Path(sys.argv[1]).resolve()
sys.path.insert(0,str(service))
os.environ.update(CALL_NOTE_MODEL=str(service/'models/model_phonon2_c4c_int6'),HF_HUB_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1')
from app import Engine
engine=Engine()
engine.load()
assert engine.status=='ready',engine.error
result=engine.transcribe_wav(service/'samples/long-clean.wav',[])
assert 'project review' in result['text'].lower(),result['text']
print('Offline model:',engine.status,'sample duration:',round(result['audio_seconds'],1),'decode:',round(result['processing_seconds'],2))
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
