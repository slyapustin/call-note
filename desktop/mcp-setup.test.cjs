const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {buildMcpSetup} = require('./mcp-setup.cjs');

const options = {python:'/Applications/Call Note.app/Contents/Resources/python/bin/python3.13', server:'/Applications/Call Note.app/Contents/Resources/service/call_mcp.py', home:'/Users/example'};

test('manual setup exposes both clients with exact bundled executable and server paths', () => {
  const setup = buildMcpSetup(options);
  assert.equal(setup.command, options.python);
  assert.deepEqual(setup.args, ['-B', options.server]);
  assert.deepEqual(setup.clients.map(client => client.id), ['codex', 'claude']);
  assert.equal(setup.clients[0].configPath, '/Users/example/.codex/config.toml');
  assert.equal(setup.clients[1].configPath, '/Users/example/Library/Application Support/Claude/claude_desktop_config.json');
  assert.match(setup.clients[0].steps.join(' '), /preserving your existing settings/);
  assert.match(setup.clients[0].steps.join(' '), /instead of adding a duplicate/);
  assert.match(setup.clients[1].steps.join(' '), /merge only the call-note entry/);
  assert.match(setup.clients[1].steps.join(' '), /do not replace the entire existing file/);
});

test('TOML and JSON parse to original paths containing spaces, quotes, backslashes and Unicode', () => {
  const folders = ['Call Note.app', 'Call "Note" \\ app', 'Łódź 日本語 🎙️', 'new\nline\tdelete\x7f'];
  const cases = folders.map(folder => {
    const python = `/Applications/${folder}/python3.13`, server = `/Applications/${folder}/call_mcp.py`;
    const setup = buildMcpSetup({python, server, home:'/Users/example'});
    assert.deepEqual(JSON.parse(setup.clients[1].snippet), {mcpServers:{'call-note':{command:python, args:['-B', server]}}});
    return {snippet:setup.clients[0].snippet, expected:{mcp_servers:{'call-note':{command:python, args:['-B', server]}}}};
  });
  const venv = path.resolve(__dirname, process.platform==='win32'?'../.venv/Scripts/python.exe':'../.venv/bin/python');
  const python = fs.existsSync(venv)?venv:(process.platform==='win32'?'python':'python3');
  const program = 'import json,sys,tomllib\nfor case in json.load(sys.stdin):\n assert tomllib.loads(case["snippet"]) == case["expected"]\nprint("valid")';
  assert.equal(execFileSync(python, ['-X', 'utf8', '-B', '-c', program], {input:JSON.stringify(cases), encoding:'utf8'}).trim(), 'valid');
});

test('instruction generation has no filesystem or subprocess capability', () => {
  const source = fs.readFileSync(path.join(__dirname, 'mcp-setup.cjs'), 'utf8');
  const context = {module:{exports:{}}, require:name => {assert.equal(name, 'node:path', 'Only pure path operations are allowed'); return path;}};
  vm.runInNewContext(source, context);
  const setup = context.module.exports.buildMcpSetup(options);
  assert.equal(setup.clients.length, 2);
  assert.equal(setup.clients[0].snippet, buildMcpSetup(options).clients[0].snippet);
});

test('invalid path values cannot produce misleading or invalid snippets', () => {
  for (const key of ['python', 'server', 'home']) {
    for (const value of [undefined, null, {}, '', 'path\0suffix', '\ud800', '\udc00']) {
      assert.throws(() => buildMcpSetup({...options, [key]:value}), /Invalid MCP setup path/);
    }
  }
});

test('Windows setup uses roaming AppData and preserves escaped executable paths',()=>{
  const python=String.raw`C:\Program Files\Call Note\resources\python\python.exe`;
  const server=String.raw`C:\Program Files\Call Note\resources\service\call_mcp.py`;
  const setup=buildMcpSetup({python,server,home:String.raw`C:\Users\Jane`,platform:'win32',appData:String.raw`D:\Roaming Profile`});
  assert.equal(setup.clients[0].configPath,String.raw`C:\Users\Jane\.codex\config.toml`);
  assert.equal(setup.clients[1].configPath,String.raw`D:\Roaming Profile\Claude\claude_desktop_config.json`);
  assert.deepEqual(JSON.parse(setup.clients[1].snippet).mcpServers['call-note'],{command:python,args:['-B',server]});
  assert.match(setup.clients[0].snippet,/C:\\\\Program Files/);
});
