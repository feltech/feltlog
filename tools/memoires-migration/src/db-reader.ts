import Database from 'better-sqlite3';
import { MemoRow, SourceTagRow } from './types.js';

/**
 * Open the source memoires SQLite database in read-only mode and read all rows from the
 * `memo` and `tag` tables.
 *
 * @param dbPath - Absolute path to the source SQLite file.
 *
 * @returns An object containing all memo rows, all tag rows, and a map from tag name to
 *   the earliest `created` timestamp of any memo that uses it.
 */
export function readSourceDatabase(dbPath: string): {
  memos: MemoRow[];
  tags: SourceTagRow[];
  tagEarliestCreated: Map<string, number>;
} {
  let db: Database.Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (err) {
    throw new Error(
      `Failed to open source database at ${dbPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  try {
    const memoStmt = db.prepare(`
      SELECT _id, header, note, created, modified, tags, locality, address
      FROM memo
      ORDER BY created ASC
    `);
    const memos = memoStmt.all() as MemoRow[];

    const tagStmt = db.prepare('SELECT _id, name FROM tag ORDER BY _id ASC');
    const tags = tagStmt.all() as SourceTagRow[];

    // Compute the earliest `created` per tag name for tag created_at fallback.
    const tagEarliestCreated = new Map<string, number>();
    for (const memo of memos) {
      if (memo.tags !== null && memo.tags.trim().length > 0) {
        const existing = tagEarliestCreated.get(memo.tags);
        if (existing === undefined || memo.created < existing) {
          tagEarliestCreated.set(memo.tags, memo.created);
        }
      }
    }

    return { memos, tags, tagEarliestCreated };
  } finally {
    db.close();
  }
}
