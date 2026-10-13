# Call Note

Local call transcription for macOS, powered by Phonon-2, with a searchable call library and MCP tools for Codex and Claude.

**Developer preview:** Electron + Python, Apple Silicon macOS. Windows and outgoing virtual-microphone noise cancellation are planned. English speech only.

## Download and install

Download the latest DMG from [Releases](https://github.com/slyapustin/call-note/releases/latest).

Open the DMG, drag **Call Note** into **Applications**, and launch it there. Requires an Apple Silicon Mac and macOS 14.2 or later. Python, dependencies, the speech model, and playable one-voice and three-voice samples are included. No Homebrew or model download is needed for transcription.

A release named `preview` has not completed Apple notarization; its release notes state the signing status. Signed and notarized builds are the intended distribution format.

## Menu bar

Call Note stays in the macOS menu bar when you close its window. The menu shows engine readiness, active audio sources, and recording time, with actions to start a call, stop and save, or reopen the window. Choose **Quit Call Note** to fully exit; quitting during a call asks for confirmation.

## Updates

Call Note checks automatically after launch and every four hours, downloads newer releases in the background, and installs on quit. No GitHub login is needed with public releases. The sidebar shows only the installed version. **Call Note → Check for Updates** remains available for an optional manual check or **Restart & install**.

Restart is blocked while a call is recording or being saved. Calls and Calendar settings remain in your user Library. The existing 0.2.0 preview requires manual installation; install the first signed release from its DMG once to enable future automatic updates.

## Build from source

```bash
git clone https://github.com/slyapustin/call-note.git
cd call-note
brew install python@3.13 ffmpeg node uv
./setup.sh
./make_sample.sh
npm ci --prefix desktop
npm run package:mac --prefix desktop
```

`setup.sh` uses `python3.13` by default; override `PYTHON_BIN` if needed. The tested environment uses Python 3.13.16. If `.venv` was created with Python 3.11, rename it (for example, `mv .venv .venv.python311`) and rerun setup; the existing model cache is retained. Packaging requires the model cache populated by running the POC once, and downloads a portable Python runtime with `uv`. The packaged desktop app does not use FFmpeg; the browser upload POC does.

See [release build instructions](releases.md) for signing, notarization, and publishing, and [the original POC](phonon-poc.md) for browser benchmarks.

## Desktop app

The app starts its own authenticated loopback service on an available port, loads the bundled Phonon-2 model, and stops that service when the app closes.

Features:

- Separate live microphone and system-audio streams, labeled You and Others. Others includes all playing apps, not individual speaker diarization. Headphones reduce duplicate capture.
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
4. In Call Note, choose **Connect Google Calendar**, select that JSON and complete Google sign-in.

No Google OAuth client is bundled in this repository. The connection in ChatGPT/Codex does not give the standalone app credentials. Sign-in and live Calendar reads remain unverified until an OAuth client is supplied.

Once connected, it refreshes the primary calendar, expands recurring events and automatically matches an active meeting or one starting within 15 minutes. Canceled, self-declined and all-day events are excluded. Titles, scheduled times, attendees and video links are attached to the call, available to MCP, and can be used for analysis. It does not write to Google Calendar or upload audio/transcripts there. Matching is a time-based heuristic; overlapping events may need correction. Additional calendars and actual call-join detection are not implemented yet.

### MCP for Codex and Claude

`call_mcp.py` runs independently over stdio, without loading the model or accessing a microphone. Tools: `list_calls`, `get_call`, `save_call_analysis`. Prompt: `analyze_call`. Assistant analyses are versioned and do not replace transcript text.

```bash
.venv/bin/python connect_mcp.py --dry-run
.venv/bin/python connect_mcp.py
```

In the installed app, open **Connect your assistant → Connect Codex & Claude**. This adds `call-note` to `~/.codex/config.toml` and Claude Desktop's config, preserving existing settings and writing timestamped backups. Restart those clients to load it. For Claude Code, run:

```bash
claude mcp add --transport stdio call-note -- /absolute/path/to/phonon-poc/.venv/bin/python -B /absolute/path/to/phonon-poc/call_mcp.py
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
```

Tests cover persistence, search escaping, transcript/analysis separation, recovery, authenticated APIs, dual-source streaming and final flush, invalid frames, real MCP stdio discovery/read/write, config preservation, and calendar normalization/matching. The standalone runtime passed an offline transcription and MCP smoke check without Homebrew on its launch path. The packaged app has transcribed and saved the 108-second synthetic sample using the real MLX model and played the sample audio. A 42-second live capture test verified separate microphone and system-audio transcripts and Stop & Save. Google sign-in, actual meeting-app sessions, and Windows still require live validation. The data folder and bundle ID retain their original CallDesk identifiers so preview upgrades preserve stored calls and permissions.
