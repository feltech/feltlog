import {useState, useEffect, useCallback, useRef} from 'react';
import {JournalEntry, Tag} from '../../domain/entities/JournalEntry';
import {JournalRepository} from '../../domain/repositories/JournalRepository';
import { useRepository } from '@/src/domain/repositories/RepositoryContext';

/**
 * Represents the state of a journal view model.
 */
export interface JournalViewModelState {
  /**
   * An array of journal entries, representing the main content of the
   * journal.
   *
   * This is just the visible set of journal entries - more may be
   * fetched according to pagination logic.
   */
  entries: JournalEntry[];

  /**
   * An array of tags used to categorize or filter the journal entries.
   */
  tags: Tag[];

  /**
   * A boolean flag indicating whether data is being fetched or
   * processed.
   */
  loading: boolean;

  /**
   * A string containing the error message if an error occurs, or null
   * if no error.
   */
  error: string | null;

  /**
   * The current search query input used to filter journal entries.
   */
  searchQuery: string;

  /**
   * An array of tag identifiers representing the currently selected
   * tags for filtering.
   */
  selectedTags: string[];

  /**
   * A boolean indicating whether there are more entries available to be
   * fetched for pagination.
   */
  hasMore: boolean;
}

/**
 * Hook for managing journal entries and their associated states.
 *
 * Provides functionality for CRUD operations, searching, and
 * filtering journal entries.
 *
 * @returns An object containing the current state and action methods
 * to interact with journal entries.
 */
