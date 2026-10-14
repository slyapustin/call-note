const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const SOURCES = ['system', 'light', 'dark'];

class ThemePreference {
  constructor({directory, nativeTheme, filesystem=fs}) {
    this.file = path.join(directory, 'theme.json');
    this.nativeTheme = nativeTheme;
    this.fs = filesystem;
    this.source = 'system';
    try {
      const saved = JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
      if (saved?.schema === 1 && SOURCES.includes(saved.source)) this.source = saved.source;
    } catch {}
    this.nativeTheme.themeSource = this.source;
  }

  set(source) {
    if (!SOURCES.includes(source)) throw Error('Invalid appearance');
    this.nativeTheme.themeSource = source;
    this.source = source;
    try {
      this.persist();
      return {source, persisted:true};
    } catch {
      return {source, persisted:false};
    }
  }

  persist() {
    this.fs.mkdirSync(path.dirname(this.file), {recursive:true, mode:0o700});
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      this.fs.writeFileSync(temporary, JSON.stringify({schema:1, source:this.source}), {flag:'wx', mode:0o600});
      this.fs.renameSync(temporary, this.file);
    } finally {
      try { this.fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

module.exports = {ThemePreference};
