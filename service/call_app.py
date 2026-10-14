"""Authenticated loopback service for the Call Note desktop shell."""
import asyncio
import contextlib
from contextlib import asynccontextmanager
import json
import os
import secrets
import tempfile
import time
from typing import Literal

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app import ROOT, engine, engine_call, local_requests, status
from call_store import CallStore, transcript_markdown
from diarization import SpeakerDiagnostics
from streaming import LiveTranscriber

TOKEN = os.environ.get('CALL_DESK_TOKEN', secrets.token_urlsafe(32))
store = None
diarizer = None
IDLE_SECONDS = max(1, int(os.environ.get('CALL_NOTE_IDLE_SECONDS', '120')))
last_engine_use = time.monotonic()
request_idle_exit = None
latest_diagnostics = SpeakerDiagnostics()
latest_has_call = False
DIAGNOSTICS_FILE = 'diagnostics-health.json'


def load_diagnostics(directory):
    """Load only the fixed aggregate schema; ignore any unknown properties."""
    path = directory / DIAGNOSTICS_FILE
    if not path.exists():
        return SpeakerDiagnostics(), False
    try:
        with path.open(encoding='utf-8') as source:
            payload = json.loads(source.read(8193))
            if source.tell() > 8192:
                return SpeakerDiagnostics(), False
        if not isinstance(payload, dict) or type(payload.get('has_call')) is not bool:
            return SpeakerDiagnostics(), False
        raw_counts = payload.get('counters')
        if not isinstance(raw_counts, dict):
            return SpeakerDiagnostics(), False
        counts = SpeakerDiagnostics()
        for key in SpeakerDiagnostics.FIELDS:
            value = raw_counts.get(key)
            if type(value) is not int or not 0 <= value <= SpeakerDiagnostics.LIMIT:
                return SpeakerDiagnostics(), False
            counts.increment(key, value)
        return counts, payload['has_call']
    except (OSError, ValueError, TypeError):
        return SpeakerDiagnostics(), False


def persist_diagnostics(directory, diagnostics, has_call):
    """Atomically save counters only, with private file permissions."""
    path = directory / DIAGNOSTICS_FILE
    temp_path = None
    try:
        descriptor, temp_path = tempfile.mkstemp(prefix='.diagnostics-', suffix='.tmp', dir=directory)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as target:
            if os.name != 'nt':
                os.fchmod(target.fileno(), 0o600)
            json.dump({'has_call': bool(has_call), 'counters': diagnostics.snapshot()}, target,
                      separators=(',', ':'), sort_keys=True)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temp_path, path)
        temp_path = None
        if os.name != 'nt':
            path.chmod(0o600)
    except OSError:
        # Diagnostics must never interrupt or change the outcome of a call.
        pass
    finally:
        if temp_path is not None:
            with contextlib.suppress(OSError):
                os.unlink(temp_path)

def release_models():
    global diarizer
    diarizer = None
    engine.unload()

def engine_finished():
    global last_engine_use
    last_engine_use = time.monotonic()
    engine.busy = False

async def ensure_engine():
    if engine.status != 'ready':
        await engine_call(engine.ensure_loaded)

async def release_if_idle(now=None):
    now = time.monotonic() if now is None else now
    if engine.busy or engine.status != 'ready' or now - last_engine_use < IDLE_SECONDS:
        return False
    engine.busy = True
    try:
        await engine_call(release_models)
        return True
    finally:
        engine.busy = False

async def idle_memory():
    while True:
        await asyncio.sleep(min(15, IDLE_SECONDS))
        if await release_if_idle() and request_idle_exit is not None:
            engine.busy = True
            request_idle_exit()
            return

def speaker_session(diagnostics=None):
    global diarizer
    from diarization import Diarizer, SpeakerSession
    if diarizer is None:
        diarizer = Diarizer(ROOT / "models/diarization")
    return SpeakerSession(diarizer, diagnostics if diagnostics is not None else latest_diagnostics)

def transcribe_sample(path, hotwords):
    import soundfile as sf
    audio, rate = sf.read(path, dtype="float32")
    if rate != 16000 or audio.ndim != 1:
        raise ValueError("The sample must be mono 16 kHz audio.")
    segments = speaker_session(SpeakerDiagnostics()).transcribe(audio, engine.model, hotwords)
    return {"audio_seconds": len(audio)/rate, "segments": segments}

