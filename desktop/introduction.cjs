const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

function validVersion(value) {
  return typeof value === 'string' && /^[0-9A-Za-z][0-9A-Za-z.+-]{0,99}$/.test(value);
}

class Introduction {
  constructor({directory, version, filesystem=fs}) {
    if (!validVersion(version)) throw Error('Invalid app version');
    this.version = version;
    this.fs = filesystem;
    this.file = path.join(directory, 'introduction.json');
    let saved;
    try { saved = JSON.parse(this.fs.readFileSync(this.file, 'utf8')); } catch {}
    if (saved && !Array.isArray(saved) && saved.schema === 1 && typeof saved.tourPending === 'boolean' &&
        (saved.lastSeenVersion === null || validVersion(saved.lastSeenVersion))) {
      this.state = {schema:1, tourPending:saved.tourPending, lastSeenVersion:saved.lastSeenVersion};
    } else {
      this.state = {schema:1, tourPending:!this.fs.existsSync(path.join(directory, 'calls.sqlite3')), lastSeenVersion:null};
      try { this.persist(this.state); } catch {}
    }
  }

  status() {
    return {kind:this.state.tourPending ? 'tour' : this.state.lastSeenVersion === this.version ? null : 'news', version:this.version};
  }

  dismiss(kind) {
    if (!['tour', 'news'].includes(kind)) throw Error('Invalid introduction kind');
    const next = {...this.state, lastSeenVersion:this.version};
    if (kind === 'tour') next.tourPending = false;
    this.persist(next);
    this.state = next;
    return this.status();
  }

  persist(state) {
    this.fs.mkdirSync(path.dirname(this.file), {recursive:true, mode:0o700});
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      this.fs.writeFileSync(temporary, JSON.stringify(state), {flag:'wx', mode:0o600});
      this.fs.renameSync(temporary, this.file);
    } finally {
      try { this.fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

module.exports = {Introduction};
