import Database from 'better-sqlite3';
import { unlinkSync } from 'node:fs';
import { JournalEntryRow, TagRow, EntryTagRow } from './types.js';

/**
 * The exact DDL for the FeltLog destination schema, transcribed from the app's initial
 * migration plus Kysely's internal migrator tables.
 *
 * This is a single-shot script, so the schema is hardcoded rather than dynamically
 * imported from the app source.
 */
const DDL = `
CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE journal_entries (
  id                  TEXT PRIMARY KEY,
  content             TEXT NOT NULL,
  datetime            TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  modified_at         TEXT NOT NULL,
  location_latitude   REAL,
  location_longitude  REAL,
  location_elevation  REAL,
  location_accuracy   REAL,
  location_address    TEXT
);

CREATE TABLE journal_entry_tags (
  entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);

CREATE TABLE kysely_migration (
  name      VARCHAR(255) PRIMARY KEY NOT NULL,
  timestamp VARCHAR(255) NOT NULL
);

CREATE TABLE kysely_migration_lock (
  id        VARCHAR(255) PRIMARY KEY NOT NULL,
  is_locked INTEGER NOT NULL DEFAULT 0
);
`;

/** Fixed deterministic timestamp for the kysely_migration row. */
const MIGRATION_TIMESTAMP = '1970-01-01T00:00:00.000Z';

/** The migration key registered by the FeltLog app. */
const MIGRATION_NAME = '20260523_one_create_initial_tables';

/**
 * Write a fully-formed FeltLog SQLite database to disk.
 *
 * Creates (or overwrites) the file at `outputPath`, applies the DDL, inserts all rows
 * inside a transaction, and runs `PRAGMA foreign_key_check` and `PRAGMA
 * integrity_check` before committing. If any check fails, better-sqlite3 rolls the
 * transaction back.
 *
 * @param outputPath - Absolute path for the output SQLite file.
 * @param tags - Transformed tag rows.
 * @param entries - Transformed journal entry rows.
 * @param entryTags - Junction rows linking entries to tags.
 */
export function writeDatabase(
  outputPath: string,
  tags: TagRow[],
  entries: JournalEntryRow[],
  entryTags: EntryTagRow[],
): void {
  const db = new Database(outputPath);
  let transactionCommitted = false;

  try {
    db.transaction(() => {
      db.exec('PRAGMA foreign_keys = ON');
      db.exec(DDL);

      const insertMigration = db.prepare(
        'INSERT INTO kysely_migration (name, timestamp) VALUES (?, ?)',
      );
      insertMigration.run(MIGRATION_NAME, MIGRATION_TIMESTAMP);

      const insertLock = db.prepare(
        'INSERT INTO kysely_migration_lock (id, is_locked) VALUES (?, ?)',
      );
      insertLock.run('migration_lock', 0);

      const insertTag = db.prepare('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)');
      for (const tag of tags) {
        insertTag.run(tag.id, tag.name, tag.created_at);
      }

      const insertEntry = db.prepare(
        'INSERT INTO journal_entries (id, content, datetime, created_at, modified_at, location_latitude, location_longitude, location_elevation, location_accuracy, location_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const entry of entries) {
        insertEntry.run(
          entry.id,
          entry.content,
          entry.datetime,
          entry.created_at,
          entry.modified_at,
          entry.location_latitude,
          entry.location_longitude,
          entry.location_elevation,
          entry.location_accuracy,
          entry.location_address,
        );
      }

      const insertEntryTag = db.prepare(
        'INSERT INTO journal_entry_tags (entry_id, tag_id) VALUES (?, ?)',
      );
      for (const et of entryTags) {
        insertEntryTag.run(et.entry_id, et.tag_id);
      }

      const fkResult = db.prepare('PRAGMA foreign_key_check').all();
      if (fkResult.length > 0) {
        throw new Error(`PRAGMA foreign_key_check returned ${fkResult.length} violation(s)`);
      }

      const integrityResult = db.prepare('PRAGMA integrity_check').get() as {
        integrity_check: string;
      };
      if (integrityResult.integrity_check !== 'ok') {
        throw new Error(`PRAGMA integrity_check failed: ${integrityResult.integrity_check}`);
      }
    })();
    transactionCommitted = true;
  } finally {
    db.close();
    if (!transactionCommitted) {
      try {
        unlinkSync(outputPath);
      } catch {
        // ignore — the file may not exist or may already be gone
      }
    }
  }
}
