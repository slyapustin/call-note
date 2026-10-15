import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { generateKeyPair, SignJWT } from 'jose';
import worker, { verifyAccess, stats, csv } from '../src/worker.js';

let mf, env;
const installationId = crypto.randomUUID(), secret = 'a'.repeat(64);
const consent = { installationId, secret, termsVersion:'2026-10-15', privacyVersion:'2026-10-15', analytics:true, revision:1 };
const event = () => ({ id: crypto.randomUUID(), name:'app_open', day:new Date().toISOString().slice(0,10), version:'0.2.14', platform:'darwin' });
async function request(path, data, method = 'POST') {
  return worker.fetch(new Request(`https://test.example${path}`, { method, headers:{'content-type':'application/json'}, ...(data ? {body:JSON.stringify(data)} : {}) }), env);
}
before(async () => {
  mf = new Miniflare({ modules:true, script:'export default {fetch(){return new Response("ok")}}', d1Databases:['DB'], compatibilityDate:'2026-08-06' });
  env = { INGEST_LIMITER: {limit:async () => ({success:true})}, DB: await mf.getD1Database('DB'), ASSETS:{fetch:() => {throw new Error('assets must stay protected');}} };
  const migration = (await Promise.all(['0001_analytics.sql','0002_deletion_tombstones.sql'].map(name => readFile(new URL(`../migrations/${name}`, import.meta.url),'utf8')))).join('\n');
  await env.DB.batch(migration.split(';').filter(sql => sql.trim()).map(sql => env.DB.prepare(sql)));
});
after(async () => { await mf?.dispose(); });
test('dashboard, CSV and every asset fail closed without Access configuration', async () => {
  for (const path of ['/','/index.html','/dashboard.js','/api/stats','/api/export.csv']) assert.equal((await request(path, null, 'GET')).status,401);
  assert.equal((await request('/health',null,'GET')).status,200);
});
test('registration records server time, hashes secret and rejects unknown fields', async () => {
  assert.equal((await request('/v1/consent',{...consent,email:'private@example.com'})).status,400);
  assert.equal((await request('/v1/consent',consent)).status,200);
  const row = await env.DB.prepare('SELECT * FROM installations WHERE id=?').bind(installationId).first();
  assert.notEqual(row.secret_hash,secret); assert.equal(row.secret_hash.length,64); assert.ok(Date.parse(row.accepted_at));
  assert.equal((await request('/v1/consent',{...consent,secret:'b'.repeat(64),revision:2})).status,401);
});
test('events require registered secret, explicit consent, strict schema and deduplicate', async () => {
  const item = event();
  assert.equal((await request('/v1/events',{installationId,secret:'b'.repeat(64),events:[item]})).status,401);
  assert.equal((await request('/v1/events',{installationId,secret,events:[{...item,transcript:'private'}]})).status,400);
  assert.equal((await request('/v1/events',{installationId,secret,events:[{...item,feature:'private'}]})).status,400);
  assert.equal((await request('/v1/events',{installationId,secret,events:Array.from({length:21},event)})).status,400);
  assert.equal((await request('/v1/events',{installationId,secret,events:[{...item,day:'2026-02-30'}]})).status,400);
  assert.equal((await (await request('/v1/events',{installationId,secret,events:[item,item]})).json()).accepted,1);
  assert.equal((await (await request('/v1/events',{installationId,secret,events:[item]})).json()).accepted,0);
});
test('revocation is monotonic and stale opt-in cannot restore collection', async () => {
  assert.equal((await request('/v1/consent',{...consent,analytics:false,revision:2})).status,200);
  assert.equal((await request('/v1/consent',consent)).status,409);
  assert.equal((await request('/v1/consent',{...consent,revision:2})).status,409);
  assert.equal((await request('/v1/events',{installationId,secret,events:[event()]})).status,403);
  const records = await env.DB.prepare('SELECT * FROM consent_records WHERE installation_id=? ORDER BY revision').bind(installationId).all();
  assert.deepEqual(records.results.map(r => r.analytics),[1,0]);
});
test('aggregates and CSV contain no installation identifiers, credentials or raw fields', async () => {
  const data = await stats(new URL('https://test.example/api/stats?days=7'),env);
  assert.equal(data.totals.events,1); assert.equal(data.totals.installations,1); assert.equal(data.totals.analyticsEnabled,0);
  assert.equal(data.daily.at(-1).activeInstallations,1);
  assert.equal(data.totals.activeInstallations,1);
  assert.equal(data.daily.length,7);
  assert.equal(data.daily[0].events,0);
  const filtered = await stats(new URL('https://test.example/api/stats?days=30&platform=win32&version=0.0.0'),env);
  assert.equal(filtered.totals.events,0); assert.equal(filtered.consent.accepted,1); assert.equal(filtered.totals.installations,1);
  const output = JSON.stringify(data)+csv(data);
  for (const value of [installationId,secret,'secret_hash','private@example.com']) assert.ok(!output.includes(value));
  assert.match(csv(data),/^day,events,activeInstallations,callsStarted,callsCompleted,durationMinutes\r\n/);
  await assert.rejects(stats(new URL('https://test.example/api/stats?version=%3Dcmd'),env));
});
test('body size bounded and errors do not echo payloads', async () => {
  const response = await request('/v1/events',{private:'x'.repeat(17000)});
  assert.equal(response.status,413); assert.deepEqual(await response.json(),{error:'body_too_large'});
});
test('Access validates signature, issuer, audience and expiry', async () => {
  const {privateKey, publicKey} = await generateKeyPair('RS256');
  const config = { ACCESS_TEAM_DOMAIN:'example.cloudflareaccess.com', ACCESS_AUD:'test-audience' };
  const token = async (issuer = 'https://example.cloudflareaccess.com',audience='test-audience',expiry='2m') => new SignJWT({}).setProtectedHeader({alg:'RS256'}).setSubject('test-user').setIssuedAt().setIssuer(issuer).setAudience(audience).setExpirationTime(expiry).sign(privateKey);
  const check = async value => verifyAccess(new Request('https://test.example',{headers:{'cf-access-jwt-assertion':value}}), config,publicKey);
  assert.equal(await check(await token()),true);
  assert.equal(await check(await token('https://evil.example')),false);
  assert.equal(await check(await token(undefined,'wrong')),false);
  assert.equal(await check(await token(undefined,undefined,'-1m')),false);
  assert.equal(await check('forged'),false);
  assert.equal(await verifyAccess(new Request('https://test.example'),{},publicKey),false);
});
test('scheduled retention deletes old usage and keeps consent; deletion cascades', async () => {
  await env.DB.prepare(`INSERT INTO usage_events VALUES (?,?,'app_open','2000-01-01','0.2.14','darwin',NULL,NULL,NULL,'2000-01-01')`).bind(crypto.randomUUID(),installationId).run();
  await worker.scheduled({},env);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM usage_events').first()).n,1);
  assert.equal((await request('/v1/installation',{installationId,secret:'b'.repeat(64)},'DELETE')).status,200);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM installations').first()).n,1);
  assert.equal((await request('/v1/installation',{installationId,secret},'DELETE')).status,200);
  for (const table of ['installations','usage_events','consent_records']) assert.equal((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,0);
});

test('deletion tombstones block late consent and retain only installation hash for 90 days', async () => {
  assert.equal((await request('/v1/consent',{...consent,revision:99})).status,410);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM installations').first()).n,0);
  const row = await env.DB.prepare('SELECT * FROM deletion_tombstones').first();
  assert.deepEqual(Object.keys(row).sort(),['expires_at','installation_hash']);
  assert.equal(row.installation_hash.length,64); assert.notEqual(row.installation_hash,installationId);
  assert.ok(Math.abs(Date.parse(row.expires_at)-Date.now()-90*86400000)<10000);
  const pending = {...consent, installationId:crypto.randomUUID()};
  assert.equal((await request('/v1/installation',{installationId:pending.installationId,secret},'DELETE')).status,200);
  assert.equal((await request('/v1/consent',pending)).status,410);
  const racing = {...consent,installationId:crypto.randomUUID()};
  await Promise.all([request('/v1/consent',racing),request('/v1/installation',{installationId:racing.installationId,secret},'DELETE')]);
  assert.equal((await request('/v1/consent',{...racing,revision:2})).status,410);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM installations').first()).n,0);
  await env.DB.prepare("INSERT INTO deletion_tombstones VALUES (?, '2000-01-01')").bind('c'.repeat(64)).run();
  await worker.scheduled({},env);
  assert.equal(await env.DB.prepare('SELECT 1 FROM deletion_tombstones WHERE installation_hash=?').bind('c'.repeat(64)).first(),null);
});

test('ingestion rate limiter fails closed before DB and hashes IP without persisting it', async () => {
  const db = {prepare:() => {throw new Error('DB must not be touched');},batch:() => {throw new Error('DB must not be touched');}};
  let keys = [];
  const limiter = {limit:async ({key}) => {keys.push(key);return {success:false};}};
  for (const [path,method,payload] of [['/v1/consent','POST',consent],['/v1/events','POST',{installationId,secret,events:[event()]}],['/v1/installation','DELETE',{installationId,secret}]]) {
    const req = () => new Request(`https://test.example${path}`,{method,headers:{'content-type':'application/json','cf-connecting-ip':'192.0.2.1'},body:JSON.stringify(payload)});
    const denied = await worker.fetch(req(),{DB:db,INGEST_LIMITER:limiter});
    assert.equal(denied.status,429);assert.equal(denied.headers.get('retry-after'),'60');
    assert.deepEqual(await denied.json(),{error:'rate_limited'});
    assert.equal((await worker.fetch(req(),{DB:db})).status,503);
  }
  assert.equal(new Set(keys).size,1);assert.match(keys[0],/^[a-f0-9]{64}$/);assert.ok(!keys[0].includes('192.0.2.1'));
  const calls = keys.length;
  for (const [raw,status] of [['{broken',400],['x'.repeat(17000),413]]) {
    const response = await worker.fetch(new Request('https://test.example/v1/consent',{method:'POST',headers:{'content-type':'application/json'},body:raw}),{DB:db,INGEST_LIMITER:limiter});
    assert.equal(response.status,status);
  }
  assert.equal(keys.length,calls);
  assert.equal((await worker.fetch(new Request('https://test.example/health'),{DB:db})).status,200);
});

test('dashboard-only worker disables ingestion before body, rate limiter or database access', async () => {
  const blocked = {DASHBOARD_ONLY:'true',DB:{prepare:()=>{throw new Error('DB must not be touched');}},INGEST_LIMITER:{limit:()=>{throw new Error('limiter must not be touched');}}};
  for (const [path,method] of [['/v1/consent','POST'],['/v1/events','POST'],['/v1/installation','DELETE']]) {
    const response = await worker.fetch(new Request(`https://dashboard.example${path}`,{method,body:'invalid JSON'}),blocked);
    assert.equal(response.status,404);assert.deepEqual(await response.json(),{error:'not_found'});
  }
  assert.equal((await worker.fetch(new Request('https://dashboard.example/health'),blocked)).status,200);
  for (const path of ['/','/api/stats','/api/export.csv','/app.js']) assert.equal((await worker.fetch(new Request(`https://dashboard.example${path}`),blocked)).status,401);
});

test('window active installations are distinct across days and daily series includes every zero day', async () => {
  const id = crypto.randomUUID();
  assert.equal((await request('/v1/consent',{...consent,installationId:id})).status,200);
  const yesterday = new Date();yesterday.setUTCDate(yesterday.getUTCDate()-1);
  const items = [event(),{...event(),day:yesterday.toISOString().slice(0,10)}];
  assert.equal((await request('/v1/events',{installationId:id,secret,events:items})).status,200);
  for (const days of [7,30,90]) {
    const data = await stats(new URL(`https://test.example/api/stats?days=${days}`),env);
    assert.equal(data.totals.activeInstallations,1);
    assert.equal(data.daily.length,days);
    assert.equal(data.daily.reduce((sum,row)=>sum+row.activeInstallations,0),2);
    assert.deepEqual(data.daily[0],{day:data.daily[0].day,activeInstallations:0,events:0,callsStarted:0,callsCompleted:0,durationMinutes:0});
    assert.equal(new Set(data.daily.map(row=>row.day)).size,days);
    const empty = await stats(new URL(`https://test.example/api/stats?days=${days}&platform=win32`),env);
    assert.equal(empty.totals.activeInstallations,0);assert.equal(empty.daily.length,days);assert.ok(empty.daily.every(row=>row.events===0));
  }
  await request('/v1/installation',{installationId:id,secret},'DELETE');
});
