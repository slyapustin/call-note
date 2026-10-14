import builtins
import json
from pathlib import Path
import subprocess
import sys
import tomllib

import pytest
from connect_mcp import build_setup


@pytest.mark.parametrize('folder', ['Call Note.app', 'Call "Note" \\ app', 'Łódź 日本語 🎙️', 'newline\n tab\t delete\x7f'])
def test_snippets_round_trip_unusual_paths(tmp_path, folder):
    python = f'/Applications/{folder}/Contents/Resources/python/bin/python3.13'
    server = f'/Applications/{folder}/Contents/Resources/service/call_mcp.py'
    setup = build_setup(tmp_path, python, server)
    expected = {'command': python, 'args': ['-B', server]}
    assert tomllib.loads(setup['clients'][0]['snippet']) == {'mcp_servers': {'call-note': expected}}
    assert json.loads(setup['clients'][1]['snippet']) == {'mcpServers': {'call-note': expected}}
    assert 'preserving your existing settings' in ' '.join(setup['clients'][0]['steps'])
    assert 'merge only the call-note entry' in ' '.join(setup['clients'][1]['steps'])


def test_builder_does_not_read_existing_configs_or_touch_filesystem(tmp_path, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError('MCP instruction generation must not access files')
    for method in ['open', 'read_text', 'read_bytes', 'write_text', 'write_bytes', 'mkdir', 'exists']:
        monkeypatch.setattr(Path, method, forbidden)
    monkeypatch.setattr(builtins, 'open', forbidden)
    setup = build_setup(tmp_path)
    assert [client['id'] for client in setup['clients']] == ['codex', 'claude']
    assert setup['clients'][0]['configPath'].endswith('/.codex/config.toml')


@pytest.mark.parametrize('arguments', [[], ['--dry-run']])
@pytest.mark.parametrize('existing', [False, True])
def test_cli_only_prints_instructions_without_creating_or_changing_configs(tmp_path, arguments, existing):
    home = tmp_path / 'home'
    home.mkdir()
    if existing:
        codex = home / '.codex/config.toml'
        codex.parent.mkdir()
        codex.write_text('PRIVATE_SECRET invalid TOML which must not be read')
        claude = home / 'Library/Application Support/Claude/claude_desktop_config.json'
        claude.parent.mkdir(parents=True)
        claude.write_text('PRIVATE_SECRET invalid JSON which must not be read')
    before = {str(path.relative_to(home)): (path.read_bytes(), path.stat().st_mtime_ns) for path in home.rglob('*') if path.is_file()}
    entries = sorted(str(path.relative_to(home)) for path in home.rglob('*'))
    script = Path(__file__).resolve().parents[1] / 'service/connect_mcp.py'
    launcher = 'import pathlib,runpy,sys; script=sys.argv.pop(1); home=sys.argv.pop(1); pathlib.Path.home=classmethod(lambda cls:pathlib.Path(home)); sys.argv[0]=script; runpy.run_path(script,run_name="__main__")'
    result = subprocess.run([sys.executable, '-B', '-c', launcher, str(script), str(home), *arguments], text=True, capture_output=True, check=True)
    assert 'manual instructions only' in result.stdout
    assert 'No assistant configuration files were read or changed' in result.stdout
    assert 'PRIVATE_SECRET' not in result.stdout + result.stderr
    assert sorted(str(path.relative_to(home)) for path in home.rglob('*')) == entries
    assert {str(path.relative_to(home)): (path.read_bytes(), path.stat().st_mtime_ns) for path in home.rglob('*') if path.is_file()} == before


def test_no_longer_exposes_an_automatic_mutation_plan():
    import connect_mcp
    assert not hasattr(connect_mcp, 'plans')


def test_windows_setup_uses_roaming_profile_and_round_trips_paths():
    python = r'C:\Program Files\Call Note\resources\python\python.exe'
    server = r'C:\Program Files\Call Note\resources\service\call_mcp.py'
    setup = build_setup(r'C:\Users\Jane', python, server, platform='win32', app_data=r'D:\Roaming Profile')
    assert setup['clients'][0]['configPath'] == r'C:\Users\Jane\.codex\config.toml'
    assert setup['clients'][1]['configPath'] == r'D:\Roaming Profile\Claude\claude_desktop_config.json'
    expected = {'command': python, 'args': ['-B', server]}
    assert tomllib.loads(setup['clients'][0]['snippet']) == {'mcp_servers': {'call-note': expected}}
    assert json.loads(setup['clients'][1]['snippet']) == {'mcpServers': {'call-note': expected}}
