import { JournalEntry, Tag } from '../entities/JournalEntry';

export interface JournalRepository {
  // Journal Entry operations
  createEntry(entry: Omit<JournalEntry, 'id' | 'created_at' | 'modified_at'>): Promise<JournalEntry>;
  updateEntry(id: string, updates: Partial<Omit<JournalEntry, 'id' | 'created_at'>>): Promise<JournalEntry>;
  deleteEntry(id: string): Promise<void>;
  getEntry(id: string): Promise<JournalEntry | null>;
  getAllEntries(offset?: number, limit?: number): Promise<JournalEntry[]>;
  searchEntries(query: string, offset?: number, limit?: number): Promise<JournalEntry[]>;
  getEntriesByTags(tagNames: string[], offset?: number, limit?: number): Promise<JournalEntry[]>;

  // Tag operations
  getAllTags(): Promise<Tag[]>;
  createTag(name: string): Promise<Tag>;
  getOrCreateTag(name: string): Promise<Tag>;
  deleteTag(id: string): Promise<void>;
  getTagsForEntry(entryId: string): Promise<Tag[]>;
}