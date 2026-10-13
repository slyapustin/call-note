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
