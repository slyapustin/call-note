const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CallDetectionLifecycle}=require('./call-detection-lifecycle.cjs');

function fixture(supported=true) {
  const calls=[];
  const lifecycle=new CallDetectionLifecycle({supported,start:()=>calls.push('start'),stop:()=>calls.push('stop')});
  return {lifecycle,calls};
}

test('monitor waits through engine loading and remains active while a lazy model warms',()=>{
  const f=fixture();
  f.lifecycle.observeEngine('loading');assert.deepEqual(f.calls,[]);
  f.lifecycle.observeEngine('idle');f.lifecycle.observeEngine('ready');assert.deepEqual(f.calls,['start']);
  f.lifecycle.observeEngine('loading');assert.deepEqual(f.calls,['start']);
  f.lifecycle.observeEngine('error');assert.deepEqual(f.calls,['start','stop']);
  f.lifecycle.observeEngine('error');assert.deepEqual(f.calls,['start','stop']);
  f.lifecycle.observeEngine('ready');assert.deepEqual(f.calls,['start','stop','start']);
});

test('suspend or renderer loss stops detection; loading does not restart it',()=>{
  const f=fixture();f.lifecycle.observeEngine('ready');f.lifecycle.stopMonitoring();
  f.lifecycle.observeEngine('loading');assert.deepEqual(f.calls,['start','stop']);
  f.lifecycle.observeEngine('idle');assert.deepEqual(f.calls,['start','stop','start']);
});

test('unsupported platforms never launch the native activity helper',()=>{
  const f=fixture(false);f.lifecycle.observeEngine('idle');f.lifecycle.observeEngine('ready');f.lifecycle.stopMonitoring();
  assert.deepEqual(f.calls,[]);
});
