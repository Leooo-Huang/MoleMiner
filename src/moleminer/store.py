"""SQLite storage for search queries and results."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from moleminer.models import SearchResult

_DEFAULT_DB_PATH = Path.home() / ".moleminer" / "moleminer.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    sources_used TEXT NOT NULL,
    result_count INTEGER NOT NULL DEFAULT 0,
    searched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    search_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    source TEXT NOT NULL,
    snippet TEXT NOT NULL DEFAULT '',
    result_type TEXT NOT NULL DEFAULT 'direct',
    timestamp TEXT,
    mentions TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (search_id) REFERENCES searches(id)
);

CREATE INDEX IF NOT EXISTS idx_results_search_id ON results(search_id);
"""


class SearchStore:
    """Manages SQLite storage for search history."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or _DEFAULT_DB_PATH

    def init_db(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.executescript(_SCHEMA)
        conn.close()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def save_search(
        self,
        query: str,
        sources_used: list[str],
        results: list[SearchResult],
    ) -> int:
        conn = self._connect()
        now = datetime.now(timezone.utc).isoformat()
        cursor = conn.execute(
            "INSERT INTO searches (query, sources_used, result_count, searched_at) VALUES (?, ?, ?, ?)",
            (query, json.dumps(sources_used), len(results), now),
        )
        search_id = cursor.lastrowid
        assert search_id is not None
        for r in results:
            conn.execute(
                """INSERT INTO results
                   (search_id, title, url, source, snippet, result_type, timestamp, mentions, metadata)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    search_id,
                    r.title,
                    r.url,
                    r.source,
                    r.snippet,
                    r.result_type,
                    r.timestamp,
                    json.dumps(r.mentions),
                    json.dumps(r.metadata),
                ),
            )
        conn.commit()
        conn.close()
        return search_id

    def get_search(self, search_id: int) -> dict[str, Any] | None:
        conn = self._connect()
        row = conn.execute("SELECT * FROM searches WHERE id = ?", (search_id,)).fetchone()
        conn.close()
        if row is None:
            return None
        return dict(row)

    def get_results(self, search_id: int) -> list[dict[str, Any]]:
        conn = self._connect()
        rows = conn.execute(
            "SELECT * FROM results WHERE search_id = ? ORDER BY id", (search_id,)
        ).fetchall()
        conn.close()
        return [dict(row) for row in rows]

    def list_searches(self, limit: int = 20) -> list[dict[str, Any]]:
        conn = self._connect()
        rows = conn.execute("SELECT * FROM searches ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        conn.close()
        return [dict(row) for row in rows]
