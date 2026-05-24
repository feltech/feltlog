/**
 * Interface for journal repository.
 *
 * Provides methods for managing journal entries and tags.
 */
export interface JournalRepository {
  /**
   * Create a new journal entry.
   *
   * @param entry - The entry data to create.
   *
   * @returns The created journal entry with generated id and timestamps.
   */
  createEntry(entry: Omit): Promise;

  /**
   * Update an existing journal entry.
   *
   * @param id - The unique identifier of the entry to update.
   * @param updates - The fields to update.
   *
   * @returns The updated journal entry.
   */
  updateEntry(id: string, updates: Partial): Promise;

  /**
   * Delete a journal entry.
   *
   * @param id - The unique identifier of the entry to delete.
   *
   * @returns A promise that resolves when the entry is deleted.
   */
  deleteEntry(id: string): Promise;

  /**
   * Retrieve a single journal entry by its ID.
   *
   * @param id - The unique identifier of the entry to retrieve.
   *
   * @returns The journal entry if found, otherwise null.
   */
  getEntry(id: string): Promise;

  /**
   * Retrieve a paginated list of all journal entries.
   *
   * @param offset - The number of entries to skip.
   * @param limit - The maximum number of entries to return.
   *
   * @returns A list of journal entries.
   */
  getAllEntries(offset?: number, limit?: number): Promise;

  /**
   * Search for journal entries matching a query string.
   *
   * @param query - The search term to match against entry content.
   * @param offset - The number of entries to skip.
   * @param limit - The maximum number of entries to return.
   *
   * @returns A list of matching journal entries.
   */
  searchEntries(query: string, offset?: number, limit?: number): Promise;

  /**
   * Retrieve journal entries that have all specified tags.
   *
   * @param tagNames - The names of the tags to filter by.
   * @param offset - The number of entries to skip.
   * @param limit - The maximum number of entries to return.
   *
   * @returns A list of matching journal entries.
   */
  getEntriesByTags(tagNames: string[], offset?: number, limit?: number): Promise;

  /**
   * Retrieve all unique tags used in the system.
   *
   * @returns A list of all tags.
   */
  getAllTags(): Promise;

  /**
   * Create a new tag.
   *
   * @param name - The name of the tag to create.
   *
   * @returns The created tag.
   */
  createTag(name: string): Promise;

  /**
   * Retrieve an existing tag by name or create it if it doesn't exist.
   *
   * @param name - The name of the tag.
   *
   * @returns The existing or newly created tag.
   */
  getOrCreateTag(name: string): Promise;

  /**
   * Delete a tag.
   *
   * @param id - The unique identifier of the tag to delete.
   *
   * @returns A promise that resolves when the tag is deleted.
   */
  deleteTag(id: string): Promise;

  /**
   * Retrieve all tags associated with a specific journal entry.
   *
   * @param entryId - The unique identifier of the journal entry.
   *
   * @returns A list of tags for the entry.
   */
  getTagsForEntry(entryId: string): Promise;
}
