import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.value = ''; this.attributes = {}; }
  append(node) { this.children.push(node); }
  replaceChildren() { this.children = []; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener() {}
  get options() { return this.children; }
}
const data = () => ({
  totals: { events: 4, activeInstallations: 2, callsStarted: 2, callsCompleted: 1, durationMinutes: 3, installations: 5 },
  daily: [{ day: '2026-10-14', activeInstallations: 2, events: 4, callsStarted: 2, callsCompleted: 1, durationMinutes: 3 }],
  versions: [{ version: '<script>alert(1)</script>', events: 4 }], platforms: [], features: [], errors: [],
  consent: { accepted: 5, analyticsEnabled: 2, termsVersion: 'v1', privacyVersion: 'v1' }
});
async function setup(response = {}) {
  const elements = new Map();
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    createElement: (tag) => new Element(tag), createElementNS: (_, tag) => new Element(tag)
  };
  for (const id of ['version', 'platform']) document.getElementById(id).append(new Element('option'));
  document.getElementById('days').value = '30';
  document.getElementById('metric').value = 'activeInstallations';
  const requests = [];
  const context = vm.createContext({ document, Intl, URLSearchParams, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => data(), ...response };
    }
  });
  vm.runInContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  return { context, get: document.getElementById, requests };
}

test('dashboard renders distinct-period installations separately from consent records and daily values', async () => {
  const { get } = await setup();
  assert.equal(get('results').hidden, false);
  assert.equal(get('activeInstallations').textContent, '2');
  assert.equal(get('installations').textContent, '5');
  assert.equal(get('accepted').textContent, '5');
  assert.equal(get('daily').children[0].children.length, 6);
  assert.deepEqual(get('daily').children[0].children.map((cell) => cell.textContent), ['2026-10-14', '2', '4', '2', '1', '3']);
  assert.equal(get('chart').children[0].tag, 'svg');
  assert.equal(get('versions').children[0].children[0].textContent, '<script>alert(1)</script>');
});

test('dashboard uses identical encoded filters for stats and CSV', async () => {
  const { context, get, requests } = await setup();
  get('days').value = '7'; get('version').value = '0.2.14'; get('platform').value = 'darwin';
  await vm.runInContext('refresh()', context);
  assert.equal(requests.at(-1).url, '/api/stats?days=7&version=0.2.14&platform=darwin');
  assert.equal(get('export').href, '/api/export.csv?days=7&version=0.2.14&platform=darwin');
  assert.equal(requests.at(-1).options.cache, 'no-store');
});

test('dashboard renders honest empty state and zero-filled daily chart', async () => {
  const empty = { totals: { events: 0 }, daily: [], versions: [], platforms: [], features: [], errors: [], consent: {} };
  const { context, get } = await setup({ json: async () => empty });
  assert.equal(get('status').hidden, false);
  assert.equal(get('chart').children[0].tag, 'p');
  assert.equal(get('events').textContent, '0');
  empty.daily = [{ day: '2026-10-14', activeInstallations: 0 }];
  context.fixture = empty;
  vm.runInContext('render(fixture)', context);
  assert.equal(get('chart').children[0].tag, 'svg');
});

test('dashboard hides metrics on Access rejection and malformed responses', async () => {
  for (const response of [{ status: 403, ok: false }, { json: async () => ({ totals: {} }) }, { headers: { get: () => 'text/html' } }]) {
    const { get } = await setup(response);
    assert.equal(get('results').hidden, true);
    assert.equal(get('status').className, 'status error');
    assert.equal(get('status').hidden, false);
  }
});
