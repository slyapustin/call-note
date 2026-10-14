class Updates {
  constructor({updater, nativeUpdater, enabled, notify, isRecording, platform='darwin', disabledReason='Automatic updates are available in the installed app.', onError=()=>{}}) {
    Object.assign(this, {updater, enabled, notify, isRecording, onError, disabledReason});
    this.state = {phase:enabled?'idle':'unavailable', message:enabled?'Call Note checks for updates automatically.':disabledReason};
    updater.logger = null;
    updater.autoDownload = enabled;
    updater.autoInstallOnAppQuit = enabled;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.disableDifferentialDownload = true;
    updater.on('checking-for-update', () => this.set({phase:'checking', message:'Checking for updates…'}));
    updater.on('update-not-available', () => this.set({phase:'current', message:'Call Note is up to date.'}));
    updater.on('update-available', info => this.set({phase:'downloading', version:info.version, message:`Downloading Call Note ${info.version}…`}));
    updater.on('download-progress', info => this.set({message:`Downloading update… ${Math.floor(info.percent)}%`}));
    const ready=version=>this.set({phase:'ready',version,message:`Call Note ${version} is ready. Restart to install, or it will install when you quit.`});
    updater.on('update-downloaded', info => {
      if(platform==='win32')ready(info.version);
      else this.set({phase:'verifying', version:info.version, message:'Verifying the downloaded update…'});
    });
    if(platform==='darwin')nativeUpdater.on('update-downloaded', () => ready(this.state.version));
    updater.on('error', error => this.failure(error));
    updater.setFeedURL({provider:'github', owner:'slyapustin', repo:'call-note'});
  }
  set(value) { Object.assign(this.state, value); this.notify(this.status()); }
  status() { return {...this.state, enabled:this.enabled}; }
  failure(error) {
    this.onError(error);
    if (['ERR_UPDATER_CHANNEL_FILE_NOT_FOUND','ERR_UPDATER_NO_PUBLISHED_VERSIONS'].includes(error?.code)) {
      this.set({phase:'unavailable', message:'Automatic-update packages are not available yet. Use View downloads to get the latest test build. Your installed app has not changed.'});
    } else {
      this.set({phase:'error', message:'Could not check or download updates. Try again later, or use View downloads. Your installed app has not changed.'});
    }
  }
  async check() {
    if (!this.enabled) {this.set({phase:'unavailable',message:this.disabledReason}); return this.status();}
    if (this.busy || ['verifying','ready'].includes(this.state.phase)) return this.status();
    this.busy = true;
    try {
      const result = await this.updater.checkForUpdates();
      if (result?.downloadPromise) await result.downloadPromise;
    } catch (error) {this.failure(error);}
    finally {this.busy = false;}
    return this.status();
  }
  install() {
    if (!this.enabled) throw Error(this.disabledReason);
    if (this.isRecording()) throw Error('Stop and save your call before restarting to update.');
    if (this.state.phase !== 'ready') throw Error('No downloaded update is ready yet.');
    this.updater.quitAndInstall();
  }
  start() {
    if (!this.enabled) return;
    this.startTimer = setTimeout(() => this.check(), 30000);
    this.interval = setInterval(() => this.check(), 4*60*60*1000);
    this.startTimer.unref?.(); this.interval.unref?.();
  }
}
async function updateAvailability({platform,packaged,preview,readConfig}) {
  const disabledReason='Automatic updates are unavailable in this Windows preview. Use View downloads to get a newer installer.';
  if(!packaged)return {enabled:false};
  if(platform==='darwin')return {enabled:true};
  if(platform!=='win32')return {enabled:false};
  if(preview)return {enabled:false,disabledReason};
  try {
    const config=await readConfig();
    const publishers=Array.isArray(config?.publisherName)?config.publisherName:[config?.publisherName];
    if(publishers.length&&publishers.every(value=>typeof value==='string'&&value.trim()))return {enabled:true};
  } catch {}
  return {enabled:false,disabledReason};
}
module.exports = {Updates,updateAvailability};