SAMPLES = {
    'briefing': ('long-clean.wav', 'Sample · Project briefing', 'sample'),
    'meeting': ('meeting.wav', 'Sample · Three-person discussion', 'sample-multiparty'),
}

@asynccontextmanager
async def lifespan(application):
    global store, latest_diagnostics, latest_has_call
    store = CallStore()
    latest_diagnostics, latest_has_call = load_diagnostics(store.directory)
    store.recover()
    idle = asyncio.create_task(idle_memory())
    try:
        yield
    finally:
        idle.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await idle
        await engine_call(release_models)
        engine.pool.shutdown(wait=True)

app = FastAPI(title='Call Note', lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', 'testserver'])
app.middleware('http')(local_requests)

@app.middleware('http')
async def authenticated(request: Request, call_next):
    if request.url.path.startswith('/api/') and not secrets.compare_digest(request.headers.get('x-call-token', ''), TOKEN):
        return JSONResponse({'detail': 'Desktop authentication required.'}, status_code=401)
    return await call_next(request)

@app.exception_handler(KeyError)
async def missing(request, exc):
    return JSONResponse({'detail': 'Call not found.'}, status_code=404)

@app.get('/')
def index():
    return FileResponse(ROOT / 'desktop/ui/index.html')

app.get('/api/status')(status)

@app.get('/api/diagnostics')
def diagnostics():
    # This endpoint intentionally exposes only fixed numeric counters and
    # coarse runtime state. It never reads call data or triggers model loading.
    engine_status = engine.status if engine.status in {'idle', 'loading', 'ready', 'error'} else 'unknown'
    return {
        'scope': 'latest_call',
        'has_call': latest_has_call,
        'counters': latest_diagnostics.snapshot(),
        'runtime': {
            'engine_status': engine_status,
            'speaker_model_loaded': diarizer is not None,
        },
    }

@app.post('/api/engine/prepare')
async def prepare_engine():
    if engine.busy:
        raise HTTPException(409, 'Engine is busy.')
    engine.busy = True
    try:
        await ensure_engine()
        return status()
    finally:
        engine_finished()

@app.get('/api/calls')
def calls(q: str = '', offset: int = 0):
    return store.list(q, offset=offset)

@app.get('/api/calls/{call_id}')
def get_call(call_id: str):
    return store.get(call_id)

class Edit(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=20000)

@app.patch('/api/calls/{call_id}')
def edit_call(call_id: str, edit: Edit):
    return store.update(call_id, edit.title, edit.notes)

@app.delete('/api/calls/{call_id}')
def delete_call(call_id: str):
    try:
        store.delete(call_id)
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    return {'deleted': True}

@app.get('/api/calls/{call_id}/export')
def export(call_id: str):
    return PlainTextResponse(transcript_markdown(store.get(call_id)))

@app.post('/api/demo')
async def demo(sample: Literal['briefing', 'meeting'] = 'briefing'):
    if engine.busy:
        raise HTTPException(409, 'Engine is loading or busy.')
    engine.busy = True
    try:
        await ensure_engine()
        filename, title, source = SAMPLES[sample]
        result = await engine_call(transcribe_sample, ROOT / 'samples' / filename, [])
        call = store.create(title, source)
        for segment in result['segments']:
            store.append(call['id'], 'sample', segment['start'], segment['end'], segment['text'], segment.get('speaker'))
        store.finish(call['id'], result['audio_seconds'])
        return store.get(call['id'])
    finally:
        engine_finished()

@app.get('/api/demo/audio')
def demo_audio(sample: Literal['briefing', 'meeting'] = 'briefing'):
    return FileResponse(ROOT / 'samples' / SAMPLES[sample][0], media_type='audio/wav')

@app.websocket('/api/record')
async def record(socket: WebSocket):
    origin = socket.headers.get('origin')
    if origin != f"http://{socket.headers.get('host')}":
        await socket.close(code=1008)
        return
    await socket.accept()
    owned = False
    call = None
    sessions = {}
    offsets = {}
    boundaries = {}
    started = time.monotonic()
    completed = False
    diagnostics = None

    async def publish(source, events):
        for event in events:
            if event['type'] == 'final':
                end = offsets[source] + event.get('end', sessions[source].samples / 16000)
                start = offsets[source] + event['start'] if 'start' in event else boundaries[source]
                segment = store.append(call['id'], source, start, end, event['text'], event.get('speaker'))
                boundaries[source] = end
                if segment:
                    await socket.send_json({'type': 'segment', 'segment': segment})
            elif event['type'] == 'warning':
                await socket.send_json(event)
            elif event['type'] == 'partial':
                await socket.send_json({'type': 'partial', 'source': source, 'text': event['text']})

    try:
        config = await asyncio.wait_for(socket.receive_json(), timeout=10)
        if not isinstance(config, dict) or not isinstance(config.get('token'), str) or not secrets.compare_digest(config['token'], TOKEN):
            raise ValueError('Desktop authentication required.')
        if engine.busy:
            raise ValueError('Engine is loading or busy.')
        sources = config.get('sources')
        if not isinstance(sources, list) or not sources or len(set(sources)) != len(sources) or any(s not in ('microphone', 'system') for s in sources):
            raise ValueError('Choose microphone, system audio, or both.')
        engine.busy = owned = True
        await ensure_engine()
        event = config.get('calendar_event')
        if event is not None and (not isinstance(event, dict) or len(json.dumps(event)) > 30000):
            raise ValueError('Invalid calendar event metadata.')
        call = store.create(str(config.get('title', 'Untitled call')), calendar_event=event)
        global latest_diagnostics, latest_has_call
        diagnostics = latest_diagnostics = SpeakerDiagnostics()
        latest_has_call = True
        persist_diagnostics(store.directory, diagnostics, True)
        started = time.monotonic()
        speaker_warning = False
        for source in sources:
            speakers = None
            if source == "system":
                try:
                    speakers = await engine_call(speaker_session)
                except Exception:
                    diagnostics.increment('diarization_failures')
                    speaker_warning = True
            sessions[source] = await engine_call(LiveTranscriber, engine.model, [], speakers, diagnostics)
            boundaries[source] = 0
        await socket.send_json({'type': 'ready', 'call': call})
        if speaker_warning:
            await socket.send_json({'type': 'warning', 'message': 'Speaker detection is unavailable. Recording continues; system audio will be labeled Others.'})
        while True:
            message = await asyncio.wait_for(socket.receive(), timeout=30)
            if message['type'] == 'websocket.disconnect':
                break
            data = message.get('bytes')
            if data is not None:
                if len(data) < 5 or (len(data) - 1) % 4 or len(data) > 3201 or data[0] not in (0, 1):
                    raise ValueError('Invalid audio frame.')
                source = ('microphone', 'system')[data[0]]
                if source not in sessions:
                    raise ValueError('Audio source was not enabled.')
                offsets.setdefault(source, max(0, time.monotonic() - started - (len(data)-1)/4/16000))
                if time.monotonic() - started > 4 * 3600:
                    raise ValueError('This preview supports calls up to four hours.')
                await publish(source, await engine_call(sessions[source].feed, data[1:]))
            elif json.loads(message.get('text', '{}')) == {'type': 'stop'}:
                for source, session in sessions.items():
                    offsets.setdefault(source, 0)
                    await engine_call(session.finish)
                    events, session.events = session.events, []
                    await publish(source, events)
                store.finish(call['id'], time.monotonic()-started)
                completed = True
                await socket.send_json({'type': 'complete', 'call': store.get(call['id'])})
                await socket.close()
                break
            else:
                raise ValueError('Unknown recording message.')
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await socket.send_json({'type': 'error', 'message': str(exc) or 'Recording interrupted.'})
            await socket.close(code=1011)
        except (RuntimeError, WebSocketDisconnect):
            pass
    finally:
        if call and not completed:
            # Keep any last decoded phrase when the window or capture stream closes.
            for source, session in sessions.items():
                try:
                    await engine_call(session.finish)
                    for event in session.events:
                        if event['type'] == 'final':
                            end = offsets.get(source, 0) + event.get('end', session.samples / 16000)
                            start = offsets.get(source, 0) + event['start'] if 'start' in event else boundaries[source]
                            store.append(call['id'], source, start, end, event['text'], event.get('speaker'))
                            boundaries[source] = end
                    session.events = []
                except Exception:
                    pass
            store.finish(call['id'], time.monotonic()-started, 'interrupted')
        if call and diagnostics is not None:
            persist_diagnostics(store.directory, diagnostics, True)
        if owned:
            sessions.clear()
            engine_finished()

app.mount('/ui', StaticFiles(directory=ROOT / 'desktop/ui'), name='ui')
app.mount('/static', StaticFiles(directory=ROOT / 'static'), name='static')
