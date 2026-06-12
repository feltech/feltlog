import { mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { readSourceDatabase } from '../src/db-reader.js';
import { transformAll } from '../src/transformer.js';
import { writeDatabase } from '../src/db-writer.js';

const SOURCE_DB = '/home/dave/workspace/feltlog/memoires_backup/memories.db3';

describe('round-trip against real source DB', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'memoires-roundtrip-'));
    dbPath = join(tmpDir, 'memories.db3.migrated');

    const { memos, tags, tagEarliestCreated } = readSourceDatabase(SOURCE_DB);
    const {
      entries,
      tags: transformedTags,
      entryTags,
    } = transformAll(memos, tags, tagEarliestCreated);

    writeDatabase(dbPath, transformedTags, entries, entryTags);
  });

  afterAll(() => {
    try {
      unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it('opens the produced DB with a fresh Database instance', () => {
    const db = new Database(dbPath, { readonly: true });
    expect(db.open).toBe(true);
    db.close();
  });

  it('reads back all 5 tags', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db.prepare('SELECT * FROM tags ORDER BY name ASC').all() as Array<{
        id: string;
        name: string;
        created_at: string;
      }>;
      expect(rows).toHaveLength(5);
      expect(rows.map(r => r.name)).toEqual([
        'Blessings',
        'Diary',
        'Dream',
        'Idea',
        'Retrospective',
      ]);
      // All IDs should be non-empty UUIDs.
      for (const row of rows) {
        expect(row.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
      }
    } finally {
      db.close();
    }
  });

  it('reads back all 415 journal_entries', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.prepare('SELECT COUNT(*) as c FROM journal_entries').get() as {
        c: number;
      };
      expect(row.c).toBe(415);
    } finally {
      db.close();
    }
  });

  it('joins entries with their tags without dangling references', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db
        .prepare(
          `
          SELECT je.id, je.content, t.name AS tag_name
          FROM journal_entries je
          LEFT JOIN journal_entry_tags jet ON je.id = jet.entry_id
          LEFT JOIN tags t ON jet.tag_id = t.id
          ORDER BY je.datetime ASC
          LIMIT 5
          `,
        )
        .all() as Array<{
        id: string;
        content: string;
        tag_name: string | null;
      }>;
      expect(rows.length).toBe(5);
      for (const row of rows) {
        expect(typeof row.id).toBe('string');
        expect(typeof row.content).toBe('string');
      }
    } finally {
      db.close();
    }
  });

  it('reads back the kysely_migration row', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.prepare('SELECT * FROM kysely_migration').get() as {
        name: string;
        timestamp: string;
      };
      expect(row.name).toBe('20260523_one_create_initial_tables');
      expect(row.timestamp).toBe('1970-01-01T00:00:00.000Z');
    } finally {
      db.close();
    }
  });

  it('reads back the migration_lock row', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.prepare('SELECT * FROM kysely_migration_lock').get() as {
        id: string;
        is_locked: number;
      };
      expect(row.id).toBe('migration_lock');
      expect(row.is_locked).toBe(0);
    } finally {
      db.close();
    }
  });

  it('spot-checks entry 415 location and address', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      // entry 415 is the 415th row in order of creation (datetime ASC).
      const rows = db
        .prepare(
          `SELECT location_latitude, location_longitude, location_address FROM journal_entries ORDER BY datetime ASC LIMIT 415`,
        )
        .all() as Array<{
        location_latitude: number | null;
        location_longitude: number | null;
        location_address: string | null;
      }>;
      const last = rows[rows.length - 1];
      expect(last.location_latitude).toBeCloseTo(53.7939697, 6);
      expect(last.location_longitude).toBeCloseTo(-2.294709, 6);
      expect(last.location_address).toBe('24 Tate Cl, Burnley BB12 6ES, UK');
    } finally {
      db.close();
    }
  });
});
