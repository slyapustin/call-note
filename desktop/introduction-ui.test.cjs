const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const elements = new Map(), dismissed = [], errors = [];
  let menu, interval, resolveStatus, allowed = true, otherDialog = false;
  const document = {
    activeElement: null,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        open:false, hidden:false, disabled:false, isConnected:true, children:[], dataset:{}, listeners:{},
        focus() {document.activeElement = this;},
        showModal() {this.open = true;}, close() {this.open = false;},
        querySelectorAll() {return [];},
        addEventListener(name, callback) {this.listeners[name] = callback;},
      });
      return elements.get(id);
    },
    querySelector() {return otherDialog || document.getElementById('introduction').open ? {} : null;},
  };
  const bridge = {
    introductionStatus: () => new Promise(resolve => {resolveStatus = resolve;}),
    introductionDismiss: async kind => {dismissed.push(kind);},
    onIntroductionOpen: callback => {menu = callback;},
  };
  const context = vm.createContext({document, window:{addEventListener() {}},
    setInterval:callback => {interval = callback; return 1;}, clearInterval() {}});
  const source = fs.readFileSync(path.join(__dirname, 'ui/introduction.js'), 'utf8').replace('export function setupIntroduction', 'function setupIntroduction');
  vm.runInContext(source, context);
  const controller = context.setupIntroduction({bridge, version:'0.2.5', canOpen:()=>allowed, onError:message=>errors.push(message)});
  return {controller, dismissed, errors, bridge, get:id=>document.getElementById(id), menu:kind=>menu(kind),
    tick:()=>interval(), resolveStatus:state=>resolveStatus(state), allow:value=>{allowed=value;}, otherDialog:value=>{otherDialog=value;}};
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('starting capture suspends an open tour without dismissal and resumes its current step', async () => {
  const f = fixture();
  f.resolveStatus({kind:'tour'}); await settle();
  f.get('intro-next').onclick();
  const secondStep = f.get('intro-title').textContent;
  assert.match(f.get('intro-eyebrow').textContent, /2 of 3/);
  f.allow(false); f.controller.suspend(); f.tick();
  assert.equal(f.get('introduction').open, false);
  assert.deepEqual(f.dismissed, []);
  f.allow(true); f.tick();
  assert.equal(f.get('introduction').open, true);
  assert.equal(f.get('intro-title').textContent, secondStep);
  assert.match(f.get('intro-eyebrow').textContent, /2 of 3/);
  await f.get('intro-skip').onclick(); f.tick();
  assert.deepEqual(f.dismissed, ['tour']);
  assert.equal(f.get('introduction').open, false);
});

test('a delayed automatic status cannot override or repeat a manual Help request', async () => {
  const f = fixture();
  f.menu('news');
  const title = f.get('intro-title').textContent;
  f.resolveStatus({kind:'tour'}); await settle();
  assert.equal(f.get('intro-title').textContent, title);
  await f.get('intro-skip').onclick(); f.tick();
  assert.deepEqual(f.dismissed, ['news']);
  assert.equal(f.get('introduction').open, false);
});

test('reopening the current content does not queue another copy, and another Help item switches it', async () => {
  const f = fixture();
  f.resolveStatus({kind:'tour'}); await settle();
  f.menu('tour'); f.menu('news'); f.menu('news');
  assert.match(f.get('intro-eyebrow').textContent, /What’s new/);
  await f.get('intro-next').onclick(); f.tick();
  assert.deepEqual(f.dismissed, ['news']);
  assert.equal(f.get('introduction').open, false);
});

test('manual requests wait for recording and other dialogs to finish', async () => {
  const f = fixture();
  f.resolveStatus({kind:null}); await settle();
  f.allow(false); f.menu('tour'); f.tick();
  assert.equal(f.get('introduction').open, false);
  f.allow(true); f.otherDialog(true); f.tick();
  assert.equal(f.get('introduction').open, false);
  f.otherDialog(false); f.tick();
  assert.equal(f.get('introduction').open, true);
  assert.match(f.get('intro-eyebrow').textContent, /1 of 3/);
});

test('Escape closes the introduction even if saving its preference fails', async () => {
  const f = fixture();
  f.resolveStatus({kind:'tour'}); await settle();
  f.bridge.introductionDismiss = async () => {throw Error('Cannot save');};
  let prevented = false;
  f.get('introduction').listeners.cancel({preventDefault() {prevented = true;}});
  await settle(); f.tick();
  assert.equal(prevented, true);
  assert.equal(f.get('introduction').open, false);
  assert.equal(f.errors.length, 1);
});
