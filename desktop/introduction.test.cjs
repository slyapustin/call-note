const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Introduction} = require('./introduction.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'call-note-introduction-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  return {directory, version:'0.2.5'};
}

test('fresh installation keeps the tour pending after the service creates its database', t => {
  const options = fixture(t);
  const introduction = new Introduction(options);
  assert.deepEqual(introduction.status(), {kind:'tour', version:'0.2.5'});
  fs.writeFileSync(path.join(options.directory, 'calls.sqlite3'), 'service-created database');
  assert.deepEqual(new Introduction(options).status(), {kind:'tour', version:'0.2.5'});
  if(process.platform!=='win32')assert.equal(fs.statSync(path.join(options.directory, 'introduction.json')).mode & 0o777, 0o600);
});

test('existing installations see news, and dismissal survives restart', t => {
  const options = fixture(t);
  const database = path.join(options.directory, 'calls.sqlite3');
  fs.writeFileSync(database, 'existing database');
  const introduction = new Introduction(options);
  assert.deepEqual(introduction.status(), {kind:'news', version:'0.2.5'});
  assert.deepEqual(introduction.dismiss('news'), {kind:null, version:'0.2.5'});
  assert.equal(new Introduction(options).status().kind, null);
  assert.equal(fs.readFileSync(database, 'utf8'), 'existing database');
});

test('tour completion or skip marks the current version seen; an upgrade shows news once', t => {
  const options = fixture(t);
  const introduction = new Introduction(options);
  assert.deepEqual(introduction.dismiss('tour'), {kind:null, version:'0.2.5'});
  assert.equal(new Introduction(options).status().kind, null);
  const upgraded = new Introduction({...options, version:'0.2.6'});
  assert.deepEqual(upgraded.status(), {kind:'news', version:'0.2.6'});
  upgraded.dismiss('news');
  assert.equal(new Introduction({...options, version:'0.2.6'}).status().kind, null);
});

test('reading or reopening does not mark content seen; dismissing news does not skip a pending tour', t => {
  const options = fixture(t);
  const introduction = new Introduction(options);
  const file = path.join(options.directory, 'introduction.json');
  const before = fs.readFileSync(file, 'utf8');
  introduction.status(); introduction.status();
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  introduction.dismiss('news');
  assert.equal(new Introduction(options).status().kind, 'tour');
  introduction.dismiss('tour');
  assert.equal(new Introduction(options).status().kind, null);
});

test('malformed persistence is recovered using the pre-service database state', t => {
  const options = fixture(t);
  const file = path.join(options.directory, 'introduction.json');
  const invalid = ['{', 'null', '[]', '{"schema":2,"tourPending":false,"lastSeenVersion":"0.2.5"}',
    '{"schema":1,"tourPending":"false","lastSeenVersion":"0.2.5"}',
    '{"schema":1,"tourPending":false,"lastSeenVersion":{}}'];
  for (const contents of invalid) {
    fs.writeFileSync(file, contents);
    assert.equal(new Introduction(options).status().kind, 'tour');
  }
  fs.writeFileSync(path.join(options.directory, 'calls.sqlite3'), 'existing');
  fs.writeFileSync(file, '{');
  assert.equal(new Introduction(options).status().kind, 'news');
});

test('invalid dismissals cannot change persistent or in-memory state', t => {
  const options = fixture(t);
  const introduction = new Introduction(options);
  const file = path.join(options.directory, 'introduction.json');
  const before = fs.readFileSync(file, 'utf8');
  for (const kind of [undefined, null, '', 'complete', {}, ['tour']]) {
    assert.throws(() => introduction.dismiss(kind), /Invalid introduction kind/);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(introduction.status().kind, 'tour');
});

test('an atomic replacement failure preserves the prior state and removes temporary files', t => {
  const options = fixture(t);
  const filesystem = {...fs};
  const introduction = new Introduction({...options, filesystem});
  const file = path.join(options.directory, 'introduction.json');
  const before = fs.readFileSync(file, 'utf8');
  filesystem.renameSync = () => { throw Error('Cannot replace settings'); };
  assert.throws(() => introduction.dismiss('tour'), /Cannot replace settings/);
  assert.equal(introduction.status().kind, 'tour');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(options.directory), ['introduction.json']);
});


test('initial persistence failure does not prevent startup, but dismissal reports the failure', t => {
  const options = fixture(t);
  const filesystem = {...fs, writeFileSync:() => { throw Error('Read-only preferences'); }};
  const introduction = new Introduction({...options, filesystem});
  assert.deepEqual(introduction.status(), {kind:'tour', version:'0.2.5'});
  assert.throws(() => introduction.dismiss('tour'), /Read-only preferences/);
  assert.equal(introduction.status().kind, 'tour');
});
