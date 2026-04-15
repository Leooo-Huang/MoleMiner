/**
 * SQLite storage for search queries and results.
 * Uses sql.js (WASM SQLite) for cross-platform compatibility.
 */

import initSqlJs, { type Database } from 'sql.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SearchResult, GeoLocation, SourceStatus } from './models.js';

const SCHEMA = `
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
    language TEXT,
    timestamp TEXT,
    mentions TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',
    summary TEXT,
    location TEXT,
    FOREIGN KEY (search_id) REFERENCES searches(id)
);

CREATE INDEX IF NOT EXISTS idx_results_search_id ON results(search_id);

CREATE TABLE IF NOT EXISTS source_statuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    search_id INTEGER NOT NULL,
    source_name TEXT NOT NULL,
    status TEXT NOT NULL,
    result_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    elapsed_seconds REAL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (search_id) REFERENCES searches(id)
);

CREATE INDEX IF NOT EXISTS idx_source_statuses_name_id ON source_statuses(source_name, id DESC);
`;

export class SearchStore {
  private db: Database;
  private dbPath?: string;
  private dirty = false;

  private constructor(db: Database, dbPath?: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  /**
   * Create a new SearchStore.
   * If dbPath is provided, loads existing DB from file (or creates new).
   * If omitted, uses an in-memory database.
   */
  static async create(dbPath?: string): Promise<SearchStore> {
    const SQL = await initSqlJs();

    let db: Database;
    if (dbPath && existsSync(dbPath)) {
      const buffer = readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }

    const store = new SearchStore(db, dbPath);
    store.initDb();
    return store;
  }

  private initDb(): void {
    this.db.run(SCHEMA);
    // Migrate: add columns if missing (for existing databases)
    for (const col of ['summary TEXT', 'location TEXT', 'importance_score REAL']) {
      try {
        this.db.run(`ALTER TABLE results ADD COLUMN ${col}`);
      } catch {
        // Column already exists — expected for new databases
      }
    }
  }

  /** Save a search with its results. Returns the search ID. */
  saveSearch(query: string, sourcesUsed: string[], results: SearchResult[]): number {
    const now = new Date().toISOString();

    this.db.run(
      'INSERT INTO searches (query, sources_used, result_count, searched_at) VALUES (?, ?, ?, ?)',
      [query, JSON.stringify(sourcesUsed), results.length, now],
    );

    // sql.js doesn't have lastInsertRowId on the statement, but we can query it
    const idRows = this.db.exec('SELECT last_insert_rowid() as id');
    const searchId = idRows[0].values[0][0] as number;

    this.db.run('BEGIN');
    try {
      for (const r of results) {
        this.db.run(
          `INSERT INTO results
           (search_id, title, url, source, snippet, result_type, language, timestamp, mentions, metadata, summary, location, importance_score)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            searchId,
            r.title,
            r.url,
            r.source,
            r.snippet,
            r.resultType ?? 'direct',
            r.language ?? null,
            r.timestamp ?? null,
            JSON.stringify(r.mentions ?? []),
            JSON.stringify(r.metadata ?? {}),
            r.summary ?? null,
            r.location ? JSON.stringify(r.location) : null,
            r.importanceScore ?? null,
          ],
        );
      }
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }

    this.dirty = true;
    return searchId;
  }

  /** Save per-source statuses for a given search. */
  saveSourceStatuses(searchId: number, statuses: SourceStatus[]): void {
    if (statuses.length === 0) return;
    const now = new Date().toISOString();
    this.db.run('BEGIN');
    try {
      for (const s of statuses) {
        this.db.run(
          `INSERT INTO source_statuses
           (search_id, source_name, status, result_count, error, elapsed_seconds, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            searchId,
            s.name,
            s.status,
            s.resultCount,
            s.error ?? null,
            s.elapsedSeconds ?? null,
            now,
          ],
        );
      }
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
    this.dirty = true;
  }

  /**
   * Get the most recent status for each source (one entry per source_name).
   * Returns a Map keyed by source_name.
   */
  getLastSourceStatuses(): Map<string, {
    status: string;
    resultCount: number;
    error?: string;
    elapsedSeconds?: number;
    createdAt: string;
  }> {
    const map = new Map<string, {
      status: string;
      resultCount: number;
      error?: string;
      elapsedSeconds?: number;
      createdAt: string;
    }>();

    const result = this.db.exec(`
      SELECT s1.source_name, s1.status, s1.result_count, s1.error, s1.elapsed_seconds, s1.created_at
      FROM source_statuses s1
      INNER JOIN (
        SELECT source_name, MAX(id) AS max_id
        FROM source_statuses
        GROUP BY source_name
      ) s2 ON s1.source_name = s2.source_name AND s1.id = s2.max_id
    `);

    if (result.length > 0) {
      for (const row of result[0].values) {
        map.set(row[0] as string, {
          status: row[1] as string,
          resultCount: row[2] as number,
          error: (row[3] as string | null) ?? undefined,
          elapsedSeconds: (row[4] as number | null) ?? undefined,
          createdAt: row[5] as string,
        });
      }
    }
    return map;
  }

  /** Get a search record by ID. Returns null if not found. */
  getSearch(searchId: number): Record<string, unknown> | null {
    const stmt = this.db.prepare('SELECT * FROM searches WHERE id = ?');
    stmt.bind([searchId]);

    if (!stmt.step()) {
      stmt.free();
      return null;
    }

    const row = stmt.getAsObject();
    stmt.free();
    return row as Record<string, unknown>;
  }

  /** Get all results for a search ID. Parses JSON fields (location, metadata, mentions). */
  getResults(searchId: number): Record<string, unknown>[] {
    const stmt = this.db.prepare('SELECT * FROM results WHERE search_id = ? ORDER BY id');
    stmt.bind([searchId]);

    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      if (typeof row.location === 'string') {
        try { row.location = JSON.parse(row.location); } catch { row.location = null; }
      }
      if (typeof row.metadata === 'string') {
        try { row.metadata = JSON.parse(row.metadata); } catch { row.metadata = {}; }
      }
      if (typeof row.mentions === 'string') {
        try { row.mentions = JSON.parse(row.mentions); } catch { row.mentions = []; }
      }
      rows.push(row);
    }
    stmt.free();
    return rows;
  }

  /** Delete a search and its results. Returns true if found. */
  deleteSearch(searchId: number): boolean {
    const exists = this.getSearch(searchId);
    if (!exists) return false;

    this.db.run('DELETE FROM results WHERE search_id = ?', [searchId]);
    this.db.run('DELETE FROM searches WHERE id = ?', [searchId]);
    this.dirty = true;
    return true;
  }

  /** Get aggregate stats for a search. */
  getSearchStats(searchId: number): { directCount: number; leadCount: number; locationCount: number; sourceBreakdown: Record<string, number> } {
    const results = this.getResults(searchId);
    let directCount = 0;
    let leadCount = 0;
    let locationCount = 0;
    const sourceBreakdown: Record<string, number> = {};

    for (const r of results) {
      if (r.result_type === 'direct') directCount++;
      else leadCount++;
      if (r.location) locationCount++;
      const src = String(r.source ?? 'unknown');
      sourceBreakdown[src] = (sourceBreakdown[src] ?? 0) + 1;
    }

    return { directCount, leadCount, locationCount, sourceBreakdown };
  }

  /** List recent searches, newest first. */
  listSearches(limit: number = 20): Record<string, unknown>[] {
    const stmt = this.db.prepare('SELECT * FROM searches ORDER BY id DESC LIMIT ?');
    stmt.bind([limit]);

    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as Record<string, unknown>);
    }
    stmt.free();
    return rows;
  }

  /**
   * Get all URLs from previous searches that used a similar query.
   * Used for cross-session diff mode — marks results as NEW vs KNOWN.
   */
  getHistoricalUrls(query: string): Set<string> {
    // Find previous searches with the same or similar query
    const stmt = this.db.prepare(
      'SELECT id FROM searches WHERE query = ? ORDER BY id DESC LIMIT 10',
    );
    stmt.bind([query]);

    const searchIds: number[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      searchIds.push(row.id as number);
    }
    stmt.free();

    if (searchIds.length === 0) return new Set();

    // Get all URLs from those searches
    const urls = new Set<string>();
    for (const sid of searchIds) {
      const urlStmt = this.db.prepare('SELECT url FROM results WHERE search_id = ?');
      urlStmt.bind([sid]);
      while (urlStmt.step()) {
        const row = urlStmt.getAsObject() as Record<string, unknown>;
        if (row.url) urls.add(String(row.url));
      }
      urlStmt.free();
    }

    return urls;
  }

  /** Persist to file without closing. Safe to call repeatedly. */
  flush(): void {
    if (this.dbPath && this.dirty) {
      const data = this.db.export();
      mkdirSync(dirname(this.dbPath), { recursive: true });
      writeFileSync(this.dbPath, Buffer.from(data));
      this.dirty = false;
    }
  }

  /** Persist to file (if dbPath set and data was modified) and close the database. */
  close(): void {
    if (this.dbPath && this.dirty) {
      const data = this.db.export();
      mkdirSync(dirname(this.dbPath), { recursive: true });
      writeFileSync(this.dbPath, Buffer.from(data));
    }
    this.db.close();
  }
}
