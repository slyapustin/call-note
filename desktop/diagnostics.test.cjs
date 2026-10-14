const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Diagnostics} = require('./diagnostics.cjs');

function fixture(t, extra = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'call-note-diagnostics-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  const options = {directory, version:'0.2.5', versions:{electron:'44.7.0', chrome:'150.0.0.0', node:'24.1.0'}, platform:'darwin', arch:'arm64', osRelease:'25.1.0', ...extra};
  return {directory, options, diagnostics:new Diagnostics(options)};
}

test('clipboard failures are actionable without exporting the message, stack or custom payload', t => {
  const {directory, diagnostics} = fixture(t);
  const secret = 'private-call-transcript-person@example.com-password-123';
  const error = new Error(`Failed to execute 'writeText' on 'Clipboard': Write permission denied. ${secret}`);
  error.name = 'NotAllowedError';
  error.code = secret;
  error.stack = `secret source ${secret}`;
  error.transcript = secret;
  diagnostics.record('clipboard', error);
  const report = diagnostics.exportReport({updatePhase:'error', recording:false});
  assert.match(report, /clipboard-denied/);
  assert.match(report, /NotAllowedError/);
  assert.match(report, /Update phase: error/);
  assert.doesNotMatch(report, /private-call|writeText|secret source|person@example/);
  assert.doesNotMatch(fs.readFileSync(path.join(directory, 'diagnostics.jsonl'), 'utf8'), /private-call|writeText|secret source|person@example/);
  assert.equal(fs.statSync(path.join(directory, 'diagnostics.jsonl')).mode & 0o777, 0o600);
});

test('metadata, scopes, error fields and persisted events reject arbitrary strings', t => {
  const secret = 'PRIVATE-SECRETS';
  const {options, directory} = fixture(t, {version:secret, versions:{electron:secret, chrome:secret, node:secret}, platform:secret, arch:secret, osRelease:secret});
  fs.writeFileSync(path.join(directory, 'diagnostics.jsonl'), `${JSON.stringify({timestamp:new Date().toISOString(), scope:secret, category:secret, name:secret, code:secret, message:secret, stack:secret})}\n${JSON.stringify({timestamp:secret, scope:'renderer'})}\n`);
  const diagnostics = new Diagnostics(options);
  diagnostics.record(secret, {name:secret, code:secret, message:secret});
  const report = diagnostics.exportReport({updatePhase:secret, recording:secret});
  assert.doesNotMatch(report, /PRIVATE-SECRETS/);
  assert.match(report, /"scope":"app","category":"error"/);
  assert.match(report, /Update phase: unknown/);
});

test('service log exports only counts and reads only its last 64 KiB', t => {
  const opened = [], reads = [];
  const filesystem = {...fs, openSync(file, flags) { opened.push(path.basename(file)); return fs.openSync(file, flags); }, readSync(fd, buffer, offset, length, position) { reads.push({length, position}); return fs.readSync(fd, buffer, offset, length, position); }};
  const {directory, options} = fixture(t, {filesystem});
  fs.writeFileSync(path.join(directory, 'service.log'), 'PermissionError: excluded old message\n' + 'x'.repeat(100000) + '\n' + 'Traceback (most recent call last):\nPermissionError: password=my-very-secret-password\nINFO: 127.0.0.1 - "GET /api/private-meeting-title?token=abc HTTP/1.1" 500 Server Error\nModuleNotFoundError: secret-project\n');
  fs.writeFileSync(path.join(directory, 'credentials.json'), 'credential-secret');
  fs.writeFileSync(path.join(directory, 'calls.db'), 'transcript-secret');
  const report = new Diagnostics(options).exportReport();
  assert.match(report, /Permission errors: 1/);
  assert.match(report, /Python tracebacks: 1/);
  assert.match(report, /HTTP server errors: 1/);
  assert.match(report, /Missing dependencies: 1/);
  assert.match(report, /truncated/);
  assert.doesNotMatch(report, /password=|private-meeting-title|token=|secret-project|credential-secret|transcript-secret/);
  assert.ok(opened.every(file => ['diagnostics.jsonl', 'service.log'].includes(file)));
  assert.ok(reads.every(read => read.length <= 64 * 1024));
  assert.ok(reads.some(read => read.position > 0));
});

test('event storage stays bounded and retains the newest sanitized 100 events across restarts', t => {
  const {diagnostics, directory, options} = fixture(t);
  diagnostics.record('renderer', {name:'SyntaxError', message:'old error'});
  for (let i = 0; i < 150; i++) diagnostics.record('updater', {name:'Error', code:'ECONNREFUSED', message:'https://secret-host/?token=very-secret'});
  const file = path.join(directory, 'diagnostics.jsonl');
  assert.ok(fs.statSync(file).size <= 100 * 1024);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 100);
  const report = new Diagnostics(options).exportReport();
  assert.equal((report.match(/"category":"network"/g) || []).length, 100);
  assert.doesNotMatch(report, /SyntaxError|secret-host|very-secret/);
  assert.deepEqual(fs.readdirSync(directory), ['diagnostics.jsonl']);
});

test('oversized or malformed historical diagnostics are bounded and sanitized again', t => {
  const reads = [];
  const filesystem = {...fs, readSync(fd, buffer, offset, length, position) { reads.push(length); return fs.readSync(fd, buffer, offset, length, position); }};
  const {directory, options} = fixture(t, {filesystem});
  fs.writeFileSync(path.join(directory, 'diagnostics.jsonl'), 'not-json-secret'.repeat(20000) + '\n' + JSON.stringify({timestamp:new Date().toISOString(), scope:'service', category:'network', code:'ECONNRESET', message:'secret-transcript'}) + '\n');
  const diagnostics = new Diagnostics(options);
  const report = diagnostics.exportReport();
  assert.match(report, /ECONNRESET/);
  assert.doesNotMatch(report, /secret-transcript|not-json-secret/);
  assert.ok(reads.every(length => length <= 100 * 1024));
  diagnostics.record('renderer', new Error('generic'));
  assert.ok(fs.statSync(path.join(directory, 'diagnostics.jsonl')).size <= 100 * 1024);
});

test('unreadable logs and unwritable persistence do not prevent diagnostics for the current session', t => {
  const {diagnostics} = fixture(t, {filesystem:{...fs, openSync() { throw Error('No access to secret-path'); }, writeFileSync() { throw Error('No access to secret-path'); }}});
  assert.doesNotThrow(() => diagnostics.record('service', {name:'Error', message:'service exited'}));
  const report = diagnostics.exportReport();
  assert.match(report, /service-exit/);
  assert.match(report, /Service log: unavailable/);
  assert.doesNotMatch(report, /secret-path/);
});
