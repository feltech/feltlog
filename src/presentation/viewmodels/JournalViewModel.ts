import { useCallback, useEffect, useRef } from 'react';
import { useImmer } from 'use-immer';
import { JournalEntry, Tag } from '../../domain/entities/JournalEntry';
import { JournalRepository, JournalFilter } from '../../domain/repositories/JournalRepository';
import { useRepository } from '@/src/domain/repositories/RepositoryContext';

/**
 * Draft filter values being edited in the filter panel.
 *
 * These reflect the current state of the panel inputs. They are only applied to the
 * entry list when the user presses the OK button (see {@link applyFilter}). Kept
 * in-memory only; never persisted.
 */
export interface JournalFilterDraft {
  /** Draft start date (inclusive lower bound). Undefined means no lower bound. */
  startDate?: Date;
  /** Draft end date (inclusive upper bound). Undefined means no upper bound. */
  endDate?: Date;
  /** Draft exact-phrase search text. Empty string means no phrase constraint. */
  phrase: string;
}

/**
 * The currently applied filter, or null when filtering is disabled.
 *
 * When non-null, {@link loadEntries} calls
 * {@link JournalRepository.searchEntriesWithFilter} with these values. When null, the
 * panel is considered off and the unfiltered `getAllEntries` / `searchEntries` /
 * `getEntriesByTags` paths are used.
 */
export type AppliedJournalFilter = JournalFilterDraft | null;

/** Represents the state of a journal view model. */
export interface JournalViewModelState {
  /**
   * An array of journal entries, representing the main content of the journal.
   *
   * This is just the visible set of journal entries - more may be fetched according to
   * pagination logic.
   */
  entries: JournalEntry[];

  /** An array of tags used to categorize or filter the journal entries. */
  tags: Tag[];

  /** A boolean flag indicating whether data is being fetched or processed. */
  loading: boolean;

  /** A string containing the error message if an error occurs, or null if no error. */
  error: string | null;

  /** The current search query input used to filter journal entries. */
  searchQuery: string;

  /** The tag identifiers currently selected for filtering. */
  selectedTags: string[];

  /**
   * A boolean indicating whether there are more entries available to be fetched for
   * pagination.
   */
  hasMore: boolean;

  /** Whether the filter panel is currently open (visible to the user). */
  filterPanelOpen: boolean;

  /** The draft filter values currently shown in the filter panel. */
  filterDraft: JournalFilterDraft;

  /**
   * The filter values currently applied to the entry list, or null when filtering is
   * disabled (panel off or cleared).
   */
  appliedFilter: AppliedJournalFilter;
}

/** The default draft filter (all fields unset / empty). */
const EMPTY_DRAFT: JournalFilterDraft = { phrase: '' };

/**
 * Determines whether an applied filter has any active constraints.
 *
 * Callers always pass a non-null filter (the null case is handled at the call site), so
 * this function only checks whether any constraint is actually set.
 *
 * @param filter - The applied filter. Must be non-null.
 *
 * @returns True when the filter has at least one constraint set.
 */
function hasActiveConstraints(filter: JournalFilterDraft): boolean {
  return (
    filter.phrase.length > 0 || filter.startDate !== undefined || filter.endDate !== undefined
  );
}

/**
 * Hook for managing journal entries and their associated states. Provides functionality
 * for CRUD operations, searching, and filtering journal entries.
 *
 * @returns An object containing the current state and action methods to interact with
 *   journal entries.
 */
