import { JournalRepositoryImpl } from '../JournalRepositoryImpl';
import { up } from '../../database/migrations';
import {closeSqlite, openKysely} from "@/src/data/database/database";

describe('JournalRepositoryImpl', () => {
  let repository: JournalRepositoryImpl;

  let sqliteDb: any;

  beforeEach(async () => {
    const testDbName = `test_${Date.now()}_${Math.random()}.db`;
    const result = await openKysely(undefined, testDbName);
    await up(result.db);
    sqliteDb = result.sqliteDb;
    repository = new JournalRepositoryImpl(result.db);
  });

  afterEach(async () => {
    if (sqliteDb) {
      await closeSqlite(sqliteDb);
      sqliteDb = null;
    }
  });

  describe('Entry Management', () => {
    it('should create a new journal entry', async () => {
      const entryData = {
        content: 'Test entry content',
        datetime: new Date('2024-01-01T10:00:00Z'),
        tags: ['test', 'journal'],
      };

      const entry = await repository.createEntry(entryData);

      expect(entry).toBeDefined();
      expect(entry.id).toBeDefined();
      expect(entry.content).toBe(entryData.content);
      expect(entry.datetime).toEqual(entryData.datetime);
      expect(entry.tags.sort()).toEqual(entryData.tags.sort());
      expect(entry.created_at).toBeDefined();
      expect(entry.modified_at).toBeDefined();
    });

    it('should create entry with location', async () => {
      const entryData = {
        content: 'Test entry with location',
        datetime: new Date('2024-01-01T10:00:00Z'),
        tags: [],
        location: {
          latitude: 40.7128,
          longitude: -74.0060,
          elevation: 10,
          accuracy: 5,
          address: 'New York, NY',
        },
      };

      const entry = await repository.createEntry(entryData);

      expect(entry.location).toBeDefined();
      expect(entry.location?.latitude).toBe(40.7128);
      expect(entry.location?.longitude).toBe(-74.0060);
      expect(entry.location?.elevation).toBe(10);
      expect(entry.location?.accuracy).toBe(5);
      expect(entry.location?.address).toBe('New York, NY');
    });

    it('should retrieve an entry by id', async () => {
      const entryData = {
        content: 'Test entry content',
        datetime: new Date('2024-01-01T10:00:00Z'),
        tags: ['test'],
      };

      const createdEntry = await repository.createEntry(entryData);
      const retrievedEntry = await repository.getEntry(createdEntry.id);

      expect(retrievedEntry).toBeDefined();
      expect(retrievedEntry?.id).toBe(createdEntry.id);
      expect(retrievedEntry?.content).toBe(entryData.content);
    });

    it('should return null for non-existent entry', async () => {
      const entry = await repository.getEntry('non-existent-id');
      expect(entry).toBeNull();
    });

    it('should update an entry', async () => {
      const entryData = {
        content: 'Original content',
        datetime: new Date('2024-01-01T10:00:00Z'),
        tags: ['original'],
      };

      const createdEntry = await repository.createEntry(entryData);
      
      const updates = {
        content: 'Updated content',
        tags: ['updated', 'modified'],
      };

      const updatedEntry = await repository.updateEntry(createdEntry.id, updates);

      expect(updatedEntry.content).toBe(updates.content);
      expect(updatedEntry.tags.sort()).toEqual(updates.tags.sort());
      expect(updatedEntry.modified_at.getTime()).toBeGreaterThan(updatedEntry.created_at.getTime());
    });

    it('should delete an entry', async () => {
      const entryData = {
        content: 'Test entry content',
        datetime: new Date('2024-01-01T10:00:00Z'),
        tags: [],
      };

      const createdEntry = await repository.createEntry(entryData);
      await repository.deleteEntry(createdEntry.id);

      const retrievedEntry = await repository.getEntry(createdEntry.id);
      expect(retrievedEntry).toBeNull();
    });

    it('should get all entries', async () => {
      const entries = [
        {
          content: 'First entry',
          datetime: new Date('2024-01-01T10:00:00Z'),
          tags: [],
        },
        {
          content: 'Second entry',
          datetime: new Date('2024-01-02T10:00:00Z'),
          tags: [],
        },
      ];

      for (const entryData of entries) {
        await repository.createEntry(entryData);
      }

      const retrievedEntries = await repository.getAllEntries();

      expect(retrievedEntries).toHaveLength(2);
      // Should be ordered by datetime desc
      expect(retrievedEntries[0].content).toBe('Second entry');
      expect(retrievedEntries[1].content).toBe('First entry');
    });
  });

  describe('Tag Management', () => {
    it('should create and retrieve tags', async () => {
      const entryData = {
        content: 'Test entry',
        datetime: new Date(),
        tags: ['personal', 'work', 'important'],
      };

      await repository.createEntry(entryData);
      const tags = await repository.getAllTags();

      expect(tags).toHaveLength(3);
      expect(tags.map(t => t.name).sort()).toEqual(['important', 'personal', 'work']);
    });

    it('should not create duplicate tags', async () => {
      const entryData1 = {
        content: 'First entry',
        datetime: new Date(),
        tags: ['shared', 'unique1'],
      };

      const entryData2 = {
        content: 'Second entry',
        datetime: new Date(),
        tags: ['shared', 'unique2'],
      };

      await repository.createEntry(entryData1);
      await repository.createEntry(entryData2);

      const tags = await repository.getAllTags();
      expect(tags).toHaveLength(3);
      expect(tags.map(t => t.name).sort()).toEqual(['shared', 'unique1', 'unique2']);
    });

    it('should search entries by content', async () => {
      const entries = [
        {
          content: 'This is about work and productivity',
          datetime: new Date('2024-01-01T10:00:00Z'),
          tags: ['work'],
        },
        {
          content: 'Personal thoughts and reflections',
          datetime: new Date('2024-01-02T10:00:00Z'),
          tags: ['personal'],
        },
        {
          content: 'Work meeting notes',
          datetime: new Date('2024-01-03T10:00:00Z'),
          tags: ['work', 'meeting'],
        },
      ];

      for (const entryData of entries) {
        await repository.createEntry(entryData);
      }

      const workEntries = await repository.searchEntries('work');
      expect(workEntries).toHaveLength(2);

      const personalEntries = await repository.searchEntries('personal');
      expect(personalEntries).toHaveLength(1);

      const reflectionEntries = await repository.searchEntries('reflections');
      expect(reflectionEntries).toHaveLength(1);
    });

    it('should filter entries by tags', async () => {
      const entries = [
        {
          content: 'Work entry',
          datetime: new Date('2024-01-01T10:00:00Z'),
          tags: ['work', 'important'],
        },
        {
          content: 'Personal entry',
          datetime: new Date('2024-01-02T10:00:00Z'),
          tags: ['personal'],
        },
        {
          content: 'Important personal entry',
          datetime: new Date('2024-01-03T10:00:00Z'),
          tags: ['personal', 'important'],
        },
      ];

      for (const entryData of entries) {
        await repository.createEntry(entryData);
      }

      const workEntries = await repository.getEntriesByTags(['work']);
      expect(workEntries).toHaveLength(1);

      const importantEntries = await repository.getEntriesByTags(['important']);
      expect(importantEntries).toHaveLength(2);

      const personalEntries = await repository.getEntriesByTags(['personal']);
      expect(personalEntries).toHaveLength(2);
    });
  });
});
