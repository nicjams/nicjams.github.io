#!/usr/bin/env python3
"""musicalCanvas backend: serves the app and stores sets in SQLite.

    python3 server.py           -> http://127.0.0.1:8770/
    python3 server.py 9000      -> different port

A set records the painted strokes (points, their beat/pitch position and the
millisecond timing of the gesture), the scene settings, and the MIDI notes
derived from them. Data lives in data/sets.db next to this file.

API
    GET    /api/health
    GET    /api/sets            -> {"sets": [summary, ...]}
    POST   /api/sets            -> create from a scene payload
    GET    /api/sets/<id>       -> full scene payload
    PUT    /api/sets/<id>       -> replace
    DELETE /api/sets/<id>
"""
import json
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, "data", "sets.db")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8770
MAX_BODY = 8 * 1024 * 1024

SCHEMA = """
CREATE TABLE IF NOT EXISTS sets (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    bpm        INTEGER,
    bars       INTEGER,
    n_strokes  INTEGER,
    n_notes    INTEGER,
    data       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute(SCHEMA)
    return con


def summarize(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "bpm": row["bpm"],
        "bars": row["bars"],
        "strokes": row["n_strokes"],
        "notes": row["n_notes"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def fields(payload):
    settings = payload.get("settings") or {}
    return (
        str(payload.get("name") or "Untitled set")[:200],
        int(settings.get("bpm") or 0),
        int(settings.get("bars") or 0),
        len(payload.get("strokes") or []),
        len(payload.get("notes") or []),
        json.dumps(payload, separators=(",", ":")),
    )


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # never cache: edits show up on plain reload
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        if not (args and str(args[1]).startswith("2")):
            super().log_message(fmt, *args)

    # ---- helpers ---------------------------------------------------------

    def _json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            raise ValueError("bad content length")
        return json.loads(self.rfile.read(n))

    def _route(self):
        """('sets', id|None) for /api/... paths, else None."""
        path = self.path.split("?")[0].strip("/")
        if not path.startswith("api/"):
            return None
        parts = path.split("/")[1:]
        return (parts[0], parts[1] if len(parts) > 1 else None)

    # ---- verbs -----------------------------------------------------------

    def do_GET(self):
        route = self._route()
        if route is None:
            return super().do_GET()
        kind, ident = route
        if kind == "health":
            return self._json({"ok": True, "db": DB_PATH})
        if kind != "sets":
            return self._json({"error": "not found"}, 404)
        with db() as con:
            if ident is None:
                rows = con.execute(
                    "SELECT * FROM sets ORDER BY updated_at DESC").fetchall()
                return self._json({"sets": [summarize(r) for r in rows]})
            row = con.execute("SELECT * FROM sets WHERE id = ?", (ident,)).fetchone()
            if not row:
                return self._json({"error": "no such set"}, 404)
            payload = json.loads(row["data"])
            payload.update(id=row["id"], updated_at=row["updated_at"])
            return self._json(payload)

    def do_POST(self):
        if self._route() != ("sets", None):
            return self._json({"error": "not found"}, 404)
        try:
            payload = self._body()
        except Exception as exc:
            return self._json({"error": f"bad payload: {exc}"}, 400)
        ident = uuid.uuid4().hex[:12]
        ts = now()
        with db() as con:
            con.execute(
                "INSERT INTO sets (id, name, bpm, bars, n_strokes, n_notes, data,"
                " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (ident, *fields(payload), ts, ts))
        return self._json({"id": ident, "updated_at": ts}, 201)

    def do_PUT(self):
        route = self._route()
        if not route or route[0] != "sets" or not route[1]:
            return self._json({"error": "not found"}, 404)
        try:
            payload = self._body()
        except Exception as exc:
            return self._json({"error": f"bad payload: {exc}"}, 400)
        ident, ts = route[1], now()
        with db() as con:
            cur = con.execute(
                "UPDATE sets SET name = ?, bpm = ?, bars = ?, n_strokes = ?,"
                " n_notes = ?, data = ?, updated_at = ? WHERE id = ?",
                (*fields(payload), ts, ident))
            if cur.rowcount == 0:
                return self._json({"error": "no such set"}, 404)
        return self._json({"id": ident, "updated_at": ts})

    def do_DELETE(self):
        route = self._route()
        if not route or route[0] != "sets" or not route[1]:
            return self._json({"error": "not found"}, 404)
        with db() as con:
            cur = con.execute("DELETE FROM sets WHERE id = ?", (route[1],))
            if cur.rowcount == 0:
                return self._json({"error": "no such set"}, 404)
        return self._json({"deleted": route[1]})


if __name__ == "__main__":
    with db() as con:
        n = con.execute("SELECT COUNT(*) FROM sets").fetchone()[0]
    handler = partial(Handler, directory=ROOT)
    with ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        httpd.daemon_threads = True
        print(f"musicalCanvas on http://127.0.0.1:{PORT}/  ({n} saved sets in {DB_PATH})")
        httpd.serve_forever()
