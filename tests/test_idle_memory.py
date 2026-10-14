import asyncio
from types import SimpleNamespace

import pytest
import call_app


@pytest.fixture
def idle_engine(monkeypatch):
    engine = SimpleNamespace(status='ready', busy=False)
    monkeypatch.setattr(call_app, 'engine', engine)
    monkeypatch.setattr(call_app, 'last_engine_use', 100)
    monkeypatch.setattr(call_app, 'IDLE_SECONDS', 120)
    return engine


def test_idle_release_obeys_activity_and_deadline(monkeypatch, idle_engine):
    released = []
    async def worker(fn):
        assert idle_engine.busy
        released.append(fn)
        idle_engine.status = 'idle'
    monkeypatch.setattr(call_app, 'engine_call', worker)
    async def check():
        assert not await call_app.release_if_idle(219)
        idle_engine.busy = True
        assert not await call_app.release_if_idle(500)
        idle_engine.busy = False
        assert await call_app.release_if_idle(500)
        assert not idle_engine.busy
        assert not await call_app.release_if_idle(600)
    asyncio.run(check())
    assert released == [call_app.release_models]


def test_release_drops_diarizer_before_speech(monkeypatch, idle_engine):
    monkeypatch.setattr(call_app, 'diarizer', object())
    def unload():
        assert call_app.diarizer is None
    idle_engine.unload = unload
    call_app.release_models()


def test_prepare_owns_engine_during_load_and_cleans_up_on_failure(monkeypatch, idle_engine):
    idle_engine.status = 'idle'
    idle_engine.ensure_loaded = lambda: None
    async def worker(fn):
        assert idle_engine.busy
        raise RuntimeError('load failed')
    monkeypatch.setattr(call_app, 'engine_call', worker)
    with pytest.raises(RuntimeError, match='load failed'):
        asyncio.run(call_app.prepare_engine())
    assert not idle_engine.busy
    assert call_app.last_engine_use > 100


def test_idle_release_reserves_worker_against_concurrent_start(monkeypatch, idle_engine):
    async def check():
        started, finish = asyncio.Event(), asyncio.Event()
        async def worker(fn):
            started.set()
            await finish.wait()
        monkeypatch.setattr(call_app, 'engine_call', worker)
        pending = asyncio.create_task(call_app.release_if_idle(500))
        await started.wait()
        with pytest.raises(call_app.HTTPException) as error:
            await call_app.prepare_engine()
        assert error.value.status_code == 409
        finish.set()
        assert await pending
        assert not idle_engine.busy
    asyncio.run(check())
