#!/usr/bin/env python3
"""Add Call Note to local Codex and Claude Desktop configs, preserving existing servers."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import shutil
import tempfile
import os
import re
import tomllib

ROOT = Path(__file__).resolve().parent
PYTHON = Path(os.environ.get('CALL_NOTE_PYTHON', ROOT / '.venv/bin/python'))
ENTRY = {'command': str(PYTHON), 'args': [str(ROOT / 'call_mcp.py')]}


def plans(home):
    changes=[]
    codex=home/'.codex/config.toml'
    before=codex.read_text() if codex.exists() else ''
    config=tomllib.loads(before)
    legacy=config.get('mcp_servers',{}).get('calldesk')
    if legacy == ENTRY:
        before=re.sub(r'(?ms)^\[mcp_servers\.calldesk\]\n.*?(?=^\[|\Z)', '', before)
        config=tomllib.loads(before)
    existing=config.get('mcp_servers',{}).get('call-note')
    if existing and existing != ENTRY:
        if set(existing) != set(ENTRY) or not (isinstance(existing.get('args'), list) and len(existing['args']) == 1 and isinstance(existing['args'][0], str) and existing['args'][0].endswith('/call_mcp.py')):
            raise ValueError('A different Codex call-note server already exists; no files changed.')
        before=re.sub(r'(?ms)^\[mcp_servers\.call-note\]\n.*?(?=^\[|\Z)', '', before)
        existing=None
    if not existing:
        after=before.rstrip()+'\n\n[mcp_servers.call-note]\ncommand = '+json.dumps(ENTRY['command'])+'\nargs = '+json.dumps(ENTRY['args'])+'\n'
        tomllib.loads(after)
        changes.append((codex,after))
    claude=home/'Library/Application Support/Claude/claude_desktop_config.json'
    config=json.loads(claude.read_text()) if claude.exists() else {}
    if config.get('mcpServers',{}).get('calldesk') == ENTRY:
        del config['mcpServers']['calldesk']
    existing=config.get('mcpServers',{}).get('call-note')
    if existing and existing!=ENTRY:
        if set(existing) != set(ENTRY) or not (isinstance(existing.get('args'), list) and len(existing['args']) == 1 and isinstance(existing['args'][0], str) and existing['args'][0].endswith('/call_mcp.py')):
            raise ValueError('A different Claude Desktop call-note server already exists; no files changed.')
        existing=None
    if not existing:
        config.setdefault('mcpServers',{})['call-note']=ENTRY
        changes.append((claude,json.dumps(config,indent=2)+'\n'))
    return changes


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run',action='store_true')
    args=parser.parse_args()
    changes=plans(Path.home())
    stamp=datetime.now().strftime('%Y%m%d-%H%M%S')
    for path,contents in changes:
        if args.dry_run:
            print(f'Would add call-note to {path}')
            continue
        path.parent.mkdir(parents=True,exist_ok=True)
        if path.exists():
            backup=path.with_name(path.name+f'.calldesk-{stamp}.bak')
            shutil.copy2(path,backup)
            backup.chmod(0o600)
        fd,name=tempfile.mkstemp(dir=path.parent,prefix='.calldesk-')
        with os.fdopen(fd,'w') as output:
            output.write(contents)
        os.replace(name,path)
        print(f'Connected Call Note: {path}')
    print('Restart Codex and Claude Desktop to load the new server.' if changes else 'Call Note is already configured in both clients.')

if __name__=='__main__':
    main()
