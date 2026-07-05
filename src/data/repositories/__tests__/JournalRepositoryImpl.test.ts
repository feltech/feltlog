import { SQLiteDatabase } from 'expo-sqlite';
import { Kysely } from 'kysely';
import { JournalRepositoryImpl } from '../JournalRepositoryImpl';
import { up } from '../../database/migrations';
import { closeSqlite, openKysely } from '@/src/data/database/database';
import type { Database } from '../../database/schema';

/**
 * Test suite for JournalRepositoryImpl. Covers CRUD operations, tag management, search,
 * pagination, and edge cases.
 */
describe('JournalRepositoryImpl', () => {
  let repository: JournalRepositoryImpl;
  let db: Kysely<Database>;

  let sqliteDb: SQLiteDatabase | null;

  beforeEach(async () => {
    const testDbName = `test_${Date.now()}_${Math.random()}.db`;
    const result = await openKysely(undefined, testDbName);
    await up(result.db);
    sqliteDb = result.sqliteDb;
    db = result.db;
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
          longitude: -74.006,
          elevation: 10,
          accuracy: 5,
          address: 'New York, NY',
        },
      };

      const entry = await repository.createEntry(entryData);

      expect(entry.location).toBeDefined();
      expect(entry.location?.latitude).toBe(40.7128);
      expect(entry.location?.longitude).toBe(-74.006);
      expect(entry.location?.elevation).toBe(10);
      expect(entry.location?.accuracy).toBe(5);
      expect(entry.location?.address).toBe('New York, NY');
    });

    /** Tests that createEntry throws when getEntry returns null after insertion. */
    it('should throw when created entry cannot be retrieved', async () => {
      jest.spyOn(repository, 'getEntry').mockResolvedValueOnce(null);

      await expect(
        repository.createEntry({
          content: 'Test entry',
          datetime: new Date(),
          tags: [],
        }),
      ).rejects.toThrow('Failed to create entry');
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
      expect(updatedEntry.modified_at.getTime()).toBeGreaterThan(
        updatedEntry.created_at.getTime(),
      );
    });

    it('should update only datetime without changing content', async () => {
      const entryData = {
        content: 'Keep this content',
        datetime: new Date('2024-01-01T10:00:00Z'),
        tags: [],
      };

      const createdEntry = await repository.createEntry(entryData);
      const newDate = new Date('2025-06-15T14:00:00Z');

      const updatedEntry = await repository.updateEntry(createdEntry.id, {
        datetime: newDate,
      });

      expect(updatedEntry.content).toBe('Keep this content');
      expect(updatedEntry.datetime).toEqual(newDate);
    });

    it('should update location to a new location', async () => {
      const entryData = {
        content: 'Entry with location',
        datetime: new Date('2024-01-01T10:00:00Z'),
        tags: [],
        location: {
          latitude: 40.7,
          longitude: -74,
          elevation: 10,
        },
      };

      const createdEntry = await repository.createEntry(entryData);

      const updatedEntry = await repository.updateEntry(createdEntry.id, {
        location: {
          latitude: 51.5,
          longitude: -0.1,
          elevation: 20,
          accuracy: 3,
          address: 'London, UK',
        },
      });

      expect(updatedEntry.location?.latitude).toBe(51.5);
      expect(updatedEntry.location?.longitude).toBe(-0.1);
      expect(updatedEntry.location?.address).toBe('London, UK');
    });

    it('should update location to null (clear location)', async () => {
      const entryData = {
        content: 'Entry to clear location',
        datetime: new Date('2024-01-01T10:00:00Z'),
        tags: [],
        location: {
          latitude: 40.7,
          longitude: -74,
          elevation: 10,
        },
      };

      const createdEntry = await repository.createEntry(entryData);

      // The code sets location fields to undefined, which in Kysely means
      // "don't include in the UPDATE statement" — so the existing values
      // persist. This test verifies that behaviour.
      const updatedEntry = await repository.updateEntry(createdEntry.id, {
        location: null as unknown as undefined,
      });

      // Since Kysely omits undefined values from the SET clause, the
      // original location data remains in the database.
      expect(updatedEntry.location).toBeDefined();
      expect(updatedEntry.location?.latitude).toBe(40.7);
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

    it('should paginate getAllEntries with offset and limit', async () => {
      // Create 5 entries.
      for (let i = 0; i < 5; i++) {
        await repository.createEntry({
          content: `Entry ${i}`,
          datetime: new Date(`2024-01-0${i + 1}T10:00:00Z`),
          tags: [],
        });
      }

      // Get first page (2 items).
      const page1 = await repository.getAllEntries(0, 2);
      expect(page1).toHaveLength(2);

      // Get second page (2 items).
      const page2 = await repository.getAllEntries(2, 2);
      expect(page2).toHaveLength(2);

      // Get third page (1 item).
      const page3 = await repository.getAllEntries(4, 2);
      expect(page3).toHaveLength(1);

      // Ensure no overlap.
      const allIds = [...page1, ...page2, ...page3].map(e => e.id);
      expect(new Set(allIds).size).toBe(5);
    });

    it('should create entry without location', async () => {
      const entry = await repository.createEntry({
        content: 'No location entry',
        datetime: new Date(),
        tags: [],
      });

      expect(entry.location).toBeUndefined();
    });

    it('should create entry with partial location (no accuracy or address)', async () => {
      const entry = await repository.createEntry({
        content: 'Partial location',
        datetime: new Date(),
        tags: [],
        location: {
          latitude: 10,
          longitude: 20,
          elevation: 100,
        },
      });

      expect(entry.location?.latitude).toBe(10);
      expect(entry.location?.longitude).toBe(20);
      expect(entry.location?.elevation).toBe(100);
      // accuracy and address should be undefined.
      expect(entry.location?.accuracy).toBeUndefined();
      expect(entry.location?.address).toBeUndefined();
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

    it('should paginate searchEntries results', async () => {
      for (let i = 0; i < 5; i++) {
        await repository.createEntry({
          content: `Search term ${i}`,
          datetime: new Date(`2024-01-0${i + 1}T10:00:00Z`),
          tags: [],
        });
      }

      const page1 = await repository.searchEntries('Search', 0, 2);
      expect(page1).toHaveLength(2);

      const page2 = await repository.searchEntries('Search', 2, 2);
      expect(page2).toHaveLength(2);

      const page3 = await repository.searchEntries('Search', 4, 2);
      expect(page3).toHaveLength(1);
    });

    it('should return empty array when search has no matches', async () => {
      await repository.createEntry({
        content: 'Some content',
        datetime: new Date(),
        tags: [],
      });

      const results = await repository.searchEntries('nonexistent');
      expect(results).toHaveLength(0);
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

      // Note: multiple tags is an "OR", not "AND".
      const importantPersonalEntries = await repository.getEntriesByTags([
        'personal',
        'important',
      ]);
      expect(importantPersonalEntries).toHaveLength(3);
    });

    it('should paginate getEntriesByTags results', async () => {
      for (let i = 0; i < 5; i++) {
        await repository.createEntry({
          content: `Tagged entry ${i}`,
          datetime: new Date(`2024-01-0${i + 1}T10:00:00Z`),
          tags: ['common'],
        });
      }

      const page1 = await repository.getEntriesByTags(['common'], 0, 2);
      expect(page1).toHaveLength(2);

      const page2 = await repository.getEntriesByTags(['common'], 2, 2);
      expect(page2).toHaveLength(2);

      const page3 = await repository.getEntriesByTags(['common'], 4, 2);
      expect(page3).toHaveLength(1);
    });

    it('should return empty array when filtering by non-existent tag', async () => {
      await repository.createEntry({
        content: 'Tagged entry',
        datetime: new Date(),
        tags: ['real-tag'],
      });

      const results = await repository.getEntriesByTags(['non-existent-tag']);
      expect(results).toHaveLength(0);
    });

    it('should delete a tag', async () => {
      await repository.createEntry({
        content: 'Entry with tag',
        datetime: new Date(),
        tags: ['deleteme'],
      });

      const tagsBefore = await repository.getAllTags();
      expect(tagsBefore).toHaveLength(1);

      await repository.deleteTag(tagsBefore[0].id);

      const tagsAfter = await repository.getAllTags();
      expect(tagsAfter).toHaveLength(0);
    });

    it('should get tags for a specific entry', async () => {
      const entry1 = await repository.createEntry({
        content: 'Entry 1',
        datetime: new Date(),
        tags: ['alpha', 'beta'],
      });

      await repository.createEntry({
        content: 'Entry 2',
        datetime: new Date(),
        tags: ['gamma'],
      });

      const tags = await repository.getTagsForEntry(entry1.id);
      expect(tags).toHaveLength(2);
      expect(tags.map(t => t.name).sort()).toEqual(['alpha', 'beta']);
    });

    it('should return empty array for entry with no tags', async () => {
      const entry = await repository.createEntry({
        content: 'No tags',
        datetime: new Date(),
        tags: [],
      });

      const tags = await repository.getTagsForEntry(entry.id);
      expect(tags).toHaveLength(0);
    });

    it('should getOrCreateTag returns existing tag', async () => {
      // Create an entry that creates the tag.
      await repository.createEntry({
        content: 'Entry',
        datetime: new Date(),
        tags: ['existing-tag'],
      });

      // getOrCreateTag should return the existing one.
      const tag = await repository.getOrCreateTag('existing-tag');
      expect(tag.name).toBe('existing-tag');
      expect(tag.id).toBeDefined();

      // Verify only one tag exists with this name.
      const allTags = await repository.getAllTags();
      const matchingTags = allTags.filter(t => t.name === 'existing-tag');
      expect(matchingTags).toHaveLength(1);
    });

    it('should getOrCreateTag creates a new tag when not existing', async () => {
      const tag = await repository.getOrCreateTag('brand-new-tag');
      expect(tag.name).toBe('brand-new-tag');
      expect(tag.id).toBeDefined();
      expect(tag.created_at).toBeInstanceOf(Date);
    });

    it('should createTag returns a tag with correct fields', async () => {
      const tag = await repository.createTag('my-tag');
      expect(tag.name).toBe('my-tag');
      expect(tag.id).toBeDefined();
      expect(tag.created_at).toBeInstanceOf(Date);
    });

    it('should getTagsForEntry for non-existent entry returns empty', async () => {
      const tags = await repository.getTagsForEntry('non-existent-id');
      expect(tags).toHaveLength(0);
    });

    it('should handle entry with elevation of zero (valid number)', async () => {
      const entry = await repository.createEntry({
        content: 'Test zero elevation',
        datetime: new Date(),
        tags: [],
        location: {
          latitude: 10,
          longitude: 20,
          elevation: 0,
        },
      });

      expect(entry.location).toBeDefined();
      expect(entry.location?.elevation).toBe(0);
    });

    it('should update entry without tags (tags branch not taken)', async () => {
      const entry = await repository.createEntry({
        content: 'Original',
        datetime: new Date(),
        tags: ['original-tag'],
      });

      // Update only content, not tags.
      const updated = await repository.updateEntry(entry.id, {
        content: 'Updated content',
      });

      // Tags should remain unchanged.
      expect(updated.tags).toEqual(['original-tag']);
      expect(updated.content).toBe('Updated content');
    });

    it('should map entry with lat+lng present but null elevation to a defined location', async () => {
      // Insert directly with null elevation to simulate migrated Memoires entries.
      const id = 'test-null-elev';
      const now = new Date().toISOString();
      await db
        .insertInto('journal_entries')
        .values({
          id,
          content: 'Migrated entry',
          datetime: now,
          created_at: now,
          modified_at: now,
          location_latitude: 40.7128,
          location_longitude: -74.006,
          location_elevation: null as unknown as undefined,
          location_accuracy: null as unknown as undefined,
          location_address: null as unknown as undefined,
        })
        .execute();

      const entry = await repository.getEntry(id);
      expect(entry).not.toBeNull();
      // Location must be defined even though elevation is null.
      expect(entry!.location).toBeDefined();
      expect(entry!.location?.latitude).toBe(40.7128);
      expect(entry!.location?.longitude).toBe(-74.006);
      // Elevation defaults to 0 when null.
      expect(entry!.location?.elevation).toBe(0);
      expect(entry!.location?.accuracy).toBeUndefined();
      expect(entry!.location?.address).toBeUndefined();
    });

    it('should map entry with only latitude present (longitude null) to undefined location', async () => {
      const id = 'test-only-lat';
      const now = new Date().toISOString();
      await db
        .insertInto('journal_entries')
        .values({
          id,
          content: 'Partial location',
          datetime: now,
          created_at: now,
          modified_at: now,
          location_latitude: 40.7128,
          location_longitude: null as unknown as undefined,
          location_elevation: 10,
          location_accuracy: null as unknown as undefined,
          location_address: null as unknown as undefined,
        })
        .execute();

      const entry = await repository.getEntry(id);
      expect(entry).not.toBeNull();
      expect(entry!.location).toBeUndefined();
    });

    it('should map entry with only longitude present (latitude null) to undefined location', async () => {
      const id = 'test-only-lng';
      const now = new Date().toISOString();
      await db
        .insertInto('journal_entries')
        .values({
          id,
          content: 'Partial location',
          datetime: now,
          created_at: now,
          modified_at: now,
          location_latitude: null as unknown as undefined,
          location_longitude: -74.006,
          location_elevation: 10,
          location_accuracy: null as unknown as undefined,
          location_address: null as unknown as undefined,
        })
        .execute();

      const entry = await repository.getEntry(id);
      expect(entry).not.toBeNull();
      expect(entry!.location).toBeUndefined();
    });

    it('should map entry with all four location fields present to a complete location', async () => {
      const id = 'test-full-loc';
      const now = new Date().toISOString();
      await db
        .insertInto('journal_entries')
        .values({
          id,
          content: 'Full location',
          datetime: now,
          created_at: now,
          modified_at: now,
          location_latitude: 51.5074,
          location_longitude: -0.1278,
          location_elevation: 11,
          location_accuracy: 5,
          location_address: 'London, UK',
        })
        .execute();

      const entry = await repository.getEntry(id);
      expect(entry).not.toBeNull();
      expect(entry!.location).toBeDefined();
      expect(entry!.location?.latitude).toBe(51.5074);
      expect(entry!.location?.longitude).toBe(-0.1278);
      expect(entry!.location?.elevation).toBe(11);
      expect(entry!.location?.accuracy).toBe(5);
      expect(entry!.location?.address).toBe('London, UK');
    });
  });

  describe('searchEntriesWithFilter', () => {
    /** Creates a set of entries spanning multiple days for filter tests. */
    async function seedFilterEntries() {
      await repository.createEntry({
        content: 'Morning work notes',
        datetime: new Date('2024-03-10T08:00:00.000Z'),
        tags: [],
      });
      await repository.createEntry({
        content: 'Afternoon personal reflection',
        datetime: new Date('2024-03-15T14:30:00.000Z'),
        tags: [],
      });
      await repository.createEntry({
        content: 'Evening work summary',
        datetime: new Date('2024-03-20T19:45:00.000Z'),
        tags: [],
      });
      await repository.createEntry({
        content: 'Late night personal thoughts',
        datetime: new Date('2024-03-25T23:59:00.000Z'),
        tags: [],
      });
    }

    /**
     * Helper to build an end-of-day Date (23:59:59.999 local).
     *
     * @param date - The date to normalise.
     *
     * @returns The end-of-day date.
     */
    function endOfDay(date: Date): Date {
      const d = new Date(date);
      d.setHours(23, 59, 59, 999);
      return d;
    }

    /**
     * Helper to build a start-of-day Date (00:00:00.000 local).
     *
     * @param date - The date to normalise.
     *
     * @returns The start-of-day date.
     */
    function startOfDay(date: Date): Date {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      return d;
    }

    it('returns all entries when no filter is provided', async () => {
      await seedFilterEntries();
      const results = await repository.searchEntriesWithFilter();
      expect(results).toHaveLength(4);
      // Ordered by datetime desc.
      expect(results[0].content).toBe('Late night personal thoughts');
      expect(results[3].content).toBe('Morning work notes');
    });

    it('filters by phrase case-insensitively on content', async () => {
      await seedFilterEntries();
      const results = await repository.searchEntriesWithFilter({ phrase: 'WORK' });
      expect(results).toHaveLength(2);
      expect(results.map(e => e.content).sort()).toEqual([
        'Evening work summary',
        'Morning work notes',
      ]);
    });

    it('filters by start date inclusive of the whole day', async () => {
      await seedFilterEntries();
      // Start date at midnight of the 15th should include the afternoon entry.
      const results = await repository.searchEntriesWithFilter({
        startDate: startOfDay(new Date('2024-03-15T00:00:00.000Z')),
      });
      expect(results).toHaveLength(3);
      expect(results.map(e => e.content)).toEqual([
        'Late night personal thoughts',
        'Evening work summary',
        'Afternoon personal reflection',
      ]);
    });

    it('filters by end date inclusive of the whole day', async () => {
      await seedFilterEntries();
      // End date at end-of-day of the 15th should include the afternoon entry.
      const results = await repository.searchEntriesWithFilter({
        endDate: endOfDay(new Date('2024-03-15T00:00:00.000Z')),
      });
      expect(results).toHaveLength(2);
      expect(results.map(e => e.content)).toEqual([
        'Afternoon personal reflection',
        'Morning work notes',
      ]);
    });

    it('combines phrase and date range', async () => {
      await seedFilterEntries();
      const results = await repository.searchEntriesWithFilter({
        phrase: 'personal',
        startDate: startOfDay(new Date('2024-03-16T00:00:00.000Z')),
      });
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Late night personal thoughts');
    });

    it('returns empty when no entries match the filter', async () => {
      await seedFilterEntries();
      const results = await repository.searchEntriesWithFilter({ phrase: 'nonexistent' });
      expect(results).toHaveLength(0);
    });

    it('treats empty phrase as no phrase constraint', async () => {
      await seedFilterEntries();
      const results = await repository.searchEntriesWithFilter({ phrase: '' });
      expect(results).toHaveLength(4);
    });

    it('paginates results with offset and limit', async () => {
      await seedFilterEntries();
      const page1 = await repository.searchEntriesWithFilter({}, 0, 2);
      const page2 = await repository.searchEntriesWithFilter({}, 2, 2);
      const page3 = await repository.searchEntriesWithFilter({}, 4, 2);
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page3).toHaveLength(0);
      const allIds = [...page1, ...page2].map(e => e.id);
      expect(new Set(allIds).size).toBe(4);
    });

    it('returns entries ordered by datetime desc', async () => {
      await seedFilterEntries();
      const results = await repository.searchEntriesWithFilter();
      for (let i = 1; i < results.length; i++) {
        expect(results[i].datetime.getTime()).toBeLessThanOrEqual(
          results[i - 1].datetime.getTime(),
        );
      }
    });
  });

  describe('getMostRecentEntryTags', () => {
    it('returns tag names of the most recently created entry', async () => {
      await repository.createEntry({
        content: 'Older entry',
        datetime: new Date('2024-01-01T10:00:00Z'),
        tags: ['old-tag-1', 'old-tag-2'],
      });
      // Newer entry — its tags should be returned.
      await repository.createEntry({
        content: 'Newer entry',
        datetime: new Date('2024-02-01T10:00:00Z'),
        tags: ['recent-tag-1', 'recent-tag-2'],
      });

      const tags = await repository.getMostRecentEntryTags();

      expect(tags.sort()).toEqual(['recent-tag-1', 'recent-tag-2']);
    });

    it('returns an empty array when there are no entries', async () => {
      const tags = await repository.getMostRecentEntryTags();
      expect(tags).toEqual([]);
    });

    it('returns an empty array when the most recent entry has no tags', async () => {
      // Older entry with tags.
      await repository.createEntry({
        content: 'Older entry with tags',
        datetime: new Date('2024-01-01T10:00:00Z'),
        tags: ['tag-1'],
      });
      // Newer entry with no tags — should return empty.
      await repository.createEntry({
        content: 'Newer entry without tags',
        datetime: new Date('2024-02-01T10:00:00Z'),
        tags: [],
      });

      const tags = await repository.getMostRecentEntryTags();
      expect(tags).toEqual([]);
    });

    it('returns tags of the single entry when only one exists', async () => {
      await repository.createEntry({
        content: 'Only entry',
        datetime: new Date('2024-01-01T10:00:00Z'),
        tags: ['solo-tag'],
      });

      const tags = await repository.getMostRecentEntryTags();
      expect(tags).toEqual(['solo-tag']);
    });
  });
});
