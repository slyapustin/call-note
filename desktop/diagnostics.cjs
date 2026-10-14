const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 100 * 1024;
const SERVICE_BYTES = 64 * 1024;
const SCOPES = new Set(['renderer', 'updater', 'service', 'clipboard']);
const NAMES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'NotAllowedError', 'NotFoundError', 'NotReadableError', 'AbortError', 'SecurityError', 'NetworkError', 'TimeoutError', 'PermissionError', 'ConnectionError', 'RuntimeError', 'ValueError', 'ModuleNotFoundError', 'ImportError', 'OSError']);
const CODES = new Set(['CAPTURE_SOURCE', 'CAPTURE_OPEN', 'CAPTURE_TRACK', 'RENDERER_GONE', 'EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_NETWORK', 'ERR_INTERNET_DISCONNECTED', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS', 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND', 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND', 'ERR_UPDATER_INVALID_RELEASE_FEED', 'ERR_UPDATER_INVALID_SIGNATURE', 'ERR_UPDATER_SIGNATURE_NOT_FOUND', 'ERR_UPDATER_ZIP_FILE_NOT_FOUND', 'ERR_UPDATER_CHECKSUM_MISMATCH']);
const CATEGORIES = new Set(['clipboard-denied', 'permission-denied', 'network', 'timeout', 'missing-file', 'disk-full', 'update-signature', 'update-feed', 'service-exit', 'error']);
const PHASES = new Set(['idle', 'checking', 'current', 'downloading', 'verifying', 'ready', 'unavailable', 'error']);

function field(value, key) {
  try { return typeof value?.[key] === 'string' ? value[key].slice(0, 4096) : ''; } catch { return ''; }
}

function category(scope, error) {
  const message = typeof error === 'string' ? error.slice(0, 4096) : field(error, 'message');
  const text = `${field(error, 'name')} ${field(error, 'code')} ${message}`;
  if ((scope === 'clipboard' || /clipboard|writeText/i.test(text)) && /denied|notallowed|permission/i.test(text)) return 'clipboard-denied';
  if (/signature|checksum/i.test(text) && scope === 'updater') return 'update-signature';
  if (/ERR_UPDATER_NO_PUBLISHED_VERSIONS|latest.*(yml|version)|channel.*file|release.*feed|404/i.test(text) && scope === 'updater') return 'update-feed';
  if (/EACCES|EPERM|NotAllowedError|PermissionError|permission denied|access denied/i.test(text)) return 'permission-denied';
  if (/ENOSPC|no space left/i.test(text)) return 'disk-full';
  if (/ENOENT|no such file|ModuleNotFoundError|ImportError/i.test(text)) return 'missing-file';
  if (/ETIMEDOUT|TimeoutError|timed? out|timeout/i.test(text)) return 'timeout';
  if (/ECONN|ENOTFOUND|EAI_AGAIN|ERR_NETWORK|ERR_INTERNET_DISCONNECTED|NetworkError|ConnectionError|failed to fetch|network/i.test(text)) return 'network';
  if (scope === 'service' && /exit|terminated|stopped/i.test(text)) return 'service-exit';
  return 'error';
}

function sanitize(error, scope, timestamp = new Date().toISOString()) {
  const event = {timestamp, scope:SCOPES.has(scope) ? scope : 'app', category:category(scope, error)};
  const name = field(error, 'name'), code = field(error, 'code');
  if (NAMES.has(name)) event.name = name;
  if (CODES.has(code)) event.code = code;
  return event;
}

function numericVersion(value) {
  return typeof value === 'string' && /^\d{1,5}(?:\.\d{1,5}){0,3}$/.test(value) ? value : 'unknown';
}

function readTail(filesystem, file, limit) {
  let fd;
  try {
    fd = filesystem.openSync(file, 'r');
    const size = filesystem.fstatSync(fd).size;
    const buffer = Buffer.alloc(Math.min(size, limit));
    const count = filesystem.readSync(fd, buffer, 0, buffer.length, Math.max(0, size - limit));
    let text = buffer.subarray(0, count).toString('utf8');
    if (size > limit) text = text.slice(text.indexOf('\n') + 1);
    return {text, truncated:size > limit, available:true};
  } catch { return {text:'', truncated:false, available:false}; }
  finally { if (fd !== undefined) { try { filesystem.closeSync(fd); } catch {} } }
}

class Diagnostics {
  constructor({directory, version, versions = {}, platform, arch, osRelease, filesystem = fs}) {
    this.fs = filesystem;
    this.file = path.join(directory, 'diagnostics.jsonl');
    this.serviceFile = path.join(directory, 'service.log');
    this.metadata = {
      version:numericVersion(version),
      electron:numericVersion(versions.electron),
      chromium:numericVersion(versions.chrome),
      node:numericVersion(versions.node),
      platform:['darwin', 'win32', 'linux'].includes(platform) ? platform : 'unknown',
      arch:['arm64', 'x64', 'ia32'].includes(arch) ? arch : 'unknown',
      osRelease:numericVersion(osRelease),
    };
    this.events = [];
    for (const line of readTail(this.fs, this.file, MAX_BYTES).text.split('\n')) {
      try {
        const value = JSON.parse(line);
        if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.timestamp)) continue;
        const event = sanitize(value, value.scope, value.timestamp);
        event.category = CATEGORIES.has(value.category) ? value.category : 'error';
        this.events.push(event);
      } catch {}
    }
    this.events = this.events.slice(-100);
  }

  record(scope, error) {
    const event = sanitize(error, scope);
    this.events.push(event);
    this.events = this.events.slice(-100);
    try {
      this.fs.mkdirSync(path.dirname(this.file), {recursive:true, mode:0o700});
      const temporary = `${this.file}.tmp`;
      this.fs.writeFileSync(temporary, this.events.map(item => JSON.stringify(item)).join('\n') + '\n', {mode:0o600});
      this.fs.chmodSync(temporary, 0o600);
      this.fs.renameSync(temporary, this.file);
    } catch {
      try { this.fs.unlinkSync(`${this.file}.tmp`); } catch {}
    }
    return event;
  }

  exportReport({updatePhase, recording} = {}) {
    const tail = readTail(this.fs, this.serviceFile, SERVICE_BYTES);
    const patterns = {
      'HTTP server errors':/HTTP\/\d(?:\.\d)?["']?\s+5\d\d\b/g,
      'HTTP authorization failures':/HTTP\/\d(?:\.\d)?["']?\s+40[13]\b/g,
      'Python tracebacks':/Traceback \(most recent call last\):/g,
      'Permission errors':/\b(?:PermissionError|EACCES|EPERM)\b/g,
      'Network errors':/\b(?:ConnectionError|ConnectionRefusedError|ConnectionResetError|ECONNREFUSED|ECONNRESET)\b/g,
      'Timeout errors':/\b(?:TimeoutError|ETIMEDOUT)\b/g,
      'Missing dependencies':/\b(?:ModuleNotFoundError|ImportError)\b/g,
      'Runtime errors':/\bRuntimeError\b/g,
    };
    return [
      'Call Note diagnostics',
      `Generated: ${new Date().toISOString()}`,
      ...Object.entries(this.metadata).map(([key, value]) => `${key}: ${value}`),
      `Update phase: ${PHASES.has(updatePhase) ? updatePhase : 'unknown'}`,
      `Recording: ${typeof recording === 'boolean' ? recording : 'unknown'}`,
      '',
      'Privacy: This report omits transcripts, audio, calendar events, credentials, paths, raw log lines, error messages and stack traces.',
      'Only fixed error categories and names are included. Counts describe the recent log excerpt, not the entire session.',
      '',
      `Service log: ${tail.available ? `summarized (last ${SERVICE_BYTES} bytes maximum; ${tail.truncated ? 'truncated' : 'complete file'})` : 'unavailable'}`,
      ...Object.entries(patterns).map(([label, pattern]) => `${label}: ${(tail.text.match(pattern) || []).length}`),
      '',
      'Recent sanitized events (maximum 100):',
      ...(this.events.length ? this.events.map(item => JSON.stringify(item)) : ['No diagnostic events recorded.']),
      '',
    ].join('\n');
  }
}

module.exports = {Diagnostics};
