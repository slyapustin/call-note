"""Durable, model-independent call library shared by the app and MCP."""
from contextlib import contextmanager
from datetime import datetime, timezone
import os
import json
from pathlib import Path
import sqlite3
import sys
import uuid
from call_audio import audio_path, audio_info


def data_directory():
    if os.environ.get("CALL_DESK_DATA"):
        return Path(os.environ["CALL_DESK_DATA"])
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/CallDesk"
    return Path(os.environ.get("APPDATA", Path.home() / ".local/share")) / "CallDesk"


def now():
    return datetime.now(timezone.utc).isoformat()


class CallStore:
    def __init__(self, directory=None):
        self.directory = Path(directory) if directory else data_directory()
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.directory / "calls.sqlite3"
        if self.path.exists():
            with sqlite3.connect(self.path) as source:
                columns = {row[1] for row in source.execute("PRAGMA table_info(segments)")}
                if columns and not {"speaker", "speaker_name"}.issubset(columns):
                    backups = self.directory / 'backups'
                    backups.mkdir(exist_ok=True, mode=0o700)
                    backup = backups / f'calls-before-speaker-names-{uuid.uuid4().hex}.sqlite3'
                    with sqlite3.connect(backup) as target:
                        source.backup(target)
                    if os.name != 'nt':
                        backup.chmod(0o600)
        with self.connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS calls (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, started_at TEXT NOT NULL,
                    ended_at TEXT, status TEXT NOT NULL DEFAULT 'recording',
                    duration REAL NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '',
                    archived INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'call'
                );
                CREATE TABLE IF NOT EXISTS segments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, call_id TEXT NOT NULL REFERENCES calls(id),
                    source TEXT NOT NULL, start REAL NOT NULL, end REAL NOT NULL, text TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS segments_call ON segments(call_id, start);
                CREATE TABLE IF NOT EXISTS speaker_names (
                    call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
                    source TEXT NOT NULL, speaker INTEGER NOT NULL, name TEXT NOT NULL,
                    PRIMARY KEY(call_id, source, speaker)
                );
                CREATE TABLE IF NOT EXISTS analyses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, call_id TEXT NOT NULL REFERENCES calls(id),
                    created_at TEXT NOT NULL, author TEXT NOT NULL, markdown TEXT NOT NULL
                );
            """)
            columns = {row[1] for row in db.execute("PRAGMA table_info(calls)")}
            if "calendar_event" not in columns:
                db.execute("ALTER TABLE calls ADD COLUMN calendar_event TEXT")
            columns = {row[1] for row in db.execute("PRAGMA table_info(segments)")}
            if "speaker" not in columns:
                db.execute("ALTER TABLE segments ADD COLUMN speaker INTEGER")
            if "speaker_name" not in columns:
                db.execute("ALTER TABLE segments ADD COLUMN speaker_name TEXT")
        if os.name != "nt":
            self.path.chmod(0o600)

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def recover(self):
        with self.connect() as db:
            db.execute("UPDATE calls SET status='interrupted', ended_at=? WHERE status='recording'", (now(),))

    def create(self, title, source="call", calendar_event=None):
        call_id = uuid.uuid4().hex
        with self.connect() as db:
            db.execute("INSERT INTO calls(id,title,started_at,source,calendar_event) VALUES(?,?,?,?,?)",
                       (call_id, title.strip()[:200] or "Untitled call", now(), source, json.dumps(calendar_event) if calendar_event else None))
        return self.get(call_id)

    def append(self, call_id, source, start, end, text, speaker=None):
        if source not in {"microphone", "system", "sample"}:
            raise ValueError("Unknown audio source")
        if speaker is not None and (type(speaker) is not int or not 1 <= speaker <= 32):
            raise ValueError("Invalid speaker label")
        if not text.strip():
            return None
        with self.connect() as db:
            cursor = db.execute("INSERT INTO segments(call_id,source,start,end,text,speaker) VALUES(?,?,?,?,?,?)",
                                (call_id, source, start, end, text.strip(), speaker))
            db.execute("UPDATE calls SET duration=MAX(duration,?) WHERE id=?", (end, call_id))
            return dict(db.execute("SELECT * FROM segments WHERE id=?", (cursor.lastrowid,)).fetchone())

    def finish(self, call_id, duration, status="complete"):
        with self.connect() as db:
            db.execute("UPDATE calls SET ended_at=?, status=?, duration=MAX(duration,?) WHERE id=?",
                       (now(), status, duration, call_id))

    def list(self, query="", limit=50, offset=0):
        limit = max(1, min(int(limit), 100))
        needle = "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        with self.connect() as db:
            return [dict(row) for row in db.execute("""
                SELECT c.*, (SELECT COUNT(*) FROM segments s WHERE s.call_id=c.id) AS segment_count
                FROM calls c WHERE archived=0 AND
                (?='' OR c.title LIKE ? ESCAPE char(92) OR c.notes LIKE ? ESCAPE char(92) OR EXISTS
                (SELECT 1 FROM segments s WHERE s.call_id=c.id AND s.text LIKE ? ESCAPE char(92)))
                ORDER BY started_at DESC LIMIT ? OFFSET ?
            """, (query, needle, needle, needle, limit, max(0, offset)))]

    def get(self, call_id):
        with self.connect() as db:
            call = db.execute("SELECT * FROM calls WHERE id=? AND archived=0", (call_id,)).fetchone()
            if call is None:
                raise KeyError("Call not found")
            result = dict(call)
            result["audio"] = audio_info(self.directory, call_id) if result["status"] != "recording" else None
            result["calendar_event"] = json.loads(result["calendar_event"]) if result["calendar_event"] else None
            result["segments"] = [dict(row) for row in db.execute(
                "SELECT * FROM segments WHERE call_id=? ORDER BY start,id", (call_id,))]
            result["speaker_names"] = [dict(row) for row in db.execute(
                "SELECT source,speaker,name FROM speaker_names WHERE call_id=?", (call_id,))]
            names = {(row['source'], row['speaker']): row['name'] for row in result['speaker_names']}
            for segment in result['segments']:
                segment['display_name'] = segment['speaker_name'] or names.get((segment['source'], segment['speaker'] or 0))
            result["analyses"] = [dict(row) for row in db.execute(
                "SELECT * FROM analyses WHERE call_id=? ORDER BY id DESC", (call_id,))]
            return result

    def update(self, call_id, title=None, notes=None):
        self.get(call_id)
        with self.connect() as db:
            if title is not None:
                db.execute("UPDATE calls SET title=? WHERE id=?", (title.strip()[:200] or "Untitled call", call_id))
            if notes is not None:
                db.execute("UPDATE calls SET notes=? WHERE id=?", (notes[:20000], call_id))
        return self.get(call_id)

    def name_speaker(self, call_id, segment_id, name, scope='speaker'):
        if not isinstance(name, str) or len(name) > 100 or any(ord(c) < 32 or ord(c) == 127 for c in name):
            raise ValueError("Use a single-line name of at most 100 characters.")
        if scope not in {'speaker', 'segment'}:
            raise ValueError("Invalid naming scope")
        name = name.strip()
        self.get(call_id)
        with self.connect() as db:
            row = db.execute("SELECT * FROM segments WHERE call_id=? AND id=?", (call_id, segment_id)).fetchone()
            if row is None:
                raise KeyError("Segment not found")
            if scope == 'segment':
                db.execute("UPDATE segments SET speaker_name=? WHERE id=?", (name or None, segment_id))
            else:
                if row['speaker'] is None and row['source'] != 'microphone':
                    raise ValueError("Assign uncertain speakers one line at a time.")
                db.execute("INSERT INTO speaker_names(call_id,source,speaker,name) VALUES(?,?,?,?) "
                           "ON CONFLICT(call_id,source,speaker) DO UPDATE SET name=excluded.name",
                           (call_id, row['source'], row['speaker'] or 0, name))
        return self.get(call_id)

    def archive(self, call_id):
        self.get(call_id)
        with self.connect() as db:
            db.execute("UPDATE calls SET archived=1 WHERE id=?", (call_id,))

    def delete(self, call_id):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            call = db.execute("SELECT status FROM calls WHERE id=? AND archived=0", (call_id,)).fetchone()
            if call is None:
                raise KeyError("Call not found")
            if call['status'] == 'recording':
                raise ValueError("Stop and save the call before deleting it.")
            audio_path(self.directory, call_id).unlink(missing_ok=True)
            db.execute("DELETE FROM analyses WHERE call_id=?", (call_id,))
            db.execute("DELETE FROM segments WHERE call_id=?", (call_id,))
            db.execute("DELETE FROM calls WHERE id=?", (call_id,))

    def save_analysis(self, call_id, markdown, author):
        self.get(call_id)
        if not markdown.strip() or len(markdown) > 100000:
            raise ValueError("Analysis must contain 1–100,000 characters")
        with self.connect() as db:
            cursor = db.execute("INSERT INTO analyses(call_id,created_at,author,markdown) VALUES(?,?,?,?)",
                                (call_id, now(), author[:100], markdown))
            return {"analysis_id": cursor.lastrowid, "call_id": call_id}


def transcript_markdown(call):
    labels = {"microphone": "You", "system": "Others", "sample": "Sample"}
    lines = [f"# {call['title']}", "", f"Call ID: {call['id']}", f"Started: {call['started_at']}", ""]
    for segment in call["segments"]:
        seconds = int(segment["start"])
        label = segment.get('display_name') or (('Speaker ' + str(segment['speaker'])) if segment.get('speaker') else labels[segment['source']])
        lines.append(f"[{seconds // 60:02}:{seconds % 60:02}] {label} (segment {segment['id']}): {segment['text']}")
    if call["notes"]:
        lines.extend(["", "## Notes", call["notes"]])
    return "\n".join(lines)
