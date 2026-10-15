import { createRemoteJWKSet, jwtVerify } from 'jose';

export const POLICY_VERSION = '2026-10-15';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:\.\d{1,4})?$/;
const NAMES = ['app_open', 'call_started', 'call_completed', 'feature_used', 'error'];
const FEATURES = ['calendar', 'sample', 'export', 'mcp_setup'];
const ERRORS = ['capture_connection', 'capture_backpressure', 'capture_ended', 'renderer_gone', 'other'];
const keys = new Map();
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
class HttpError extends Error { constructor(status, code) { super(code); this.status = status; } }
function fail(status, code) { throw new HttpError(status, code); }
function json(value, status = 200) { return Response.json(value, { status, headers }); }
function exact(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(400, 'invalid_fields');
}
async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'json_required');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'invalid_json');
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 16384) { await reader.cancel(); fail(413, 'body_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail(400, 'invalid_json'); }
}
async function credentials(data) {
  if (typeof data.installationId !== 'string' || !UUID.test(data.installationId) || typeof data.secret !== 'string' || !/^[a-f0-9]{64}$/.test(data.secret)) fail(400, 'invalid_credentials');
  data.installationId = data.installationId.toLowerCase();
  return digest(data.secret);
}
async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function authenticate(db, data, hash) {
  const row = await db.prepare('SELECT * FROM installations WHERE id = ? AND secret_hash = ?').bind(data.installationId, hash).first();
  if (!row) fail(401, 'unauthorized');
  return row;
}
export async function verifyAccess(request, env, resolver) {
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN || '') || !env.ACCESS_AUD) return false;
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return false;
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  try {
    if (!resolver) {
      if (!keys.has(issuer)) keys.set(issuer, createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)));
      resolver = keys.get(issuer);
    }
    await jwtVerify(token, resolver, { issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub'] });
    return true;
  } catch { return false; }
}
async function consent(data, env) {
  exact(data, ['installationId', 'secret', 'termsVersion', 'privacyVersion', 'analytics', 'revision']);
  const hash = await credentials(data);
  if (data.termsVersion !== POLICY_VERSION || data.privacyVersion !== POLICY_VERSION || typeof data.analytics !== 'boolean' || !Number.isSafeInteger(data.revision) || data.revision < 1) fail(400, 'invalid_consent');
  const now = new Date().toISOString();
  const installationHash = await digest(data.installationId.toLowerCase());
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO installations SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM deletion_tombstones WHERE installation_hash=? AND expires_at>?)
      ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, analytics=excluded.analytics,
      terms_version=excluded.terms_version, privacy_version=excluded.privacy_version, updated_at=excluded.updated_at
      WHERE installations.secret_hash=excluded.secret_hash AND installations.revision < excluded.revision`)
      .bind(data.installationId, hash, data.revision, Number(data.analytics), data.termsVersion, data.privacyVersion, now, now, installationHash, now),
    env.DB.prepare(`INSERT OR IGNORE INTO consent_records SELECT id, revision, analytics, terms_version, privacy_version, updated_at
      FROM installations WHERE id=? AND secret_hash=?`).bind(data.installationId, hash)
  ]);
  if (await env.DB.prepare('SELECT 1 FROM deletion_tombstones WHERE installation_hash=? AND expires_at>?').bind(installationHash, now).first()) fail(410, 'installation_deleted');
  const row = await authenticate(env.DB, data, hash);
  if (row.revision !== data.revision || row.analytics !== Number(data.analytics)) fail(409, 'stale_revision');
  return json({ ok: true, revision: row.revision, analytics: Boolean(row.analytics) });
}
function validateEvent(event) {
  exact(event, ['id', 'name', 'day', 'version', 'platform', 'feature', 'errorCode', 'durationMinutes']);
  if (typeof event.id !== 'string' || !UUID.test(event.id) || !NAMES.includes(event.name) || typeof event.version !== 'string' || !VERSION.test(event.version) || !['darwin', 'win32'].includes(event.platform)) fail(400, 'invalid_event');
  const now = new Date(); const oldest = new Date(now); oldest.setUTCDate(oldest.getUTCDate() - 89);
  if (typeof event.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(event.day) || Number.isNaN(Date.parse(event.day)) || new Date(event.day).toISOString().slice(0,10) !== event.day || event.day < oldest.toISOString().slice(0,10) || event.day > now.toISOString().slice(0,10)) fail(400, 'invalid_day');
  if ((event.name === 'feature_used') !== Object.hasOwn(event, 'feature') || ('feature' in event && !FEATURES.includes(event.feature))) fail(400, 'invalid_feature');
  if ((event.name === 'error') !== Object.hasOwn(event, 'errorCode') || ('errorCode' in event && !ERRORS.includes(event.errorCode))) fail(400, 'invalid_error');
  if ('durationMinutes' in event && (event.name !== 'call_completed' || !Number.isInteger(event.durationMinutes) || event.durationMinutes < 0 || event.durationMinutes > 1440)) fail(400, 'invalid_duration');
}
async function events(data, env) {
  exact(data, ['installationId', 'secret', 'events']);
  const hash = await credentials(data);
  if (!Array.isArray(data.events) || data.events.length < 1 || data.events.length > 20) fail(400, 'invalid_batch');
  data.events.forEach(validateEvent);
  const row = await authenticate(env.DB, data, hash);
  if (!row.analytics) fail(403, 'analytics_disabled');
  const result = await env.DB.batch(data.events.map(event => env.DB.prepare(`INSERT OR IGNORE INTO usage_events
    SELECT ?, id, ?, ?, ?, ?, ?, ?, ?, ? FROM installations WHERE id=? AND secret_hash=? AND analytics=1`)
    .bind(event.id, event.name, event.day, event.version, event.platform, event.feature ?? null, event.errorCode ?? null, event.durationMinutes ?? null, new Date().toISOString(), data.installationId, hash)));
  return json({ ok: true, accepted: result.reduce((sum, item) => sum + item.meta.changes, 0) });
}
async function remove(data, env) {
  exact(data, ['installationId', 'secret']); const hash = await credentials(data);
  const installationHash = await digest(data.installationId.toLowerCase());
  const expiresAt = new Date(Date.now() + 90 * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO deletion_tombstones
      SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM installations WHERE id=?)
      OR EXISTS (SELECT 1 FROM installations WHERE id=? AND secret_hash=?)
      ON CONFLICT(installation_hash) DO UPDATE SET expires_at=MAX(deletion_tombstones.expires_at, excluded.expires_at)`)
      .bind(installationHash, expiresAt, data.installationId, data.installationId, hash),
    env.DB.prepare('DELETE FROM installations WHERE id=? AND secret_hash=?').bind(data.installationId, hash)
  ]);
  return json({ ok: true });
}
export async function stats(url, env) {
  if ([...url.searchParams.keys()].some(key => !['days','version','platform'].includes(key))) fail(400, 'invalid_filter');
  const days = Number(url.searchParams.get('days') || 30);
  const version = url.searchParams.get('version'), platform = url.searchParams.get('platform');
  if (![7,30,90].includes(days) || (version && !VERSION.test(version)) || (platform && !['darwin','win32'].includes(platform))) fail(400, 'invalid_filter');
  const start = new Date(); start.setUTCDate(start.getUTCDate() - days + 1);
  const clauses = ['day >= ?']; const args = [start.toISOString().slice(0,10)];
  if (version) { clauses.push('version = ?'); args.push(version); }
  if (platform) { clauses.push('platform = ?'); args.push(platform); }
  const where = clauses.join(' AND ');
  const query = sql => env.DB.prepare(sql).bind(...args);
  const aggregate = `COUNT(*) AS events, COALESCE(SUM(name='call_started'),0) AS callsStarted, COALESCE(SUM(name='call_completed'),0) AS callsCompleted, COALESCE(SUM(duration_minutes),0) AS durationMinutes`;
  const results = await env.DB.batch([
    query(`SELECT COUNT(DISTINCT installation_id) AS activeInstallations, ${aggregate} FROM usage_events WHERE ${where}`),
    query(`SELECT day, COUNT(DISTINCT installation_id) AS activeInstallations, ${aggregate} FROM usage_events WHERE ${where} GROUP BY day ORDER BY day`),
    ...[['version','version'],['platform','platform'],['feature','feature'],['error_code','errorCode']].map(([column, alias]) => query(`SELECT ${column} AS ${alias}, COUNT(*) AS events FROM usage_events WHERE ${where} AND ${column} IS NOT NULL GROUP BY ${column} ORDER BY events DESC`)),
    env.DB.prepare('SELECT COUNT(*) AS installations, COALESCE(SUM(analytics),0) AS analyticsEnabled FROM installations'),
    env.DB.prepare('SELECT COUNT(*) AS accepted, COALESCE(SUM(analytics),0) AS analyticsEnabled FROM installations WHERE terms_version=? AND privacy_version=?').bind(POLICY_VERSION, POLICY_VERSION)
  ]);
  const recordedDays = new Map(results[1].results.map(row => [row.day, row]));
  const daily = Array.from({ length: days }, (_, index) => {
    const date = new Date(start); date.setUTCDate(date.getUTCDate() + index);
    const day = date.toISOString().slice(0, 10);
    return recordedDays.get(day) ?? { day, activeInstallations: 0, events: 0, callsStarted: 0, callsCompleted: 0, durationMinutes: 0 };
  });
  return { days, totals: { ...results[0].results[0], ...results[6].results[0] }, daily, versions: results[2].results, platforms: results[3].results, features: results[4].results, errors: results[5].results, consent: { termsVersion: POLICY_VERSION, privacyVersion: POLICY_VERSION, ...results[7].results[0] } };
}
export function csv(data) {
  const fields = ['day','events','activeInstallations','callsStarted','callsCompleted','durationMinutes'];
  return [fields.join(','), ...data.daily.map(row => fields.map(key => String(row[key])).join(','))].join('\r\n') + '\r\n';
}
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true });
      if (env.DASHBOARD_ONLY === 'true' && url.pathname.startsWith('/v1/')) return json({ error: 'not_found' }, 404);
      const ingestion = url.pathname === '/v1/consent' && request.method === 'POST' ? consent
        : url.pathname === '/v1/events' && request.method === 'POST' ? events
          : url.pathname === '/v1/installation' && request.method === 'DELETE' ? remove : null;
      if (ingestion) {
        const data = await body(request);
        if (!env.INGEST_LIMITER) return json({ error: 'ingestion_unavailable' }, 503);
        const address = request.headers.get('cf-connecting-ip') || 'unknown';
        const key = await digest(`call-note-ingest:${address}`);
        const { success } = await env.INGEST_LIMITER.limit({ key });
        if (!success) return Response.json({ error: 'rate_limited' }, { status: 429, headers: { ...headers, 'retry-after': '60' } });
        return await ingestion(data, env);
      }
      if (!await verifyAccess(request, env)) return json({ error: 'unauthorized' }, 401);
      if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'method_not_allowed' }, 405);
      if (url.pathname === '/api/stats') return json(await stats(url, env));
      if (url.pathname === '/api/export.csv') return new Response(csv(await stats(url, env)), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="call-note-usage.csv"' } });
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/')) return json({ error: 'not_found' }, 404);
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
      response.headers.set('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      return response;
    } catch (error) { return json({ error: error instanceof HttpError ? error.message : 'internal_error' }, error instanceof HttpError ? error.status : 500); }
  },
  async scheduled(_event, env) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM usage_events WHERE day < date('now', '-89 days')"),
      env.DB.prepare('DELETE FROM deletion_tombstones WHERE expires_at<=?').bind(new Date().toISOString())
    ]);
  }
};
