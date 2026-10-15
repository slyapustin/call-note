# Optional usage analytics

Status: the consent feature is enabled in `desktop/privacy-config.json` for 0.2.14. Optional usage collection remains OFF until each installation explicitly opts in. Publisher: Sergey Lyapustin; privacy contact: hi@slyapustin.com. Releases through 0.2.13 send no usage analytics. The dashboard is protected by Cloudflare Access with an owner-only email policy.

## User choices

Settings → Privacy opens the document review and controls. Before new transcription, a configured build requires acceptance of the current terms; existing saved calls remain accessible. Analytics is a separate unchecked choice and is not required for transcription. Accepting terms syncs a minimal installation acceptance record even with analytics off; this is disclosed beside the controls.

Turning analytics off immediately stops local collection and clears queued events. Revocation syncs when online. Delete usage data stops collection, retries offline deletion, and does not delete saved calls. The backend retains a hash-only deletion marker for 90 days to prevent late requests from recreating the data.

## Data and limitations

Events contain a random installation ID, event ID, UTC day, app version and platform, plus a fixed event type and optional approved feature/error code or rounded call duration. Names, audio, transcripts, notes, Calendar information, email addresses, device names, paths, voice profiles and exception messages are excluded. Installation identity is pseudonymous, not anonymous.

The database keeps optional events for 90 days with daily cleanup, and acceptance records until deletion. The client keeps at most 100 unsent events for seven days. Request bodies and errors are not logged by the Worker. Cloudflare still processes network metadata; a short-lived IP hash is used for request throttling, never stored in D1.

Dashboard usage totals reflect opting-in installations, not all users. Consent totals are separate, all-time records. A single person can have several installations; reinstallations may create a new identity. Client-submitted events cannot prove real usage and should not be used for billing. Daily active counts cannot be summed into unique monthly users. A lost installation secret prevents proving ownership of its remote record through the in-app deletion flow.

## Components

- `desktop/analytics.cjs`: opt-in storage, consent sync, bounded batching, retries, deletion.
- `desktop/privacy.cjs` and `desktop/ui/privacy.js`: trusted IPC, documents and explicit choices.
- `analytics/`: Worker, migrations, Access JWT verification, private dashboard and CSV.
- [Backend setup](../analytics/README.md): deployment and auth configuration.

The dashboard has no analytics MCP server in this first implementation. CSV and authenticated aggregate HTTP endpoints are available; MCP can be added without exposing installation credentials or individual records.

## Checks

Run `node --test desktop/*.test.cjs`, `npm test --prefix analytics`, and `.venv/bin/python -m pytest -q`. Cloudflare tests exercise real local D1 plus signed JWT test fixtures. They do not establish production sign-in, visual browser behavior or consent from any real user.

Optional local call recordings are separate from usage analytics. WAV files stay in the local call library and are never attached to events or diagnostic reports. The recording choice does not change analytics consent.
