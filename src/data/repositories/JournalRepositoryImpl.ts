import { v4 as uuidv4 } from 'uuid';
import { JournalRepository } from '../../domain/repositories/JournalRepository';
import { JournalEntry, Tag, Location } from '../../domain/entities/JournalEntry';
import { Kysely } from 'kysely';
import { Database } from '../database/schema';
import { JournalEntriesTable, TagsTable } from '../database/schema';

/**
 * Concrete implementation of the JournalRepository backed by Kysely.
 *
 * The repository does not create or manage the database connection.
 * A fully initialized Kysely<Database> instance must be injected,
 * enabling easier testing and separation of concerns.
 */
export class JournalRepositoryImpl implements JournalRepository {
  private db: Kysely<Database>;

  /**
   * Create a repository using the provided database instance.
   *
   * The caller is responsible for running migrations and managing
   * the lifecycle of the database connection.
   *
   * @param db The initialized Kysely database instance to use.
   */
  constructor(db: Kysely<Database>) {
    this.db = db;
  }

  private mapDbEntryToDomain(
    dbEntry: JournalEntriesTable,
    tags: Tag[] = []
  ): JournalEntry {
    const location: Location | undefined = 
      dbEntry.location_latitude !== undefined && 
      dbEntry.location_longitude !== undefined && 
      dbEntry.location_elevation !== undefined
        ? {
            latitude: dbEntry.location_latitude,
            longitude: dbEntry.location_longitude,
            elevation: dbEntry.location_elevation,
            accuracy: dbEntry.location_accuracy,
            address: dbEntry.location_address,
          }
        : undefined;

    return {
      id: dbEntry.id,
      content: dbEntry.content,
      datetime: new Date(dbEntry.datetime),
      created_at: new Date(dbEntry.created_at),
      modified_at: new Date(dbEntry.modified_at),
      tags: tags.map(tag => tag.name),
      location,
    };
  }

  private mapDbTagToDomain(dbTag: TagsTable): Tag {
    return {
      id: dbTag.id,
      name: dbTag.name,
      created_at: new Date(dbTag.created_at),
    };
  }

  async createEntry(entry: Omit<JournalEntry, 'id' | 'created_at' | 'modified_at'>): Promise<JournalEntry> {
    const db = this.db;
    const now = new Date();
    const id = uuidv4();

    await db.transaction().execute(async (trx) => {
      // Create the entry
      await trx
        .insertInto('journal_entries')
        .values({
          id,
          content: entry.content,
          datetime: entry.datetime.toISOString(),
          created_at: now.toISOString(),
          modified_at: now.toISOString(),
          location_latitude: entry.location?.latitude,
          location_longitude: entry.location?.longitude,
          location_elevation: entry.location?.elevation,
          location_accuracy: entry.location?.accuracy,
          location_address: entry.location?.address,
        })
        .execute();

      // Handle tags
      for (const tagName of entry.tags) {
        const tag = await this.getOrCreateTag(tagName);
        await trx
          .insertInto('journal_entry_tags')
          .values({
            entry_id: id,
            tag_id: tag.id,
          })
          .execute();
      }
    });

    const createdEntry = await this.getEntry(id);
    if (!createdEntry) {
      throw new Error('Failed to create entry');
    }
    return createdEntry;
  }

  async updateEntry(id: string, updates: Partial<Omit<JournalEntry, 'id' | 'created_at'>>): Promise<JournalEntry> {
    const db = this.db;
    const now = new Date();

    await db.transaction().execute(async (trx) => {
      // Update the entry
      const updateData: Partial<JournalEntriesTable> = {
        modified_at: now.toISOString(),
      };

      if (updates.content !== undefined) {
        updateData.content = updates.content;
      }
      if (updates.datetime !== undefined) {
        updateData.datetime = updates.datetime.toISOString();
      }
      if (updates.location !== undefined) {
        if (updates.location === null) {
          updateData.location_latitude = undefined;
          updateData.location_longitude = undefined;
          updateData.location_elevation = undefined;
          updateData.location_accuracy = undefined;
          updateData.location_address = undefined;
        } else {
          updateData.location_latitude = updates.location.latitude;
          updateData.location_longitude = updates.location.longitude;
          updateData.location_elevation = updates.location.elevation;
          updateData.location_accuracy = updates.location.accuracy;
          updateData.location_address = updates.location.address;
        }
      }

      await trx
        .updateTable('journal_entries')
        .set(updateData)
        .where('id', '=', id)
        .execute();

      // Handle tags if provided
      if (updates.tags !== undefined) {
        // Remove existing tags
        await trx
          .deleteFrom('journal_entry_tags')
          .where('entry_id', '=', id)
          .execute();

        // Add new tags
        for (const tagName of updates.tags) {
          const tag = await this.getOrCreateTag(tagName);
          await trx
            .insertInto('journal_entry_tags')
            .values({
              entry_id: id,
              tag_id: tag.id,
            })
            .execute();
        }
      }
    });

    const updatedEntry = await this.getEntry(id);
    if (!updatedEntry) {
      throw new Error('Failed to update entry');
    }
    return updatedEntry;
  }

