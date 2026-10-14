const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {ThemePreference} = require('./theme.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'call-note-theme-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  return {directory, nativeTheme:{themeSource:'dark'}};
}

test('new installations follow system appearance without requiring a writable settings file', t => {
  const options = fixture(t);
  const filesystem = {...fs, writeFileSync:() => { throw Error('Read-only'); }};
  const theme = new ThemePreference({...options, filesystem});
  assert.equal(theme.source, 'system');
  assert.equal(options.nativeTheme.themeSource, 'system');
  assert.equal(fs.existsSync(path.join(options.directory, 'theme.json')), false);
});

test('light, dark, and system choices apply natively and survive restart', t => {
  const options = fixture(t);
  const theme = new ThemePreference(options);
  for (const source of ['light', 'dark', 'system']) {
    assert.deepEqual(theme.set(source), {source, persisted:true});
    assert.equal(options.nativeTheme.themeSource, source);
    const nativeTheme = {};
    assert.equal(new ThemePreference({...options, nativeTheme}).source, source);
    assert.equal(nativeTheme.themeSource, source);
  }
  if(process.platform!=='win32')assert.equal(fs.statSync(path.join(options.directory, 'theme.json')).mode & 0o777, 0o600);
});

test('malformed, unsupported, and unreadable preferences fall back to system', t => {
  const options = fixture(t);
  for (const contents of ['{', 'null', '[]', '{"schema":1,"source":"automatic"}', '{"schema":2,"source":"dark"}', '{"schema":1,"source":["dark"]}']) {
    fs.writeFileSync(path.join(options.directory, 'theme.json'), contents);
    assert.equal(new ThemePreference(options).source, 'system');
  }
  const filesystem = {...fs, readFileSync:() => { throw Error('Unreadable'); }};
  assert.equal(new ThemePreference({...options, filesystem}).source, 'system');
});

test('invalid selections do not change either native appearance or saved preference', t => {
  const options = fixture(t);
  const theme = new ThemePreference(options);
  theme.set('dark');
  const file = path.join(options.directory, 'theme.json');
  const before = fs.readFileSync(file, 'utf8');
  for (const source of [null, undefined, '', 'automatic', {}, ['light']]) {
    assert.throws(() => theme.set(source), /Invalid appearance/);
  }
  assert.equal(theme.source, 'dark');
  assert.equal(options.nativeTheme.themeSource, 'dark');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('failed atomic persistence keeps the choice working for the session and preserves saved state', t => {
  const options = fixture(t);
  const filesystem = {...fs};
  const theme = new ThemePreference({...options, filesystem});
  theme.set('light');
  const file = path.join(options.directory, 'theme.json');
  const before = fs.readFileSync(file, 'utf8');
  filesystem.renameSync = () => { throw Error('Cannot replace settings'); };
  assert.deepEqual(theme.set('dark'), {source:'dark', persisted:false});
  assert.equal(options.nativeTheme.themeSource, 'dark');
  assert.equal(theme.source, 'dark');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(options.directory), ['theme.json']);
});
