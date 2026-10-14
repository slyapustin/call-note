import json
import tomllib
from connect_mcp import plans, ENTRY

def test_connections_preserve_existing_settings(tmp_path):
    codex=tmp_path/'.codex/config.toml';codex.parent.mkdir()
    codex.write_text('model = "existing-model"\n[mcp_servers.keep]\ncommand = "keep"\n')
    claude=tmp_path/'Library/Application Support/Claude/claude_desktop_config.json';claude.parent.mkdir(parents=True)
    claude.write_text(json.dumps({'preferences':{'theme':'dark'},'mcpServers':{'keep':{'command':'keep'}}}))
    changes=plans(tmp_path)
    assert len(changes)==2
    for path,text in changes:path.write_text(text)
    assert tomllib.loads(codex.read_text())['mcp_servers']['keep']['command']=='keep'
    assert json.loads(claude.read_text())['preferences']['theme']=='dark'
    assert json.loads(claude.read_text())['mcpServers']['call-note']==ENTRY
    assert plans(tmp_path)==[]


def test_reinstall_updates_only_call_note(tmp_path, monkeypatch):
    import connect_mcp
    monkeypatch.setattr(connect_mcp,'ENTRY',{'command':'/Applications/Call Note.app/Contents/Resources/python/bin/python3.11','args':['-B','/Applications/Call Note.app/Contents/Resources/service/call_mcp.py']})
    original=plans(tmp_path)
    for path,text in original:
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(text)
    updated={'command':'/Applications/Call Note.app/Contents/Resources/python/bin/python3.13','args':['-B','/Applications/Call Note.app/Contents/Resources/service/call_mcp.py']}
    monkeypatch.setattr(connect_mcp,'ENTRY',updated)
    changes=plans(tmp_path)
    assert len(changes)==2
    for path,text in changes:path.write_text(text)
    assert plans(tmp_path)==[]
    assert tomllib.loads((tmp_path/'.codex/config.toml').read_text())['mcp_servers']['call-note']==updated
