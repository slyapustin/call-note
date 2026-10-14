"""Desktop service runner: gracefully recycle native allocators after idle use."""
import argparse
import uvicorn

IDLE_EXIT_CODE = 75


def run(host, port):
    import call_app
    server = uvicorn.Server(uvicorn.Config(call_app.app, host=host, port=port, ws_max_size=65536))
    idle_exit = False

    def request_idle_exit():
        nonlocal idle_exit
        idle_exit = True
        server.should_exit = True

    call_app.request_idle_exit = request_idle_exit
    try:
        server.run()
    finally:
        call_app.request_idle_exit = None
    return IDLE_EXIT_CODE if idle_exit else 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', choices=['127.0.0.1'], default='127.0.0.1')
    parser.add_argument('--port', type=int, required=True)
    args = parser.parse_args()
    if not 0 < args.port < 65536:
        parser.error('port must be between 1 and 65535')
    return run(args.host, args.port)


if __name__ == '__main__':
    raise SystemExit(main())
