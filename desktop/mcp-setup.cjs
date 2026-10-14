const path = require('node:path');

function setupPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) {
    throw Error('Invalid MCP setup path');
  }
  return value;
}

function tomlString(value) {
  return JSON.stringify(value).replace(/\x7f/g, '\\u007f');
}

function buildMcpSetup({python, server, home}) {
  const command = setupPath(python);
  const args = ['-B', setupPath(server)];
  setupPath(home);
  return {
    command, args,
    clients:[
      {
        id:'codex', label:'Codex', configPath:path.join(home, '.codex', 'config.toml'),
        steps:[
          'Open the config.toml path shown below in a text editor.',
          'Add this section, preserving your existing settings and other servers. If [mcp_servers.call-note] already exists, update its command and args instead of adding a duplicate section.',
          'Save the file, restart Codex, and check that the call-note MCP server is available.',
        ],
        snippet:`[mcp_servers.call-note]\ncommand = ${tomlString(command)}\nargs = [${args.map(tomlString).join(', ')}]\n`,
        docsUrl:'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
      },
      {
        id:'claude', label:'Claude Desktop', configPath:path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
        steps:[
          'In the Claude Desktop menu, choose Settings → Developer → Edit Config.',
          'If the file is empty, use the full example below. Otherwise, merge only the call-note entry into the existing mcpServers object. Preserve your other servers and settings; do not replace the entire existing file.',
          'Save the file, quit and reopen Claude Desktop, and check that the call-note MCP server is available.',
        ],
        snippet:JSON.stringify({mcpServers:{'call-note':{command, args}}}, null, 2) + '\n',
        docsUrl:'https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers',
      },
    ],
  };
}

module.exports = {buildMcpSetup};
