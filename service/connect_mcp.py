#!/usr/bin/env python3
"""Print manual Call Note MCP setup instructions without reading or changing assistant settings."""
import argparse
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
PYTHON = os.environ.get('CALL_NOTE_PYTHON', sys.executable)


def setup_path(value):
    value = str(value)
    if not value or '\0' in value:
        raise ValueError('Invalid MCP setup path')
    value.encode('utf-8')
    return value


def toml_string(value):
    return json.dumps(value, ensure_ascii=False).replace('\x7f', '\\u007f')


def build_setup(home, python=PYTHON, server=ROOT / 'call_mcp.py'):
    command = setup_path(python)
    args = ['-B', setup_path(server)]
    home = Path(setup_path(home))
    return {
        'command': command,
        'args': args,
        'clients': [
            {
                'id': 'codex', 'label': 'Codex',
                'configPath': str(home / '.codex/config.toml'),
                'steps': [
                    'Open the config.toml path shown below in a text editor.',
                    'Add this section, preserving your existing settings and other servers. If [mcp_servers.call-note] already exists, update its command and args instead of adding a duplicate section.',
                    'Save the file, restart Codex, and check that the call-note MCP server is available.',
                ],
                'snippet': '[mcp_servers.call-note]\ncommand = ' + toml_string(command) + '\nargs = [' + ', '.join(map(toml_string, args)) + ']\n',
                'docsUrl': 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
            },
            {
                'id': 'claude', 'label': 'Claude Desktop',
                'configPath': str(home / 'Library/Application Support/Claude/claude_desktop_config.json'),
                'steps': [
                    'In the Claude Desktop menu, choose Settings → Developer → Edit Config.',
                    'If the file is empty, use the full example below. Otherwise, merge only the call-note entry into the existing mcpServers object. Preserve your other servers and settings; do not replace the entire existing file.',
                    'Save the file, quit and reopen Claude Desktop, and check that the call-note MCP server is available.',
                ],
                'snippet': json.dumps({'mcpServers': {'call-note': {'command': command, 'args': args}}}, indent=2, ensure_ascii=False) + '\n',
                'docsUrl': 'https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers',
            },
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='Compatibility option: this command always prints instructions only.')
    parser.parse_args()
    setup = build_setup(Path.home())
    print('Call Note MCP setup — manual instructions only.')
    print('No assistant configuration files were read or changed. Copy the snippet for the assistant you choose.\n')
    for client in setup['clients']:
        print(client['label'])
        print('Configuration: ' + client['configPath'])
        for index, step in enumerate(client['steps'], 1):
            print(f'{index}. {step}')
        print('\n' + client['snippet'])
        print('Documentation: ' + client['docsUrl'] + '\n')


if __name__ == '__main__':
    main()
