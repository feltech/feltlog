import { mkdtempSync, unlinkSync, openSync, readSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { writeDatabase } from '../src/db-writer.js';
import { TagRow, JournalEntryRow, EntryTagRow } from '../src/types.js';

describe('writeDatabase', () => {
  const tags: TagRow[] = [
    { id: 'tag-1', name: 'Diary', created_at: '2024-01-01T00:00:00.000Z' },
    { id: 'tag-2', name: 'Blessings', created_at: '2024-01-02T00:00:00.000Z' },
    { id: 'tag-3', name: 'Dream', created_at: '2024-01-03T00:00:00.000Z' },
    { id: 'tag-4', name: 'Idea', created_at: '2024-01-04T00:00:00.000Z' },
    { id: 'tag-5', name: 'Retrospective', created_at: '2024-01-05T00:00:00.000Z' },
  ];

  const entries: JournalEntryRow[] = [
    {
      id: 'entry-244',
      content:
        '# (Unrecoverable entry)\n\nThis entry could not be migrated from the source ' +
        'database because the original app stored an encrypted copy of it and the ' +
        'encryption key is no longer available. The entry was originally dated ' +
        '2008-03-09T22:24:19.000Z.',
      datetime: '2008-03-09T22:24:19.000Z',
      created_at: '2008-03-09T22:24:19.000Z',
      modified_at: '2008-03-09T22:24:19.000Z',
      location_latitude: null,
      location_longitude: null,
      location_elevation: null,
      location_accuracy: null,
      location_address: null,
    },
    {
      id: 'entry-415',
      content: 'Morning note',
      datetime: '2025-01-01T08:00:00.000Z',
      created_at: '2025-01-01T08:00:00.000Z',
      modified_at: '2025-01-01T08:00:00.000Z',
      location_latitude: 53.7939697,
      location_longitude: -2.294709,
      location_elevation: null,
      location_accuracy: null,
      location_address: '24 Tate Cl, Burnley BB12 6ES, UK',
    },
  ];

  const entryTags: EntryTagRow[] = [
    { entry_id: 'entry-244', tag_id: 'tag-1' },
    { entry_id: 'entry-415', tag_id: 'tag-2' },
  ];

  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'memoires-test-'));
    dbPath = join(tmpDir, 'test.db');
    writeDatabase(dbPath, tags, entries, entryTags);
  });

  afterEach(() => {
    try {
      unlinkSync(dbPath);
    } catch {
      // ignore
    }
    try {
      unlinkSync(`${dbPath}.tmp`);
    } catch {
      // ignore
    }
  });

  it('produces a valid SQLite file (magic bytes "SQLite format 3\\0")', () => {
    const fd = openSync(dbPath, 'r');
    const buf = Buffer.alloc(16);
    readSync(fd, buf, 0, 16, 0);
    closeSync(fd);
    expect(buf.toString('utf-8', 0, 16)).toBe('SQLite format 3\u0000');
  });

  it('creates the three domain tables with the expected columns', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const tagColumns = db.prepare("PRAGMA table_info('tags')").all() as Array<{
        name: string;
      }>;
      expect(tagColumns.map(c => c.name)).toEqual(['id', 'name', 'created_at']);

      const entryColumns = db.prepare("PRAGMA table_info('journal_entries')").all() as Array<{
        name: string;
      }>;
      expect(entryColumns.map(c => c.name)).toEqual([
        'id',
        'content',
        'datetime',
        'created_at',
        'modified_at',
        'location_latitude',
        'location_longitude',
        'location_elevation',
        'location_accuracy',
        'location_address',
      ]);

      const junctionColumns = db
        .prepare("PRAGMA table_info('journal_entry_tags')")
        .all() as Array<{
        name: string;
      }>;
      expect(junctionColumns.map(c => c.name)).toEqual(['entry_id', 'tag_id']);
    } finally {
      db.close();
    }
  });

  it('creates both kysely_migration tables', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'kysely_%'")
        .all() as Array<{ name: string }>;
      const names = tables.map(t => t.name);
      expect(names).toContain('kysely_migration');
      expect(names).toContain('kysely_migration_lock');
    } finally {
      db.close();
    }
  });

  it('inserts the expected number of rows', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const tagCount = db.prepare('SELECT COUNT(*) as c FROM tags').get() as {
        c: number;
      };
      expect(tagCount.c).toBe(5);

      const entryCount = db.prepare('SELECT COUNT(*) as c FROM journal_entries').get() as {
        c: number;
      };
      expect(entryCount.c).toBe(2);

      const junctionCount = db.prepare('SELECT COUNT(*) as c FROM journal_entry_tags').get() as {
        c: number;
      };
      expect(junctionCount.c).toBe(2);
    } finally {
      db.close();
    }
  });

  it('inserts the kysely_migration row for the initial migration', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.prepare('SELECT name, timestamp FROM kysely_migration').get() as {
        name: string;
        timestamp: string;
      };
      expect(row.name).toBe('20260523_one_create_initial_tables');
      expect(typeof row.timestamp).toBe('string');
      expect(row.timestamp.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('inserts the kysely_migration_lock row', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.prepare('SELECT id, is_locked FROM kysely_migration_lock').get() as {
        id: string;
        is_locked: number;
      };
      expect(row.id).toBe('migration_lock');
      expect(row.is_locked).toBe(0);
    } finally {
      db.close();
    }
  });

  it('passes foreign_key_check', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const violations = db.prepare('PRAGMA foreign_key_check').all();
      expect(violations).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('passes integrity_check', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const result = db.prepare('PRAGMA integrity_check').get() as {
        integrity_check: string;
      };
      expect(result.integrity_check).toBe('ok');
    } finally {
      db.close();
    }
  });

  it('inserts correct content for the placeholder entry (id = entry-244)', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .prepare("SELECT content FROM journal_entries WHERE id = 'entry-244'")
        .get() as { content: string };
      expect(row.content).toContain('Unrecoverable entry');
      expect(row.content).toContain('2008-03-09T22:24:19.000Z');
    } finally {
      db.close();
    }
  });

  it('inserts correct lat/lng for known entries (id = entry-415)', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .prepare(
          "SELECT location_latitude, location_longitude FROM journal_entries WHERE id = 'entry-415'",
        )
        .get() as {
        location_latitude: number;
        location_longitude: number;
      };
      expect(row.location_latitude).toBeCloseTo(53.7939697, 6);
      expect(row.location_longitude).toBeCloseTo(-2.294709, 6);
    } finally {
      db.close();
    }
  });

  it('populates location_address from locality', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .prepare("SELECT location_address FROM journal_entries WHERE id = 'entry-415'")
        .get() as { location_address: string };
      expect(row.location_address).toBe('24 Tate Cl, Burnley BB12 6ES, UK');
    } finally {
      db.close();
    }
  });

  it('throws when a foreign key is violated and removes the output file', () => {
    const badDbPath = join(tmpDir, 'bad.db');
    const badEntryTags: EntryTagRow[] = [
      ...entryTags,
      { entry_id: 'entry-415', tag_id: 'tag-does-not-exist' },
    ];
    expect(() => writeDatabase(badDbPath, tags, entries, badEntryTags)).toThrow(
      'FOREIGN KEY constraint failed',
    );
    expect(() => openSync(badDbPath, 'r')).toThrow();
  });

  it('preserves tags as many-to-many', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const tagNames = db.prepare('SELECT name FROM tags ORDER BY name ASC').all() as Array<{
        name: string;
      }>;
      expect(tagNames.map(t => t.name)).toEqual([
        'Blessings',
        'Diary',
        'Dream',
        'Idea',
        'Retrospective',
      ]);

      const junctionCount = db.prepare('SELECT COUNT(*) as c FROM journal_entry_tags').get() as {
        c: number;
      };
      expect(junctionCount.c).toBe(2);

      const dangling = db
        .prepare(
          `
          SELECT COUNT(*) as c FROM journal_entry_tags jet
          LEFT JOIN journal_entries je ON jet.entry_id = je.id
          LEFT JOIN tags t ON jet.tag_id = t.id
          WHERE je.id IS NULL OR t.id IS NULL
          `,
        )
        .get() as { c: number };
      expect(dangling.c).toBe(0);
    } finally {
      db.close();
    }
  });
});
