# macOS releases

Call Note is currently Apple Silicon only, macOS 14.2+. The app uses electron-updater with public GitHub Releases, without GitHub tokens or login. The release repository must be public before distribution. Signing credentials and user OAuth tokens are never embedded in the build. A public installed-app Google OAuth client may be bundled for Calendar sign-in.

## Prepare and verify

1. Update `desktop/package.json` and its lockfile version.
2. Install the pinned Python environment with `./setup.sh`, generate samples with `./make_sample.sh`, download speaker models with `.venv/bin/python scripts/download_speaker_models.py`, and load Phonon-2 once to populate `.cache/fermion`.
3. Run `.venv/bin/python -m pytest -q` and `node --test desktop/*.test.cjs`.
   For Calendar sign-in, provide the release owner's Desktop OAuth client in the ignored `desktop/google-oauth.json` file. See [Google Calendar setup](development.md#google-calendar).
4. Run `npm ci --prefix desktop`, then `npm run package:mac --prefix desktop`.

The build bundles portable CPython 3.13.16, tested site-packages, local model weights, service/UI code, sample audio, and license notices. It audits native linkage for Homebrew dependencies. Build on Apple Silicon.

## Sign and notarize

A **Developer ID Application** certificate with its private key must exist in your login Keychain. Apple Development and Apple Distribution certificates are not substitutes. Store notarization credentials locally using `xcrun notarytool store-credentials call-note-notary`; enter the Apple ID, team ID, and an app-specific password interactively. Never commit passwords, certificates with private keys, or exported keys.

```bash
.venv/bin/python scripts/release_mac.py \
  --app "desktop/dist/Call Note-darwin-arm64/Call Note.app" \
  --identity "Developer ID Application: YOUR NAME (TEAMID)" \
  --notary-profile call-note-notary
```

This signs native dependencies from the inside out with hardened runtime, verifies signatures, submits and staples the app, builds a drag-to-Applications DMG, then signs, notarizes and staples the DMG. It writes SHA-256 checksums, a ZIP of the stapled app, and `latest-mac.yml` (ZIP size and SHA-512) in `release/`. The ZIP is required for automatic updates. Omitting signing arguments produces an ad-hoc signed `preview` DMG, which is not notarized and is not equivalent to the distribution build.

Run the bundled-runtime check using the packaged Python:

```bash
env -u PYTHONPATH -u PYTHONHOME PATH=/usr/bin:/bin:/usr/sbin:/sbin PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1 \
  "desktop/dist/Call Note-darwin-arm64/Call Note.app/Contents/Resources/python/bin/python3.13" -B \
  scripts/bundle_smoke.py \
  "desktop/dist/Call Note-darwin-arm64/Call Note.app/Contents/Resources/service"
```

Install the app from the DMG and verify startup, model readiness, the playable sample, stored calls, and Check for Updates. Refresh MCP registration from the installed app so it points into `/Applications/Call Note.app`, then restart clients. macOS may ask again for capture permissions after a signing identity changes.

## Publish

Commit source and version changes, push `main`, tag the exact commit `vVERSION`, and create a GitHub release with the DMG, the signed/stapled app ZIP, their `.sha256` assets, and `latest-mac.yml`. Upload all assets to a draft and verify them before publishing; never publish a manifest pointing to missing files. State signing/notarization status and supported hardware in the release notes. Verify the uploaded SHA-256 against the local file. Do not publish build caches, user databases, OAuth files, or signing credentials.

Install the first Developer ID signed app manually from its DMG. Older ad-hoc previews cannot bootstrap the new updater. The app checks after 30 seconds and every four hours. Downloads are verified by SHA-512 and Squirrel.Mac signature checks; the app installs on quit or explicit restart, which is blocked during a call. Test an actual version-to-version upgrade between two signed builds before claiming end-to-end auto-update validation. A download or authorization failure must retain the current app and allow retry. Keep `local.calldesk.preview` and `~/Library/Application Support/CallDesk` stable to preserve app identity and saved data. Database changes must remain compatible or include a tested migration and backup before releasing.

GitHub Latest must point to the newest downloadable build. For a manually installed build awaiting Apple review, publish the verified DMG with an explicit pending-notarization note and mark it Latest; withhold `latest-mac.yml` and automatic-update artifacts until notarization and updater validation are complete.