export const useJournalViewModel = () => {
  const [state, setState] = useState<JournalViewModelState>({
    entries: [],
    tags: [],
    loading: false,
    error: null,
    searchQuery: '',
    selectedTags: [],
    hasMore: true,
  });

  const repository: JournalRepository = useRepository();
  const batchSize = 10;

  /**
   * Updates the view model state with the provided partial state.
   *
   * @param updates Partial state object to merge with current state.
   */
  const updateState = useCallback((updates: Partial<JournalViewModelState>) => {
    setState(prev => ({...prev, ...updates}));
  }, [setState]);

  /**
   * Sets the error state in the view model.
   *
   * @param error Error message string or null to clear errors.
   */
  const setError = useCallback((error: string | null) => {
    updateState({error});
  }, [updateState]);

  /**
   * Loads journal entries based on current filters (search query and
   * selected tags).
   *
   * @param offset Starting position for pagination, defaults to 0.
   * @param append If true, appends results to existing entries; if
   * false, replaces them.
   * @returns Promise that resolves when entries are loaded.
   */
  const loadEntries = useCallback(async (offset: number = 0, append: boolean = false) => {
    updateState({error: null});

    try {
      let entries: JournalEntry[];
      const query = state.searchQuery;
      const tags = state.selectedTags;

      if (query) {
        entries = await repository.searchEntries(query, offset, batchSize);
      } else if (tags.length > 0) {
        entries = await repository.getEntriesByTags(tags, offset, batchSize);
      } else {
        entries = await repository.getAllEntries(offset, batchSize);
      }

      updateState({
        entries: append ? [...state.entries, ...entries] : entries,
        hasMore: entries.length === batchSize,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load entries');
    }
  }, [state.searchQuery, state.selectedTags, state.entries, updateState, setError, batchSize, repository]);

  /**
   * Loads the next batch of journal entries for infinite scrolling
   * functionality.
   *
   * Only loads if there are more entries available and not currently
   * loading.
   *
   * @returns Promise that resolves when additional entries are loaded.
   */
  const loadMoreEntries = useCallback(async () => {
    if (!state.hasMore || state.loading) return;
    await loadEntries(state.entries.length, true);
  }, [state.hasMore, state.loading, state.entries.length, loadEntries]);

  /**
   * Loads all available tags from the repository.
   *
   * @returns Promise that resolves when tags are loaded.
   */
  const loadTags = useCallback(async () => {
    try {
      const tags = await repository.getAllTags();
      updateState({tags});
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load tags');
    }
  }, [updateState, setError, repository]);

  /**
   * Creates a new journal entry with the provided content and metadata.
   *
   * @param content The main text content of the journal entry.
   * @param datetime The date and time of the entry, defaults to current
   * time.
   * @param tags Array of tag names to associate with the entry.
   * @param location Optional location data for the entry.
   * @returns Promise resolving to the created entry or null if creation
   * failed.
   */
  const createEntry = useCallback(async (
    content: string,
    datetime: Date = new Date(),
    tags: string[] = [],
    location?: JournalEntry['location']
  ): Promise<JournalEntry | null> => {
    if (!content.trim()) {
      setError('Content cannot be empty');
      return null;
    }

    updateState({loading: true, error: null});

    try {
      const entry = await repository.createEntry({
        content: content.trim(),
        datetime,
        tags,
        location,
      });

      // Refresh entries to show the new one
      await loadEntries();
      await loadTags(); // Refresh tags in case new ones were created

      updateState({loading: false});
      return entry;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create entry');
      updateState({loading: false});
      return null;
    }
  }, [updateState, setError, loadEntries, loadTags]);

  /**
   * Updates an existing journal entry with the provided changes.
   *
   * @param id - The unique identifier of the entry to update.
   * @param updates - Partial entry object containing the fields to
   * update.
   * @returns Promise resolving to the updated entry or null if update
   * failed.
   */
  const updateEntry = useCallback(async (
    id: string,
    updates: Partial<Omit<JournalEntry, 'id' | 'created_at'>>
  ): Promise<JournalEntry | null> => {
    updateState({loading: true, error: null});

    try {
      const entry = await repository.updateEntry(id, updates);

      // Update the entry in the local state
      updateState({
        entries: state.entries.map(e => e.id === id ? entry : e),
        loading: false,
      });

      if (updates.tags) {
        await loadTags(); // Refresh tags in case new ones were created
      }

      return entry;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to update entry');
      updateState({loading: false});
      return null;
    }
  }, [state.entries, updateState, setError, loadTags, repository]);

  /**
   * Deletes a journal entry by its ID.
   *
   * @param id - The unique identifier of the entry to delete.
   * @returns Promise resolving to true if deletion was successful,
   * false otherwise.
   */
  const deleteEntry = useCallback(async (id: string): Promise<boolean> => {
    updateState({loading: true, error: null});

    try {
      await repository.deleteEntry(id);

      // Remove the entry from local state
      updateState({
        entries: state.entries.filter(e => e.id !== id),
        loading: false,
      });

      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to delete entry');
      updateState({loading: false});
      return false;
    }
  }, [state.entries, updateState, setError, repository]);

  /**
   * Searches for journal entries containing the specified query text.
   *
   * @param query - The search text to look for in journal entries.
   * @returns Promise that resolves when search results are loaded.
   */
  const search = useCallback(async (query: string) => {
    updateState({searchQuery: query});
  }, [updateState]);

  /**
   * Filters journal entries to show only those with the specified tags.
   *
   * @param tagNames - Array of tag names to filter entries by.
   * @returns Promise that resolves when filtered entries are loaded.
   */
  const filterByTags = useCallback(async (tagNames: string[]) => {
    updateState({selectedTags: tagNames});
  }, [updateState]);

  /**
   * Clears all search and tag filters, showing all journal entries.
   *
   * @returns Promise that resolves when unfiltered entries are loaded.
   */
  const clearFilters = useCallback(async () => {
    updateState({searchQuery: '', selectedTags: []});
  }, [updateState]);

  /**
   * Refreshes all journal data (entries and tags) from the repository.
   *
   * Sets loading state during refresh and handles errors.
   *
   * @returns Promise that resolves when data refresh is complete.
   */
  const refreshData = useCallback(async () => {
    updateState({loading: true, error: null});
    try {
      await Promise.all([
        loadEntries(0, false),
        loadTags(),
      ]);
    } finally {
      updateState({loading: false});
    }
  }, [loadEntries, loadTags, updateState]);

  // Trigger entry reload whenever filters change.
  useEffect(() => {
    // Avoid triggering while already loading; refreshData handles its own call.
    if (!state.loading) {
      void loadEntries(0, false);
    }
    // We intentionally do not include loadEntries' dependencies directly here,
    // only the filters and loading flag, to fire on filter changes.
  }, [state.searchQuery, state.selectedTags, state.loading, loadEntries]);

  // Keep a stable ref to the latest refreshData implementation. This
  // is to break circular references. I.e. we can depend on the ref
  // without re-triggering when the refreshData function is updated.
  const refreshDataRef = useRef(refreshData);
  useEffect(() => {
    refreshDataRef.current = refreshData;
  }, [refreshData]);

  // Initialize data on mount.
  useEffect(() => {
    void refreshDataRef.current();
  }, [refreshDataRef]);

  return {
    state,
    actions: {
      loadMoreEntries,
      createEntry,
      updateEntry,
      deleteEntry,
      search,
      filterByTags,
      clearFilters,
      refreshData,
      setError,
    },
  };
};
