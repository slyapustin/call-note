# Changelog

## 0.2.7 — 2026-10-14

- Added Settings from the sidebar and Call Note → Settings (⌘,): appearance, Google Calendar, meeting reminders, assistant setup, and support.
- Replaced automatic Codex and Claude configuration edits with manual instructions and copyable MCP snippets. The app and setup helper no longer read or modify assistant configuration files.
- Kept existing MCP connections unchanged. Opening Settings preserves call drafts and selected meetings.
- Added diagnostics export, update status, and release notes to Settings → Support.

## 0.2.6 — 2026-10-14

- Fixed Copy analysis prompt failing with browser clipboard permission errors by using the native Mac clipboard.
- Added Help → Export Diagnostics to save a local text report with runtime versions, recent error categories, and service error counts. Transcripts, Calendar details, credentials and raw log text are omitted; nothing is uploaded automatically.
- Added the connected Calendar account email to Google Meet join links when primary-calendar events identify the account, instead of relying on browser account order. Other meeting providers are unchanged. Browser account routing still needs live verification.

## 0.2.5 — 2026-10-14

- Added Light, Dark, and System appearance options in View → Appearance. System follows macOS by default.

- Added a skippable three-step tour for first launch, covering local transcription, Calendar reminders, and the call library.
- Added a brief What’s New screen after updates, shown once per version.
- Added Help → Quick Tour and Help → What’s New to reopen either screen.
- Kept introductions out of active recordings and sample processing.

## 0.2.4 — 2026-10-14

- Shipped a Developer ID-signed, Apple-notarized app and DMG, with update ZIP and manifest for automatic updates.
- Added local speaker detection for live system audio and the bundled samples. The microphone remains labeled You; other voices receive per-call Speaker numbers.
- Included speaker labels in Markdown exports and MCP responses.
- Moved sample playback above the transcript and improved speaker-detection feedback.
- Kept the notes panel compact beside long transcripts and clarified assistant access to the call library.
- Organized Python code into `service/`, `tests/`, and `scripts/`.
- Added a database backup before migrating existing transcripts to support speaker labels.
- Verified three speakers across ten turns in the discussion sample, one speaker in the solo sample, and the streaming audio pipeline. The latest replay processed 111.65 seconds of sample audio in 81.66 seconds, excluding model loading. Passed 34 Python and 19 desktop tests.

Speaker labels are estimates. Older saved calls cannot be reprocessed because their audio was not retained; bundled samples can be run again. The app and installer passed stapling and macOS Gatekeeper checks. Verified automatic download and installation on quit from 0.2.3 to 0.2.4.

## 0.2.3 — 2026-10-13

- Added upcoming meetings and Join call actions to the macOS menu bar.
- Added a countdown before meetings and reminder choices of one minute, 30 seconds, or Off.
- Refreshed Calendar events while the window is closed and after the Mac wakes.
- Prevented duplicate reminders across refreshes and app restarts; discarded stale reminders after failed refreshes.
- Added app screenshots to the README.

Joining opens the meeting link. Recording still starts manually, and notification delivery depends on macOS permissions and Focus settings.

## 0.2.2 — 2026-10-13

- Bundled the Google desktop sign-in configuration so users no longer need to import an OAuth JSON file.
- Explained unavailable automatic-update packages more clearly and offered a link to downloads.
- Used a clean Mac installer filename without a test suffix.
- Documented the Apple verification warning beside the download link while notarization was pending.

Google Calendar sign-in remains limited to approved test accounts. Signing and notarization status is recorded in each release's notes.