export const useJournalViewModel = () => {
  const [state, setState] = useImmer<JournalViewModelState>({
    entries: [],
    tags: [],
    loading: false,
    error: null,
    searchQuery: '',
    selectedTags: [],
    hasMore: false,
    filterPanelOpen: false,
    filterDraft: { ...EMPTY_DRAFT },
    appliedFilter: null,
  });

  const repository: JournalRepository = useRepository();
  const batchSize = 10;

  /**
   * Sets the error state in the view model.
   *
   * @param error - Error message string or null to clear errors.
   */
  const setError = useCallback(
    (error: string | null) => {
      setState(draft => {
        draft.error = error;
      });
    },
    [setState],
  );

  /**
   * Loads journal entries based on current filters (search query, selected tags, and
   * the applied date/phrase filter from the filter panel).
   *
   * When the filter panel has an applied filter with active constraints, the
   * repository's `searchEntriesWithFilter` method is used (combining phrase and date
   * range in a single query). Otherwise the existing `searchQuery` / `selectedTags` /
   * `getAllEntries` paths are preserved unchanged.
   *
   * @param offset - Starting position for pagination, defaults to 0.
   * @param append - If true, appends results to existing entries; if false, replaces
   *   them.
   *
   * @returns Promise that resolves when entries are loaded.
   */
  const loadEntries = useCallback(
    async (offset: number = 0, append: boolean = false) => {
      setState(draft => {
        draft.error = null;
      });

      try {
        let entries: JournalEntry[];
        // Read filter values from the closure (not the draft) because the async
        // fetch happens after the draft callback has already completed.
        const query = state.searchQuery;
        const tags = state.selectedTags;
        const applied = state.appliedFilter;

        if (applied && hasActiveConstraints(applied)) {
          // The filter panel's applied filter takes precedence over the legacy
          // searchQuery / selectedTags paths. Build the JournalFilter for the
          // repository, normalising empty phrase to undefined.
          const repoFilter: JournalFilter = {
            phrase: applied.phrase.length > 0 ? applied.phrase : undefined,
            startDate: applied.startDate,
            endDate: applied.endDate,
          };
          entries = await repository.searchEntriesWithFilter(repoFilter, offset, batchSize);
        } else if (query) {
          entries = await repository.searchEntries(query, offset, batchSize);
        } else if (tags.length > 0) {
          entries = await repository.getEntriesByTags(tags, offset, batchSize);
        } else {
          entries = await repository.getAllEntries(offset, batchSize);
        }

        setState(draft => {
          draft.entries = append ? [...draft.entries, ...entries] : entries;
          draft.hasMore = entries.length === batchSize;
        });
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to load entries');
      }
    },
    [
      state.searchQuery,
      state.selectedTags,
      state.appliedFilter,
      setState,
      setError,
      batchSize,
      repository,
    ],
  );

  /**
   * Loads the next batch of journal entries for infinite scrolling functionality.
   *
   * Only loads if there are more entries available and not currently loading.
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
      setState(draft => {
        draft.tags = tags;
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load tags');
    }
  }, [setState, setError, repository]);

  /**
   * Creates a new journal entry with the provided content and metadata.
   *
   * @param content - The main text content of the journal entry.
   * @param datetime - The date and time of the entry, defaults to current time.
   * @param tags - Array of tag names to associate with the entry.
   * @param location - Optional location data for the entry.
   *
   * @returns Promise resolving to the created entry or null if creation failed.
   */
  const createEntry = useCallback(
    async (
      content: string,
      datetime: Date = new Date(),
      tags: string[] = [],
      location?: JournalEntry['location'],
    ): Promise<JournalEntry | null> => {
      if (!content.trim()) {
        setError('Content cannot be empty');
        return null;
      }

      setState(draft => {
        draft.loading = true;
        draft.error = null;
      });

      try {
        const entry: JournalEntry | null = await repository.createEntry({
          content: content.trim(),
          datetime,
          tags,
          location,
        });

        // Refresh entries to show the new one
        await loadEntries();
        await loadTags(); // Refresh tags in case new ones were created

        setState(draft => {
          draft.loading = false;
        });
        return entry;
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to create entry');
        setState(draft => {
          draft.loading = false;
        });
        return null;
      }
    },
    [setState, setError, loadEntries, loadTags, repository],
  );

  /**
   * Updates an existing journal entry with the provided changes.
   *
   * @param id - The unique identifier of the entry to update.
   * @param updates - Partial entry object containing the fields to update.
   *
   * @returns Promise resolving to the updated entry or null if update failed.
   */
  const updateEntry = useCallback(
    async (
      id: string,
      updates: Partial<Omit<JournalEntry, 'id' | 'created_at'>>,
    ): Promise<JournalEntry | null> => {
      setState(draft => {
        draft.loading = true;
        draft.error = null;
      });

      try {
        const entry = await repository.updateEntry(id, updates);

        // Update the entry in the local state
        setState(draft => {
          const index = draft.entries.findIndex(e => e.id === id);
          if (index !== -1) draft.entries[index] = entry;
          draft.loading = false;
        });

        if (updates.tags) {
          await loadTags(); // Refresh tags in case new ones were created
        }

        return entry;
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to update entry');
        setState(draft => {
          draft.loading = false;
        });
        return null;
      }
    },
    [setState, setError, loadTags, repository],
  );

  /**
   * Deletes a journal entry by its ID.
   *
   * @param id - The unique identifier of the entry to delete.
   *
   * @returns Promise resolving to true if deletion was successful, false otherwise.
   */
  const deleteEntry = useCallback(
    async (id: string): Promise<boolean> => {
      setState(draft => {
        draft.loading = true;
        draft.error = null;
      });

      try {
        await repository.deleteEntry(id);

        // Remove the entry from local state
        setState(draft => {
          draft.entries = draft.entries.filter(e => e.id !== id);
          draft.loading = false;
        });

        return true;
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to delete entry');
        setState(draft => {
          draft.loading = false;
        });
        return false;
      }
    },
    [setState, setError, repository],
  );

  /**
   * Searches for journal entries containing the specified query text.
   *
   * @param query - The search text to look for in journal entries.
   *
   * @returns Promise that resolves when search results are loaded.
   */
  const search = useCallback(
    async (query: string) => {
      setState(draft => {
        draft.searchQuery = query;
      });
    },
    [setState],
  );

  /**
   * Filters journal entries to show only those with the specified tags.
   *
   * @param tagNames - Array of tag names to filter entries by.
   *
   * @returns Promise that resolves when filtered entries are loaded.
   */
  const filterByTags = useCallback(
    async (tagNames: string[]) => {
      setState(draft => {
        draft.selectedTags = tagNames;
      });
    },
    [setState],
  );

  /**
   * Clears all search and tag filters, showing all journal entries.
   *
   * @returns Promise that resolves when unfiltered entries are loaded.
   */
  const clearFilters = useCallback(async () => {
    setState(draft => {
      draft.searchQuery = '';
      draft.selectedTags = [];
    });
  }, [setState]);

  /**
   * Toggles the filter panel visibility.
   *
   * When opening the panel, the draft is initialised from the currently applied filter
   * (if any) so the panel shows the last-applied values. When closing, the applied
   * filter is cleared so the entry list reverts to unfiltered, but the draft is
   * preserved in memory so reopening restores the previous values. The user must press
   * OK to re-apply the filter after reopening.
   */
  const toggleFilterPanel = useCallback(() => {
    setState(draft => {
      const willOpen = !draft.filterPanelOpen;
      draft.filterPanelOpen = willOpen;
      if (willOpen) {
        // Restore the draft from the previously applied filter (if any) so the
        // panel opens with the last-applied (or empty) values. The draft is
        // preserved across close/reopen cycles, so this is mainly relevant the
        // first time the panel is opened after an applyFilter call.
        draft.filterDraft = draft.appliedFilter
          ? {
              startDate: draft.appliedFilter.startDate,
              endDate: draft.appliedFilter.endDate,
              phrase: draft.appliedFilter.phrase,
            }
          : draft.filterDraft;
      } else {
        // Closing the panel disables filtering: the list reverts to all entries
        // (or the legacy searchQuery/selectedTags path). The draft is left
        // untouched so reopening restores the previous widget values; the user
        // must press OK to re-apply.
        draft.appliedFilter = null;
      }
    });
  }, [setState]);

  /**
   * Updates a single draft filter field in the panel.
   *
   * Pass `undefined` for a date field to clear it.
   *
   * When a date is changed, the cross-bound is constrained so the range stays valid: a
   * start date after the current end date pulls the end date up to the same day
   * (end-of-day), and an end date before the current start date pulls the start date
   * down to the same day (start-of-day). Comparisons use the normalised bounds
   * (start-of-day for startDate, end-of-day for endDate) so the UI stays consistent
   * with how the bounds are applied.
   *
   * @param patch - Partial draft values to merge into the current draft.
   */
  const updateFilterDraft = useCallback(
    (patch: Partial<JournalFilterDraft>) => {
      setState(draft => {
        const current = draft.filterDraft;
        const next: JournalFilterDraft = { ...current, ...patch };

        // Compare against the already-merged `next` bounds so that a single
        // updateFilterDraft call touching both dates still constrains
        // correctly. Using `current` here would miss the case where both
        // bounds change in the same patch.
        if (patch.startDate !== undefined && next.endDate !== undefined) {
          // Normalise the new start to start-of-day for comparison.
          const startNorm = new Date(patch.startDate);
          startNorm.setHours(0, 0, 0, 0);
          // Compare against the (possibly just-updated) end bound.
          if (startNorm.getTime() > next.endDate.getTime()) {
            // Pull the end date up to the same day, end-of-day.
            const newEnd = new Date(patch.startDate);
            newEnd.setHours(23, 59, 59, 999);
            next.endDate = newEnd;
          }
        }

        if (patch.endDate !== undefined && next.startDate !== undefined) {
          // Normalise the new end to end-of-day for comparison.
          const endNorm = new Date(patch.endDate);
          endNorm.setHours(23, 59, 59, 999);
          // Compare against the (possibly just-updated) start bound.
          if (endNorm.getTime() < next.startDate.getTime()) {
            // Pull the start date down to the same day, start-of-day.
            const newStart = new Date(patch.endDate);
            newStart.setHours(0, 0, 0, 0);
            next.startDate = newStart;
          }
        }

        draft.filterDraft = next;
      });
    },
    [setState],
  );

  /**
   * Resets the draft filter values to empty (no constraints) and immediately disables
   * the applied filter.
   *
   * Clearing is a destructive reset: the panel inputs are blanked AND the entry list
   * reverts to unfiltered in one step. The reload effect picks up the `appliedFilter`
   * change (null) and re-fetches via the unfiltered path. This matches the user's
   * mental model of a "clear/reset" button — the visible state and the active filter
   * both go away together, without requiring a separate OK press.
   */
  const clearFilterDraft = useCallback(() => {
    setState(draft => {
      draft.filterDraft = { ...EMPTY_DRAFT };
      draft.appliedFilter = null;
    });
  }, [setState]);

  /**
   * Applies the current draft filter to the entry list.
   *
   * Copies the draft values into `appliedFilter`. The reload effect will pick up the
   * change and call `searchEntriesWithFilter`. If the draft has no constraints, the
   * applied filter is set to null so the unfiltered path is used.
   */
  const applyFilter = useCallback(() => {
    setState(draft => {
      const draftSnapshot = {
        startDate: draft.filterDraft.startDate,
        endDate: draft.filterDraft.endDate,
        phrase: draft.filterDraft.phrase,
      };
      draft.appliedFilter = hasActiveConstraints(draftSnapshot) ? draftSnapshot : null;
    });
  }, [setState]);

  /**
   * Refreshes all journal data (entries and tags) from the repository. Sets loading
   * state during refresh and handles errors.
   *
   * @returns Promise that resolves when data refresh is complete.
   */
  const refreshData = useCallback(async () => {
    setState(draft => {
      draft.loading = true;
      draft.error = null;
    });
    try {
      await Promise.all([loadEntries(0, false), loadTags()]);
    } finally {
      setState(draft => {
        draft.loading = false;
      });
    }
  }, [loadEntries, loadTags, setState]);

  // Keep a stable ref to the latest loadEntries implementation to avoid
  // infinite loops caused by function identity changes.
  const loadEntriesRef = useRef(loadEntries);
  useEffect(() => {
    loadEntriesRef.current = loadEntries;
  }, [loadEntries]);

  // Trigger entry reload whenever filters change.
  useEffect(() => {
    // Call the latest loadEntries without depending on its identity to avoid
    // re-running due to state updates inside loadEntries.
    void loadEntriesRef.current(0, false);
    // Only react to filter changes.
  }, [state.searchQuery, state.selectedTags, state.appliedFilter]);

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

  /**
   * Loads a single journal entry by its ID directly from the repository.
   *
   * This is used by screens that need to open a specific entry regardless of the
   * current pagination state (e.g. the entry editor when navigated to via deep link or
   * after infinite scroll). Unlike searching through the in-memory `entries` array,
   * this always resolves the entry from the database.
   *
   * @param id - The unique identifier of the entry to load.
   *
   * @returns The journal entry if found, otherwise null.
   */
  const getEntryById = useCallback(
    async (id: string): Promise<JournalEntry | null> => {
      try {
        return await repository.getEntry(id);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to load entry');
        return null;
      }
    },
    [setError, repository],
  );

  /**
   * Loads the tag names of the most recently created journal entry.
   *
   * Used by the entry editor to pre-populate the tag list when creating a new entry.
   * Returns an empty array when there are no entries or the most recent entry has no
   * tags. Errors are surfaced via the shared `error` state field.
   *
   * @returns A list of tag name strings for the most recent entry, or an empty array on
   *   failure or when no entries exist.
   */
  const loadDefaultTags = useCallback(async (): Promise<string[]> => {
    try {
      return await repository.getMostRecentEntryTags();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load default tags');
      return [];
    }
  }, [setError, repository]);

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
      getEntryById,
      loadDefaultTags,
      toggleFilterPanel,
      updateFilterDraft,
      clearFilterDraft,
      applyFilter,
    },
  };
};
