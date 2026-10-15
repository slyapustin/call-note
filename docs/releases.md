# macOS releases

Call Note is currently Apple Silicon only, macOS 14.2+. The app uses electron-updater with public GitHub Releases, without GitHub tokens or login. The release repository must be public before distribution. Signing credentials and user OAuth tokens are never embedded in the build. A public installed-app Google OAuth client may be bundled for Calendar sign-in.

## Prepare and verify

1. Update `desktop/package.json` and its lockfile version. Refresh the release highlights in `desktop/ui/index.html` and `desktop/ui/introduction.js`, and add the changelog entry. Test first-launch tour, existing-user highlights, dismissal across restart, and Help-menu reopening.
2. Install the pinned Python environment with `./setup.sh`, generate samples with `./make_sample.sh`, download speaker models with `.venv/bin/python scripts/download_speaker_models.py`, and load Phonon-2 once to populate `.cache/fermion`.
3. Run `.venv/bin/python -m pytest -q` and `node --test desktop/*.test.cjs`.
   For Calendar sign-in, provide the release owner's Desktop OAuth client in the ignored `desktop/google-oauth.json` file. See [Google Calendar setup](development.md#google-calendar).
4. Run `npm ci --prefix desktop`, then `npm run package:mac --prefix desktop`.

The build bundles portable CPython 3.13.16, tested site-packages, local model weights, service/UI code, sample audio, and license notices. The Mac MLX runtime excludes PyTorch, its unused support packages, pip, and test tooling; the development environment and Windows CPU runtime retain their dependencies. Python executable aliases stay as internal relative symlinks. It audits native linkage for Homebrew dependencies and runs offline transcription, streaming/hotword, speaker-detection, and MCP checks before packaging succeeds. Build on Apple Silicon. See [bundle size measurements](packaging-size.md).

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

## 0.2.14 validation

The consent feature is enabled; optional analytics remains off until explicit opt-in. Cloudflare Access protects only the dashboard Worker, with the owner email allow policy and signed issuer/audience verification. Live unauthenticated checks return Access redirects for the dashboard, stats and CSV; collector health returns 200, malformed consent returns 400, and collector dashboard routes return 401. Owner sign-in and the empty production dashboard were verified. The authenticated CSV export was downloaded and parsed: 30 UTC-day rows (2026-09-16 through 2026-10-15), six fixed aggregate columns, all zero, and no installation identifiers or call content.

Validation passed: 176 desktop tests, 77 Python tests, 16 Worker/D1 tests and Worker syntax checking. Pre-package, packaged and signed-runtime checks passed offline transcription, speaker detection, streaming/hotwords and MCP. Browser checks used the real Privacy/introduction HTML, styles and modules with an isolated mock bridge: both choices start unchecked, Later cancels, terms-only acceptance leaves analytics off, and release highlights dismiss across a mock restart and reopen through the Help action. This is not an installed-app recording test.

To preserve the installed app and saved calls, do not use a same-account app launch for an isolated updater test: `main.cjs` pins user data to `appData/CallDesk`, and electron-updater uses the home-directory cache independently. Validate an actual 0.2.13 → 0.2.14 replacement/relaunch in a disposable macOS account or VM. Artifact/signature/feed checks alone do not establish that full upgrade.

The signed 0.2.14 app also satisfies the installed app’s designated signing requirement (bundle identifier `local.calldesk.preview`, Developer ID team `4H3K6D457W`). Apple accepted the app notarization submission `f1e47aaa-5c7b-4705-8fbf-6d747cd87b7e`; the app was stapled successfully.

Apple also accepted DMG submission `eca537aa-d5ed-4d1b-89b3-feca6281a70c`. Both app and DMG passed stapler validation and Gatekeeper as Notarized Developer ID; `hdiutil verify` passed. The installer is 577,079,105 bytes, and the updater ZIP is 524,137,194 bytes.

Published `v0.2.14` from `aa100a0` as GitHub Latest. All five uploaded asset SHA-256 values match local files; the public `releases/latest/download/latest-mac.yml` exactly matches the local manifest, and its ZIP SHA-512/size are verified. No install or quit/relaunch was performed on the owner’s installed app.

## 0.2.15 speaker naming

After saving a call, click a speaker label to name it throughout that call or correct only the selected line. Uncertain lines can only be assigned individually. Clearing a name removes that assignment; individual corrections take priority over shared speaker names. Names persist in the local call library and appear in text exports and MCP transcripts, never analytics. This does not recognize people across calls.

The additive database migration backs up older libraries before adding speaker-name storage. Validation: 80 Python tests and 179 desktop tests pass, including migration, persistence, export, API validation and naming-dialog behavior. The 0.2.15 package and Developer ID signed runtime passed offline transcription, speaker detection, streaming/hotwords and MCP checks. Packaged speaker-name persistence and export passed with a disposable database. Native installed-app interaction and replacement/relaunch were not tested.

Release source: `d16fa54`. Signing completed, but Apple notarization could not start: `call-note-notary` was absent from the active login keychain. No 0.2.15 release or updater manifest has been published; restore that profile before submitting the app and DMG, stapling, verifying artifacts and publishing.
