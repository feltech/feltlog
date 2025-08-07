import { useState, useEffect, useCallback } from 'react';
import { JournalEntry, Tag } from '../../domain/entities/JournalEntry';
import { JournalRepository } from '../../domain/repositories/JournalRepository';
import { JournalRepositoryImpl } from '../../data/repositories/JournalRepositoryImpl';

export interface JournalViewModelState {
  entries: JournalEntry[];
  tags: Tag[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  selectedTags: string[];
  hasMore: boolean;
}

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

  const repository: JournalRepository = new JournalRepositoryImpl();
  const batchSize = 10;

  const updateState = useCallback((updates: Partial<JournalViewModelState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, [setState]);

  const setError = useCallback((error: string | null) => {
    updateState({ error });
  }, [updateState]);

  const loadEntries = useCallback(async (offset: number = 0, append: boolean = false) => {
    if (state.loading) return;

    updateState({ loading: true, error: null });

    try {
      let entries: JournalEntry[];

      if (state.searchQuery) {
        entries = await repository.searchEntries(state.searchQuery, offset, batchSize);
      } else if (state.selectedTags.length > 0) {
        entries = await repository.getEntriesByTags(state.selectedTags, offset, batchSize);
      } else {
        entries = await repository.getAllEntries(offset, batchSize);
      }

      updateState({
        // entries: append ? [...state.entries, ...entries] : entries,
        // hasMore: entries.length === batchSize,
        loading: false,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load entries');
      updateState({ loading: false });
    }
  }, [state.loading, state.searchQuery, state.selectedTags, state.entries, updateState, setError, batchSize]);

  const loadMoreEntries = useCallback(async () => {
    if (!state.hasMore || state.loading) return;
    await loadEntries(state.entries.length, true);
  }, [state.hasMore, state.loading, state.entries.length, loadEntries]);

  const loadTags = useCallback(async () => {
    try {
      const tags = await repository.getAllTags();
      updateState({ tags });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load tags');
      updateState({ loading: false });
    }
  }, [updateState, setError]);

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

    updateState({ loading: true, error: null });

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

      updateState({ loading: false });
      return entry;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create entry');
      updateState({ loading: false });
      return null;
    }
  }, [updateState, setError, loadEntries, loadTags]);

  const updateEntry = useCallback(async (
    id: string,
    updates: Partial<Omit<JournalEntry, 'id' | 'created_at'>>
  ): Promise<JournalEntry | null> => {
    updateState({ loading: true, error: null });

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
      updateState({ loading: false });
      return null;
    }
  }, [state.entries, updateState, setError, loadTags]);

  const deleteEntry = useCallback(async (id: string): Promise<boolean> => {
    updateState({ loading: true, error: null });

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
      updateState({ loading: false });
      return false;
    }
  }, [state.entries, updateState, setError]);

  const search = useCallback(async (query: string) => {
    updateState({ searchQuery: query });
    await loadEntries(0, false);
  }, [updateState, loadEntries]);

  const filterByTags = useCallback(async (tagNames: string[]) => {
    updateState({ selectedTags: tagNames });
    await loadEntries(0, false);
  }, [updateState, loadEntries]);

  const clearFilters = useCallback(async () => {
    updateState({ searchQuery: '', selectedTags: [] });
    await loadEntries(0, false);
  }, [updateState, loadEntries]);

  const refreshData = useCallback(async () => {
    await Promise.all([
      loadEntries(0, false),
      // loadTags(),
    ]);
  }, [loadEntries, loadTags]);

  // Initialize data on mount
  useEffect(() => {
    refreshData();
  }, [refreshData]);

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
