# Changelog

## 0.2.4 — Unreleased

- Added local speaker detection for live system audio and the bundled samples. The microphone remains labeled You; other voices receive per-call Speaker numbers.
- Included speaker labels in Markdown exports and MCP responses.
- Moved sample playback above the transcript and improved speaker-detection feedback.
- Kept the notes panel compact beside long transcripts and clarified assistant access to the call library.
- Organized Python code into `service/`, `tests/`, and `scripts/`.
- Added a database backup before migrating existing transcripts to support speaker labels.
- Verified three speakers across ten turns in the discussion sample, one speaker in the solo sample, and the streaming audio pipeline. Passed 34 Python and 19 desktop tests.

Speaker labels are estimates. Older saved calls cannot be reprocessed because their audio was not retained; bundled samples can be run again. See the release notes for this build's final signing and notarization status.

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
