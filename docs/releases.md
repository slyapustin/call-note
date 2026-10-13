# macOS releases

Call Note is currently Apple Silicon only, macOS 14.2+. The private repository owns source and release assets. The app opens its GitHub releases page for updates; it never embeds a GitHub token. Repository access is required to download.

## Prepare and verify

1. Update `desktop/package.json` and its lockfile version.
2. Install the pinned Python environment with `./setup.sh`, generate samples with `./make_sample.sh`, and load Phonon-2 once to populate `.cache/fermion`.
3. Run `.venv/bin/python -m pytest -q` and `node --test desktop/calendar.test.cjs`.
4. Run `npm ci --prefix desktop`, then `npm run package:mac --prefix desktop`.

The build bundles portable CPython 3.11.17, tested site-packages, local model weights, service/UI code, sample audio, and license notices. It audits native linkage for Homebrew dependencies. Build on Apple Silicon.

## Sign and notarize

A **Developer ID Application** certificate with its private key must exist in your login Keychain. Apple Development and Apple Distribution certificates are not substitutes. Store notarization credentials locally using `xcrun notarytool store-credentials call-note-notary`; enter the Apple ID, team ID, and an app-specific password interactively. Never commit passwords, certificates with private keys, or exported keys.

```bash
.venv/bin/python scripts/release_mac.py \
  --app "desktop/dist/Call Note-darwin-arm64/Call Note.app" \
  --identity "Developer ID Application: YOUR NAME (TEAMID)" \
  --notary-profile call-note-notary
```

This signs native dependencies from the inside out with hardened runtime, verifies signatures, submits and staples the app, builds a drag-to-Applications DMG, then signs, notarizes and staples the DMG. It writes a SHA-256 file alongside it in `release/`. Omitting signing arguments produces an ad-hoc signed `preview` DMG, which is not notarized and is not equivalent to the distribution build.

Run the bundled-runtime check using the packaged Python:

```bash
env -u PYTHONPATH -u PYTHONHOME PATH=/usr/bin:/bin:/usr/sbin:/sbin PYTHONNOUSERSITE=1 \
  "desktop/dist/Call Note-darwin-arm64/Call Note.app/Contents/Resources/python/bin/python3.11" \
  scripts/bundle_smoke.py \
  "desktop/dist/Call Note-darwin-arm64/Call Note.app/Contents/Resources/service"
```

Install the app from the DMG and verify startup, model readiness, the playable sample, stored calls, and Check for Updates. Refresh MCP registration from the installed app so it points into `/Applications/Call Note.app`, then restart clients. macOS may ask again for capture permissions after a signing identity changes.

## Publish

Commit source and version changes, push `main`, tag the exact commit `vVERSION`, and create a GitHub release with the DMG and `.sha256` asset. State signing/notarization status and supported hardware in the release notes. Verify the uploaded SHA-256 against the local file. Do not publish build caches, user databases, OAuth files, or signing credentials.

For updates, quit the running app and replace it in Applications. Keep `local.calldesk.preview` and `~/Library/Application Support/CallDesk` stable to preserve app identity and saved data. Database changes must remain compatible or include a tested migration and backup before releasing.
