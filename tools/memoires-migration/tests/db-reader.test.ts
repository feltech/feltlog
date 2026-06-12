import Database from 'better-sqlite3';
import { jest } from '@jest/globals';
import { readSourceDatabase } from '../src/db-reader.js';
import { mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('readSourceDatabase', () => {
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'memoires-test-'));
    dbPath = join(dir, 'test.db');
    db = new Database(dbPath);
    db.exec(`
      CREATE TABLE memo (
        _id INTEGER PRIMARY KEY,
        header TEXT,
        note TEXT NOT NULL,
        created INTEGER NOT NULL,
        modified INTEGER,
        tags TEXT,
        locality TEXT,
        address TEXT
      );
      CREATE TABLE tag (_id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
    `);
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it('reads memos and tags', () => {
    db.exec(`
      INSERT INTO memo (_id, header, note, created, modified, tags, locality)
        VALUES (1, 'H', 'Note', 1000, 2000, 'Diary', 'Town');
      INSERT INTO tag (_id, name) VALUES (1, 'Diary');
    `);

    const result = readSourceDatabase(dbPath);
    expect(result.memos).toHaveLength(1);
    expect(result.memos[0]._id).toBe(1);
    expect(result.tags).toHaveLength(1);
    expect(result.tagEarliestCreated.get('Diary')).toBe(1000);
  });

  it('computes earliest created per tag across multiple memos', () => {
    db.exec(`
      INSERT INTO memo (_id, note, created, tags) VALUES (1, 'A', 5000, 'Diary');
      INSERT INTO memo (_id, note, created, tags) VALUES (2, 'B', 3000, 'Diary');
      INSERT INTO memo (_id, note, created, tags) VALUES (3, 'C', 4000, 'Idea');
    `);

    const result = readSourceDatabase(dbPath);
    expect(result.tagEarliestCreated.get('Diary')).toBe(3000);
    expect(result.tagEarliestCreated.get('Idea')).toBe(4000);
  });

  it('ignores empty tags when computing earliest created', () => {
    db.exec(`
      INSERT INTO memo (_id, note, created, tags) VALUES (1, 'A', 1000, '');
      INSERT INTO memo (_id, note, created, tags) VALUES (2, 'B', 2000, NULL);
    `);

    const result = readSourceDatabase(dbPath);
    expect(result.tagEarliestCreated.size).toBe(0);
  });

  it('throws on missing database path', () => {
    expect(() => readSourceDatabase('/nonexistent/path.db')).toThrow(
      'Failed to open source database',
    );
  });

  it('throws with generic error when the thrown error is not an Error instance', async () => {
    // We cannot easily make better-sqlite3 throw a non-Error, so we test the
    // branch by mocking the Database constructor.
    jest.unstable_mockModule('better-sqlite3', () => ({
      default: jest.fn(() => {
        throw 'string-error';
      }),
    }));

    const { readSourceDatabase: read } = await import('../src/db-reader.js');
    expect(() => read('/some/path.db')).toThrow('Failed to open source database');

    jest.unstable_mockModule('better-sqlite3', () => ({
      default: Database,
    }));
  });
});
