"""Exercise the installed backend without touching the user's app or call library."""
import argparse
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--python', required=True)
    parser.add_argument('--service', required=True)
    args = parser.parse_args()
    service = Path(args.service).resolve()
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    token = secrets.token_urlsafe(32)
    with tempfile.TemporaryDirectory(prefix='call-note-service-smoke-') as data:
        env = {**os.environ, 'CALL_DESK_TOKEN': token, 'CALL_DESK_DATA': data,
               'CALL_NOTE_IDLE_SECONDS': '5', 'PYTHONNOUSERSITE': '1',
               'PYTHONDONTWRITEBYTECODE': '1', 'HF_HUB_OFFLINE': '1',
               'CALL_NOTE_MODEL': str(service / 'models/model_phonon2_c4c_int6'),
               'HF_HOME': str(Path(data) / 'hf'), 'FERMION_CACHE_DIR': str(Path(data) / 'fermion')}
        env.pop('PYTHONPATH', None)
        env.pop('PYTHONHOME', None)
        def request(route, method='GET', authenticated=True):
            headers = {'x-call-token': token} if authenticated else {}
            req = urllib.request.Request(origin + route, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=180) as response:
                return json.load(response)
        with (Path(data) / 'service.log').open('w+') as log:
            def start_service():
                return subprocess.Popen([str(Path(args.python).resolve()), str(service / 'run_service.py'),
                                         '--host', '127.0.0.1', '--port', str(port)],
                                        cwd=service, env=env, stdout=log, stderr=log)
            process = start_service()
            try:
                deadline = time.monotonic() + 60
                while True:
                    try:
                        initial = request('/api/status')
                        break
                    except (urllib.error.URLError, TimeoutError):
                        if process.poll() is not None or time.monotonic() > deadline:
                            raise RuntimeError('Installed service did not start')
                        time.sleep(.2)
                assert initial['status'] == 'idle', initial
                assert request('/api/calls') == []
                try:
                    request('/api/calls', authenticated=False)
                    raise AssertionError('Unauthenticated library request succeeded')
                except urllib.error.HTTPError as error:
                    assert error.code == 401
                prepared = request('/api/engine/prepare', 'POST')
                assert prepared['status'] == 'ready', prepared
                call = request('/api/demo?sample=briefing', 'POST')
                assert call['segments'], call
                assert process.wait(timeout=45) == 75, 'Idle service did not request a clean recycle'
                process = start_service()
                deadline = time.monotonic() + 30
                while True:
                    try:
                        assert request('/api/status')['status'] == 'idle'
                        break
                    except urllib.error.URLError:
                        assert time.monotonic() < deadline, 'Service did not restart after idle'
                        time.sleep(.2)
                assert request('/api/calls')[0]['id'] == call['id']
                reloaded = request('/api/engine/prepare', 'POST')
                assert reloaded['status'] == 'ready', reloaded
                print('Installed backend: auth, lazy load, sample, graceful idle recycle, reload and library persistence passed.')
            except Exception:
                log.flush()
                log.seek(0)
                print(log.read()[-12000:])
                raise
            finally:
                process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == '__main__':
    main()
