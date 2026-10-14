# Call Note

Local call transcription for macOS, powered by Phonon-2, with a searchable call library and MCP tools for Codex and Claude.

**Developer preview:** Electron + Python, Apple Silicon macOS. Windows and outgoing virtual-microphone noise cancellation are planned. English speech only.

## Download and install

Download the newest test DMG from [Releases](https://github.com/slyapustin/call-note/releases). GitHub's Latest release points to the newest downloadable build; check its notes for notarization status.

Open the DMG, drag **Call Note** into **Applications**, and launch it there. Requires an Apple Silicon Mac and macOS 14.2 or later. Python, dependencies, the speech model, and playable one-voice and three-voice samples are included. No Homebrew or model download is needed for transcription.

A release named `preview` or `test` may not have completed Apple notarization; its release notes state the signing status. Signed and notarized builds are the intended stable distribution format.

## Menu bar

Call Note stays in the macOS menu bar when you close its window. The menu shows engine readiness, active audio sources, and recording time, with actions to start a call, stop and save, or reopen the window. Choose **Quit Call Note** to fully exit; quitting during a call asks for confirmation.

With Google Calendar connected, the menu lists up to five active or upcoming meetings and offers **Join call** when an event includes an HTTPS video link. A countdown appears in the menu bar during the 15 minutes before the next meeting; an active transcription keeps its recording timer. **Meeting reminder** lets you choose **1 minute before** (default), **30 seconds before**, or **Off**. A macOS notification offers the same join action. Joining opens the meeting link; recording still starts manually.

Calendar checks run once a minute in the main process, including while the window is closed, and refresh after wake. Notifications need Call Note running and macOS notifications enabled; Focus settings can suppress them. Reminders are deduplicated across app restarts. Changes or cancellations are applied on the next successful refresh, and failed refreshes clear stale reminders. Only the primary Google calendar is read.

## Updates

Call Note checks automatically after launch and every four hours, downloads newer stable releases in the background, and installs on quit. Test releases require manual installation. Until a stable release includes the complete update package, checks report that automatic-update packages are unavailable and offer **View downloads**. No GitHub login is needed with public releases. The sidebar shows only the installed version. **Call Note → Check for Updates** remains available for an optional manual check or **Restart & install**.

Restart is blocked while a call is recording or being saved. Calls and Calendar settings remain in your user Library. The existing 0.2.0 preview requires manual installation; install the first signed release from its DMG once to enable future automatic updates.

## Build from source

```bash
git clone https://github.com/slyapustin/call-note.git
cd call-note
brew install python@3.13 ffmpeg node uv
./setup.sh
./make_sample.sh
.venv/bin/python scripts/download_speaker_models.py
npm ci --prefix desktop
npm run package:mac --prefix desktop
```

`setup.sh` uses `python3.13` by default; override `PYTHON_BIN` if needed. The tested environment uses Python 3.13.16. If `.venv` was created with Python 3.11, rename it (for example, `mv .venv .venv.python311`) and rerun setup; the existing model cache is retained. Packaging requires the model cache populated by running the POC once, and downloads a portable Python runtime with `uv`. The packaged desktop app does not use FFmpeg; the browser upload POC does.

See [release build instructions](releases.md) for signing, notarization, and publishing, and [the original POC](phonon-poc.md) for browser benchmarks.

## Desktop app

The app starts its own authenticated loopback service on an available port, loads the bundled Phonon-2 model, and stops that service when the app closes.

Features:

- Separate live microphone and system-audio streams. Microphone is labeled You; system-audio voices receive per-call Speaker numbers. All playing apps are captured. Headphones reduce duplicate capture.
- Microphone noise suppression and echo cancellation through Chromium's audio processing. This only cleans the transcription input. It does **not** provide a virtual microphone or change what other callers hear.
- SQLite call library, search, notes, Markdown export, and versioned assistant analyses. Finalized text is saved during recording; interrupted sessions remain readable.
- Raw call audio stays in memory and is not retained. Synthetic samples remain playable from their bundled fixtures. The sample selector offers the original solo briefing and a three-person discussion using Samantha, Alex, and Daniel. Regenerate the meeting fixture with `.venv/bin/python scripts/build_meeting_sample.py`; voice identities in the script are fixture metadata, not detected speaker labels.
- Calls up to four hours; rolling decoding uses bounded phrases. Segment timestamps are approximate phrase boundaries, not word alignment.

The first capture requests macOS microphone and Screen & System Audio Recording permission. If denied, enable Call Note in System Settings → Privacy & Security and reopen it. If the system source has never produced a signal after 15 seconds, the app shows an input-level warning. Calendar matching is automatic. Recording currently starts manually; automatic recording triggers remain pending product clarification.

### Google Calendar

The preview includes a Google desktop OAuth flow with PKCE, a random loopback callback, and read-only `calendar.events.readonly` scope. Tokens are encrypted using Electron safeStorage (macOS Keychain-backed) and never passed to the renderer or Python service.

One-time developer setup:

1. In a Google Cloud project, enable Google Calendar API.
2. Configure the OAuth consent screen, adding your account as a test user if the app is in testing mode.
3. Create an OAuth client of type **Desktop app** and download its JSON.
4. Save the downloaded JSON as `desktop/google-oauth.json` before packaging. It is ignored by Git and copied into the app's resources.
5. In Call Note, choose **Connect Google Calendar** and complete Google sign-in. Users do not need to create a project or select a JSON file.

No Google OAuth client is committed to this repository. Builds without a client disable Calendar sign-in, while existing encrypted connections remain usable. An installed-app OAuth client is distributed with the binary and is not a confidential server credential; user access and refresh tokens remain in encrypted local storage. The connection in ChatGPT/Codex does not authorize the standalone app. Testing-mode clients require each user's account on the test-user list; public access requires completing Google's applicable publishing and verification steps.

Once connected, it refreshes the primary calendar, expands recurring events and automatically matches an active meeting or one starting within 15 minutes. Canceled, self-declined and all-day events are excluded. Titles, scheduled times, attendees and video links are attached to the call, available to MCP, and can be used for analysis. It does not write to Google Calendar or upload audio/transcripts there. Matching is a time-based heuristic; overlapping events may need correction. Additional calendars and actual call-join detection are not implemented yet.

### MCP for Codex and Claude

`service/call_mcp.py` runs independently over stdio, without loading the model or accessing a microphone. Tools: `list_calls`, `get_call`, `save_call_analysis`. Prompt: `analyze_call`. Assistant analyses are versioned and do not replace transcript text.

```bash
.venv/bin/python service/connect_mcp.py --dry-run
.venv/bin/python service/connect_mcp.py
```

In the installed app, open **Connect your assistant → Connect Codex & Claude**. This adds `call-note` to `~/.codex/config.toml` and Claude Desktop's config, preserving existing settings and writing timestamped backups. Restart those clients to load it. For Claude Code, run:

```bash
claude mcp add --transport stdio call-note -- /absolute/path/to/phonon-poc/.venv/bin/python -B /absolute/path/to/phonon-poc/service/call_mcp.py
```

Example: “Use Call Note to find my latest call, summarize decisions and action items with segment citations, and save the analysis.”

Transcription runs locally. A connected cloud assistant receives transcript text when it invokes a read tool; its normal data policies apply. The MCP server can access the entire local call library, not only the call currently displayed in the app.

Data: `~/Library/Application Support/CallDesk/calls.sqlite3`. Service logs: the same folder's `service.log`. The database is private to the current OS user but is not separately encrypted. Calendar authorization is stored in `google-calendar.enc`. No transcript text is intentionally written to service logs.

### Model size and licensing

Fermion advertises a 164 MB download. The installed `model.fermion` in this checkout is 177,438,361 bytes (177.4 MB / 169.2 MiB). MLX expands weights at load; the download size is not a RAM estimate. The full Electron/Python installation is larger than the model.

Model weights are CC BY 4.0, allowing commercial use with attribution and license/change notices. The inference package is Apache 2.0. Attribution and runtime notices are in `desktop/licenses`; preserve them in distributions. These licenses do not require opening Call Note's own source. The bundled Python runtime and installed dependency distributions retain their license files.

Sources: [Phonon-2 model card](https://huggingface.co/FermionResearch/Phonon-2), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0), [Google installed-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Electron desktop capture](https://www.electronjs.org/docs/latest/api/desktop-capturer), [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

### Verification

```bash
.venv/bin/python -m pytest -q
node --test desktop/*.test.cjs
.venv/bin/python scripts/verify_speakers.py
.venv/bin/python scripts/verify_speakers.py --stream
```

The speaker smoke check runs the real models on both bundled WAV files; `--stream` also loads Phonon-2 and sends the discussion through the rolling decoder in 50 ms frames. It checks the three returning speaker identities and their turn order, checks that the solo sample has one speaker, and fails on missing labels or streaming warnings. It reports processing time without enforcing a device-specific speed target. Sample scripts are not used to generate detected labels.

For 0.2.4, 34 Python tests and 19 desktop tests passed. Real-model checks found three speakers across ten discussion turns and one speaker in the solo sample. The streaming check processed 112.65 seconds of sample audio in 95.4 seconds on the development Mac, excluding model loading. This was an audio-pipeline test, not a microphone capture or real meeting accuracy evaluation.

Tests cover persistence, search escaping, transcript/analysis separation, recovery, authenticated APIs, dual-source streaming and final flush, invalid frames, real MCP stdio discovery/read/write, config preservation, and calendar normalization/matching. The standalone runtime passed an offline transcription and MCP smoke check without Homebrew on its launch path. The packaged app has transcribed and saved the 108-second synthetic sample using the real MLX model and played the sample audio. A 42-second live capture test verified separate microphone and system-audio transcripts and Stop & Save. Google Calendar sign-in was verified in the installed app. Actual meeting-app sessions and Windows still require live validation. The data folder and bundle ID retain their original CallDesk identifiers so preview upgrades preserve stored calls and permissions.

## Source layout

- `desktop/`: Electron shell, Calendar, updates, menu bar, and UI.
- `service/`: Python transcription, speaker detection, storage, and MCP service.
- `tests/`: Python unit and integration tests; run `.venv/bin/python -m pytest`.
- `scripts/`: model downloads, sample generation, benchmarks, packaging, and signing.
- `samples/`: sample scripts and locally generated audio.
- `docs/`: user/developer documentation and screenshots.

Run desktop checks with `node --test desktop/*.test.cjs`. Model binaries, generated audio, environments, and release artifacts are ignored by Git.

## Speaker detection

Speaker detection uses sherpa-onnx 1.13.8, pyannote segmentation-3.0, and 3D-Speaker ERes2Net embeddings on CPU. The two model files total about 46 MB and are bundled for offline use. `scripts/download_speaker_models.py` verifies their SHA-256 hashes for source builds. License notices and model provenance are under `desktop/licenses/`.

Samples are segmented before Phonon transcribes each turn. Live system audio is segmented when the rolling decoder finalizes a phrase (silence or the 30-second limit); draft words appear first, then speaker-labeled turns. A per-call voice matcher keeps numbers consistent across phrases. Audio buffers are bounded by the rolling segment; voice embeddings stay in memory and are discarded with the call. The microphone remains You. No speaker names or genders are inferred. Speaker numbers start again for each call.

Labels are estimates, especially with short remarks, similar voices, noise, or overlapping speech. Unknown voices retain the source label. The text is retained if phrase-level speaker detection fails. Saved calls from earlier versions cannot be retroactively diarized because audio was not retained; rerun a bundled sample to create a newly labeled transcript. Speaker fields are included in MCP and Markdown exports.
