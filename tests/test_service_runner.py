import asyncio
from types import SimpleNamespace
import call_app
import run_service


def test_runner_requests_graceful_shutdown_before_recycle_exit(monkeypatch):
    observed = []
    class Server:
        def __init__(self, config):
            assert config.host == '127.0.0.1'
            assert config.ws_max_size == 65536
            self.should_exit = False
        def run(self):
            call_app.request_idle_exit()
            assert self.should_exit
            observed.append('graceful drain completed')
    monkeypatch.setattr(run_service.uvicorn, 'Server', Server)
    assert run_service.run('127.0.0.1', 8123) == 75
    assert observed == ['graceful drain completed']
    assert call_app.request_idle_exit is None


def test_normal_server_exit_is_not_a_recycle(monkeypatch):
    monkeypatch.setattr(run_service.uvicorn, 'Server', lambda config: SimpleNamespace(run=lambda: None))
    assert run_service.run('127.0.0.1', 8123) == 0
    assert call_app.request_idle_exit is None


def test_idle_exit_reserves_engine_before_callback(monkeypatch):
    engine = SimpleNamespace(busy=False)
    monkeypatch.setattr(call_app, 'engine', engine)
    async def noop(*args):
        pass
    async def released():
        return True
    monkeypatch.setattr(call_app.asyncio, 'sleep', noop)
    monkeypatch.setattr(call_app, 'release_if_idle', released)
    observations = []
    def exit_requested():
        assert engine.busy
        observations.append('exit')
    monkeypatch.setattr(call_app, 'request_idle_exit', exit_requested)
    asyncio.run(call_app.idle_memory())
    assert observations == ['exit']
