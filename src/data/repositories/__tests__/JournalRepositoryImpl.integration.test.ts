import { up } from '@/src/data/database/migrations';
import { JournalRepositoryImpl } from '@/src/data/repositories/JournalRepositoryImpl';
import {closeSqlite, openKysely} from "@/src/data/database/database";

/**
 * Integration tests against the repository using the expo-sqlite-mock shim.
 * Validates that entries can be created and fetched, and that location is
 * undefined when not provided (ensuring nulls from SQLite don't produce a
 * partially-null location object).
 */

describe('JournalRepositoryImpl integration (sqlite mock)', () => {
  it('creates and retrieves an entry without location (location remains undefined)', async () => {
    const { db, sqliteDb } = await openKysely(undefined, `jest_${Date.now()}.db`);
    try {
      await up(db);
      const repo = new JournalRepositoryImpl(db);

      const created = await repo.createEntry({
        content: 'Hello world',
        datetime: new Date('2024-05-01T12:00:00Z'),
        tags: [],
      });

      expect(created.id).toBeTruthy();
      expect(created.content).toBe('Hello world');
      expect(created.location).toBeUndefined();

      const all = await repo.getAllEntries(0, 10);
      expect(all.length).toBe(1);
      expect(all[0].content).toBe('Hello world');
      expect(all[0].location).toBeUndefined();

      const fetched = await repo.getEntry(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.content).toBe('Hello world');
      expect(fetched!.location).toBeUndefined();
    } finally {
      await closeSqlite(sqliteDb);
    }
  });
});
