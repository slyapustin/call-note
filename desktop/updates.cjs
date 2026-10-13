class Updates {
  constructor({updater, nativeUpdater, enabled, notify, isRecording}) {
    Object.assign(this, {updater, enabled, notify, isRecording});
    this.state = {phase:'idle', message:'Call Note checks for updates automatically.'};
    updater.logger = null;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.disableDifferentialDownload = true;
    updater.on('checking-for-update', () => this.set({phase:'checking', message:'Checking for updates…'}));
    updater.on('update-not-available', () => this.set({phase:'current', message:'Call Note is up to date.'}));
    updater.on('update-available', info => this.set({phase:'downloading', version:info.version, message:`Downloading Call Note ${info.version}…`}));
    updater.on('download-progress', info => this.set({message:`Downloading update… ${Math.floor(info.percent)}%`}));
    updater.on('update-downloaded', info => this.set({phase:'verifying', version:info.version, message:'Verifying the downloaded update…'}));
    nativeUpdater.on('update-downloaded', () => this.set({phase:'ready', message:`Call Note ${this.state.version} is ready. Restart to install, or it will install when you quit.`}));
    updater.on('error', () => this.failure());
    updater.setFeedURL({provider:'github', owner:'slyapustin', repo:'call-note'});
  }
  set(value) { Object.assign(this.state, value); this.notify(this.status()); }
  status() { return {...this.state, enabled:this.enabled}; }
  failure() { this.set({phase:'error', message:'Update failed. Check your internet connection and try again later. The installed app has not been changed.'}); }
  async check() {
    if (!this.enabled) {this.set({message:'Automatic updates are available in the installed Mac app.'}); return this.status();}
    if (this.busy || ['verifying','ready'].includes(this.state.phase)) return this.status();
    this.busy = true;
    try {
      const result = await this.updater.checkForUpdates();
      if (result?.downloadPromise) await result.downloadPromise;
    } catch {this.failure();}
    finally {this.busy = false;}
    return this.status();
  }
  install() {
    if (this.isRecording()) throw Error('Stop and save your call before restarting to update.');
    if (this.state.phase !== 'ready') throw Error('No downloaded update is ready yet.');
    this.updater.quitAndInstall();
  }
  start() {
    this.startTimer = setTimeout(() => this.check(), 30000);
    this.interval = setInterval(() => this.check(), 4*60*60*1000);
    this.startTimer.unref?.(); this.interval.unref?.();
  }
}
module.exports = {Updates};