  async deleteEntry(id: string): Promise<void> {
    const db = this.db;
    await db
      .deleteFrom('journal_entries')
      .where('id', '=', id)
      .execute();
  }

  async getEntry(id: string): Promise<JournalEntry | null> {
    const db = this.db;
    
    const entry = await db
      .selectFrom('journal_entries')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!entry) {
      return null;
    }

    const tags = await this.getTagsForEntry(id);
    return this.mapDbEntryToDomain(entry, tags);
  }

  async getAllEntries(offset: number = 0, limit: number = 10): Promise<JournalEntry[]> {
    const db = this.db;
    
    const entries = await db
      .selectFrom('journal_entries')
      .selectAll()
      .orderBy('datetime', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    const entriesWithTags: JournalEntry[] = [];
    for (const entry of entries) {
      const tags = await this.getTagsForEntry(entry.id);
      entriesWithTags.push(this.mapDbEntryToDomain(entry, tags));
    }

    return entriesWithTags;
  }

  async searchEntries(query: string, offset: number = 0, limit: number = 10): Promise<JournalEntry[]> {
    const db = this.db;
    
    const entries = await db
      .selectFrom('journal_entries')
      .selectAll()
      .where('content', 'like', `%${query}%`)
      .orderBy('datetime', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    const entriesWithTags: JournalEntry[] = [];
    for (const entry of entries) {
      const tags = await this.getTagsForEntry(entry.id);
      entriesWithTags.push(this.mapDbEntryToDomain(entry, tags));
    }

    return entriesWithTags;
  }

  async getEntriesByTags(tagNames: string[], offset: number = 0, limit: number = 10): Promise<JournalEntry[]> {
    const db = this.db;
    
    const entries = await db
      .selectFrom('journal_entries')
      .innerJoin('journal_entry_tags', 'journal_entries.id', 'journal_entry_tags.entry_id')
      .innerJoin('tags', 'journal_entry_tags.tag_id', 'tags.id')
      .selectAll('journal_entries')
      .where('tags.name', 'in', tagNames)
      .groupBy('journal_entries.id')
      .orderBy('journal_entries.datetime', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    const entriesWithTags: JournalEntry[] = [];
    for (const entry of entries) {
      const tags = await this.getTagsForEntry(entry.id);
      entriesWithTags.push(this.mapDbEntryToDomain(entry, tags));
    }

    return entriesWithTags;
  }

  async getAllTags(): Promise<Tag[]> {
    const db = this.db;
    
    const tags = await db
      .selectFrom('tags')
      .selectAll()
      .orderBy('name', 'asc')
      .execute();

    return tags.map(tag => this.mapDbTagToDomain(tag));
  }

  async createTag(name: string): Promise<Tag> {
    const db = this.db;
    const now = new Date();
    const id = uuidv4();

    await db
      .insertInto('tags')
      .values({
        id,
        name,
        created_at: now.toISOString(),
      })
      .execute();

    return {
      id,
      name,
      created_at: now,
    };
  }

  async getOrCreateTag(name: string): Promise<Tag> {
    const db = this.db;
    
    const existingTag = await db
      .selectFrom('tags')
      .selectAll()
      .where('name', '=', name)
      .executeTakeFirst();

    if (existingTag) {
      return this.mapDbTagToDomain(existingTag);
    }

    return await this.createTag(name);
  }

  async deleteTag(id: string): Promise<void> {
    const db = this.db;
    await db
      .deleteFrom('tags')
      .where('id', '=', id)
      .execute();
  }

  async getTagsForEntry(entryId: string): Promise<Tag[]> {
    const db = this.db;
    
    const tags = await db
      .selectFrom('tags')
      .innerJoin('journal_entry_tags', 'tags.id', 'journal_entry_tags.tag_id')
      .selectAll('tags')
      .where('journal_entry_tags.entry_id', '=', entryId)
      .execute();

    return tags.map(tag => this.mapDbTagToDomain(tag));
  }
}
