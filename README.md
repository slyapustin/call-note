# Call Note

Local call transcription for macOS, powered by Phonon-2, with a searchable call library and MCP tools for Codex and Claude.

**Developer preview:** Electron + Python, Apple Silicon macOS. Windows and outgoing virtual-microphone noise cancellation are planned. English speech only.

## Set up on a Mac

Requires Apple Silicon, macOS 14.2+ for system audio, Python 3.11, Node.js and FFmpeg. The model downloads on first launch; subsequent transcription is local.

```bash
git clone https://github.com/slyapustin/call-note.git
cd call-note
brew install python@3.11 ffmpeg node
./setup.sh
./make_sample.sh
cd desktop
npm ci
npm run package:mac
open "dist/Call Note-darwin-arm64/Call Note.app"
```

`setup.sh` uses `python3.11` by default; override `PYTHON_BIN` if needed. The pinned environment was tested with Python 3.11.17.

The original browser speech POC, sample comparisons and benchmarks are documented in [docs/phonon-poc.md](docs/phonon-poc.md).

## Desktop app

A macOS Electron app now builds on the original browser POC. Open `desktop/dist/Call Note-darwin-arm64/Call Note.app`. The app starts its own authenticated loopback Python service on an available port, loads Phonon-2, and manages that service when the window closes.

This is a **developer preview tied to this checkout**, not a standalone installer. Keep the project, `.venv`, model cache and Homebrew FFmpeg in place. It currently targets Apple Silicon macOS; system-audio capture requires macOS 14.2 or later. Windows packaging and inference backend selection remain future work.

```bash
cd desktop
npm ci
npm run package:mac
```

Features:

- Separate live microphone and system-audio streams, labeled You and Others. Others includes all playing apps, not individual speaker diarization. Headphones reduce duplicate capture.
- Microphone noise suppression and echo cancellation through Chromium's audio processing. This only cleans the transcription input. It does **not** provide a virtual microphone or change what other callers hear.
- SQLite call library, search, notes, Markdown export, and versioned assistant analyses. Finalized text is saved during recording; interrupted sessions remain readable.
- Raw call audio stays in memory and is not retained. The synthetic sample remains playable from its existing fixture.
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

The installer adds `call-note` to `~/.codex/config.toml` and Claude Desktop's config, preserving existing settings and writing timestamped backups. Restart those clients to load it. For Claude Code, run:

```bash
claude mcp add --transport stdio call-note -- /absolute/path/to/phonon-poc/.venv/bin/python /absolute/path/to/phonon-poc/call_mcp.py
```

Example: “Use Call Note to find my latest call, summarize decisions and action items with segment citations, and save the analysis.”

Transcription runs locally. A connected cloud assistant receives transcript text when it invokes a read tool; its normal data policies apply. The MCP server can access the entire local call library, not only the call currently displayed in the app.

Data: `~/Library/Application Support/CallDesk/calls.sqlite3`. Service logs: the same folder's `service.log`. The database is private to the current OS user but is not separately encrypted. Calendar authorization is stored in `google-calendar.enc`. No transcript text is intentionally written to service logs.

### Model size and licensing

Fermion advertises a 164 MB download. The installed `model.fermion` in this checkout is 177,438,361 bytes (177.4 MB / 169.2 MiB). MLX expands weights at load; the download size is not a RAM estimate. The full Electron/Python installation is larger than the model.

Model weights are CC BY 4.0, allowing commercial use with attribution and license/change notices. The inference package is Apache 2.0. Attribution and runtime notices are in `desktop/licenses`; preserve them in distributions. These licenses do not require opening Call Note's own source. Dependency notices for a future self-contained installer must also be bundled.

Sources: [Phonon-2 model card](https://huggingface.co/FermionResearch/Phonon-2), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0), [Google installed-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Electron desktop capture](https://www.electronjs.org/docs/latest/api/desktop-capturer), [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

### Verification

```bash
.venv/bin/python -m pytest -q
node --test desktop/calendar.test.cjs
```

Tests cover persistence, search escaping, transcript/analysis separation, recovery, authenticated APIs, dual-source streaming and final flush, invalid frames, real MCP stdio discovery/read/write, config preservation, and calendar normalization/matching. The packaged app has transcribed and saved the 108-second synthetic sample using the real MLX model and played the sample audio. A 42-second live capture test verified separate microphone and system-audio transcripts and Stop & Save. Google sign-in, actual meeting-app sessions, and Windows still require live validation. The data folder and bundle ID retain their original CallDesk identifiers so preview upgrades preserve stored calls and permissions.
