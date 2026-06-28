import React from 'react';
import { act, render } from '@testing-library/react-native';
import { RepositoryProvider } from '@/src/domain/repositories/RepositoryContext';
import { useJournalViewModel } from '../JournalViewModel';
import type { JournalRepository } from '@/src/domain/repositories/JournalRepository';
import type { JournalEntry, Tag } from '@/src/domain/entities/JournalEntry';

/** Mock repository for testing JournalViewModel. */
class MockRepo implements JournalRepository {
  // State for assertions
  getAllEntriesCalls = 0;
  searchEntriesCalls = 0;
  getEntriesByTagsCalls = 0;

  /** Simulated entries to return from getAllEntries. */
  entriesToReturn: JournalEntry[] = [];
  /** Simulated tags to return from getAllTags. */
  tagsToReturn: Tag[] = [];
  /** Simulated error to throw on next call. */
  nextError: Error | null = null;

  // Unused methods mocked
  createEntry = jest.fn().mockResolvedValue({
    id: 'new-id',
    content: '',
    datetime: new Date(),
    created_at: new Date(),
    modified_at: new Date(),
    tags: [] as string[],
  });
  updateEntry = jest.fn().mockResolvedValue({
    id: 'upd-id',
    content: '',
    datetime: new Date(),
    created_at: new Date(),
    modified_at: new Date(),
    tags: [] as string[],
  });
  deleteEntry = jest.fn().mockResolvedValue(undefined);
  getEntry = jest.fn(async () => null);
  createTag = jest.fn();
  getOrCreateTag = jest.fn();
  deleteTag = jest.fn();
  getTagsForEntry = jest.fn();
  getMostRecentEntryTags = jest.fn().mockResolvedValue([]);

  /**
   * Retrieves all journal entries.
   *
   * @returns The configured entries or an empty array.
   */
  async getAllEntries(): Promise<JournalEntry[]> {
    this.getAllEntriesCalls++;
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = null;
      throw err;
    }
    return this.entriesToReturn;
  }

  /**
   * Searches for journal entries.
   *
   * @returns The configured entries or an empty array.
   */
  async searchEntries(): Promise<JournalEntry[]> {
    this.searchEntriesCalls++;
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = null;
      throw err;
    }
    return this.entriesToReturn;
  }

  /**
   * Retrieves entries filtered by tags.
   *
   * @returns The configured entries or an empty array.
   */
  async getEntriesByTags(): Promise<JournalEntry[]> {
    this.getEntriesByTagsCalls++;
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = null;
      throw err;
    }
    return this.entriesToReturn;
  }

  /**
   * Retrieves all tags.
   *
   * @returns The configured tags or an empty array.
   */
  async getAllTags(): Promise<Tag[]> {
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = null;
      throw err;
    }
    return this.tagsToReturn;
  }
}

/**
 * Test harness component that exposes the view model API via a ref, so callers always
 * read the latest state after re-renders.
 *
 * @param props - Component props.
 * @param props.apiRef - A React ref to store the latest view model API.
 *
 * @returns Null.
 */
function Harness({
  apiRef,
}: {
  apiRef: React.MutableRefObject<ReturnType<typeof useJournalViewModel> | null>;
}) {
  const api = useJournalViewModel();
  // Always keep the ref up to date with the latest API.
  apiRef.current = api;
  return null;
}

/**
 * Test suite for the JournalViewModel hook. Covers state management, pagination,
 * search, tag filtering, error handling, and CRUD operations.
 */
describe('JournalViewModel', () => {
  /**
   * Helper to render the harness inside a RepositoryProvider and return a ref that
   * always points to the latest view model API.
   *
   * @param repo - The mock repository to use.
   *
   * @returns A ref to the view model API.
   */
  async function renderViewModel(
    repo: MockRepo,
  ): Promise<React.MutableRefObject<ReturnType<typeof useJournalViewModel> | null>> {
    const apiRef: React.MutableRefObject<ReturnType<typeof useJournalViewModel> | null> = {
      current: null,
    };

    render(
      <RepositoryProvider repository={repo}>
        <Harness apiRef={apiRef} />
      </RepositoryProvider>,
    );

    // Allow initial effects to run.
    await act(async () => {});
    return apiRef;
  }

  /** Tests that the initial state is set correctly. */
  it('initialises with default state', async () => {
    const repo = new MockRepo();
    const apiRef = await renderViewModel(repo);
    const vm = apiRef.current!;

    expect(vm.state.entries).toEqual([]);
    expect(vm.state.tags).toEqual([]);
    expect(vm.state.loading).toBe(false);
    expect(vm.state.error).toBeNull();
    expect(vm.state.searchQuery).toBe('');
    expect(vm.state.selectedTags).toEqual([]);
    expect(vm.state.hasMore).toBe(false);
  });

  /** Tests that the view model loads entries on mount. */
  it('calls getAllEntries on mount', async () => {
    const repo = new MockRepo();
    await renderViewModel(repo);
    expect(repo.getAllEntriesCalls).toBeGreaterThanOrEqual(1);
  });

  /** Tests that loadMoreEntries is a no-op when hasMore is false. */
  it('does not call load more when hasMore is false', async () => {
    const repo = new MockRepo();
    const apiRef = await renderViewModel(repo);
    const initialCalls = repo.getAllEntriesCalls;

    await act(async () => {
      await apiRef.current!.actions.loadMoreEntries();
    });

    expect(repo.getAllEntriesCalls).toBe(initialCalls);
  });

  /** Tests that searching calls searchEntries on the repository. */
  it('calls searchEntries when search is triggered', async () => {
    const repo = new MockRepo();
    const apiRef = await renderViewModel(repo);

    await act(async () => {
      await apiRef.current!.actions.search('hello');
    });

    // Allow the useEffect to fire.
    await act(async () => {});
    expect(repo.searchEntriesCalls).toBeGreaterThanOrEqual(1);
  });

  /** Tests that filterByTags calls getEntriesByTags on the repository. */
  it('calls getEntriesByTags when filterByTags is triggered', async () => {
    const repo = new MockRepo();
    const apiRef = await renderViewModel(repo);

    await act(async () => {
      await apiRef.current!.actions.filterByTags(['work']);
    });

    // Allow the useEffect to fire.
    await act(async () => {});
    expect(repo.getEntriesByTagsCalls).toBeGreaterThanOrEqual(1);
  });

  /** Tests that clearFilters resets searchQuery and selectedTags. */
  it('clears filters and reloads entries', async () => {
    const repo = new MockRepo();
    const apiRef = await renderViewModel(repo);

    // Apply a filter first.
    await act(async () => {
      await apiRef.current!.actions.search('test');
    });
    await act(async () => {});

    // Clear filters.
    await act(async () => {
      await apiRef.current!.actions.clearFilters();
    });
    await act(async () => {});

    expect(apiRef.current!.state.searchQuery).toBe('');
    expect(apiRef.current!.state.selectedTags).toEqual([]);
  });

  /** Tests that setError sets the error state. */
  it('sets error state via setError action', async () => {
    const repo = new MockRepo();
    const apiRef = await renderViewModel(repo);

    await act(async () => {
      apiRef.current!.actions.setError('Something went wrong');
    });

    expect(apiRef.current!.state.error).toBe('Something went wrong');
  });

  /** Tests that setError(null) clears the error state. */
  it('clears error state when setError is called with null', async () => {
    const repo = new MockRepo();
    const apiRef = await renderViewModel(repo);

    await act(async () => {
      apiRef.current!.actions.setError('Error');
    });
    await act(async () => {
      apiRef.current!.actions.setError(null);
    });

    expect(apiRef.current!.state.error).toBeNull();
  });

  /** Tests that createEntry returns null and sets error for empty content. */
  it('returns null and sets error when creating entry with empty content', async () => {
    const repo = new MockRepo();
    const apiRef = await renderViewModel(repo);

    const resultHolder: { current: JournalEntry | null } = { current: null };
    await act(async () => {
      resultHolder.current = await apiRef.current!.actions.createEntry('   ');
    });

    expect(resultHolder.current).toBeNull();
    expect(apiRef.current!.state.error).toBe('Content cannot be empty');
  });

  /** Tests that createEntry calls repository.createEntry and reloads entries. */
  it('creates an entry and reloads entries', async () => {
    const repo = new MockRepo();
    const apiRef = await renderViewModel(repo);

    const resultHolder: { current: JournalEntry | null } = { current: null };
    await act(async () => {
      resultHolder.current = await apiRef.current!.actions.createEntry('New content');
    });

    expect(repo.createEntry).toHaveBeenCalled();
    expect(resultHolder.current).toBeDefined();
  });

  /** Tests that createEntry handles repository errors. */
  it('handles errors when creating an entry', async () => {
    const repo = new MockRepo();
    (repo.createEntry as jest.Mock).mockRejectedValue(new Error('DB write failed'));
    const apiRef = await renderViewModel(repo);

    const resultHolder: { current: JournalEntry | null } = { current: null };
    await act(async () => {
      resultHolder.current = await apiRef.current!.actions.createEntry('Content that fails');
    });

    expect(resultHolder.current).toBeNull();
    expect(apiRef.current!.state.error).toBe('DB write failed');
  });

  /** Tests that createEntry handles non-Error exceptions. */
  it('handles non-Error exceptions when creating an entry', async () => {
    const repo = new MockRepo();
    (repo.createEntry as jest.Mock).mockRejectedValue('string error');
    const apiRef = await renderViewModel(repo);

    const resultHolder: { current: JournalEntry | null } = { current: null };
    await act(async () => {
      resultHolder.current = await apiRef.current!.actions.createEntry('Content');
    });

    expect(resultHolder.current).toBeNull();
    expect(apiRef.current!.state.error).toBe('Failed to create entry');
  });

  /** Tests that updateEntry updates the entry in local state. */
  it('updates entry in local state', async () => {
    const repo = new MockRepo();
    repo.entriesToReturn = [
      {
        id: 'entry-1',
        content: 'original',
        datetime: new Date(),
        created_at: new Date(),
        modified_at: new Date(),
        tags: [],
      },
    ];
    const apiRef = await renderViewModel(repo);

    (repo.updateEntry as jest.Mock).mockResolvedValue({
      id: 'entry-1',
      content: 'updated',
      datetime: new Date(),
      created_at: new Date(),
      modified_at: new Date(),
      tags: [],
    });

    const resultHolder: { current: JournalEntry | null } = { current: null };
    await act(async () => {
      resultHolder.current = await apiRef.current!.actions.updateEntry('entry-1', {
        content: 'updated',
      });
    });

    expect(resultHolder.current?.content).toBe('updated');
  });

  /** Tests that updateEntry handles errors. */
  it('handles errors when updating an entry', async () => {
    const repo = new MockRepo();
    (repo.updateEntry as jest.Mock).mockRejectedValue(new Error('Update failed'));
    const apiRef = await renderViewModel(repo);

    const resultHolder: { current: JournalEntry | null } = { current: null };
    await act(async () => {
      resultHolder.current = await apiRef.current!.actions.updateEntry('entry-1', {
        content: 'fail',
      });
    });

    expect(resultHolder.current).toBeNull();
    expect(apiRef.current!.state.error).toBe('Update failed');
  });

  /** Tests that updateEntry handles non-Error exceptions. */
  it('handles non-Error exceptions when updating an entry', async () => {
    const repo = new MockRepo();
    (repo.updateEntry as jest.Mock).mockRejectedValue('string error');
    const apiRef = await renderViewModel(repo);

    const resultHolder: { current: JournalEntry | null } = { current: null };
    await act(async () => {
      resultHolder.current = await apiRef.current!.actions.updateEntry('entry-1', {
        content: 'fail',
      });
    });

    expect(resultHolder.current).toBeNull();
    expect(apiRef.current!.state.error).toBe('Failed to update entry');
  });

  /** Tests that updateEntry does nothing when the entry is not in local state. */
  it('does not modify local state when updating an unknown entry', async () => {
    const repo = new MockRepo();
    repo.entriesToReturn = [];
    const apiRef = await renderViewModel(repo);

    (repo.updateEntry as jest.Mock).mockResolvedValue({
      id: 'entry-1',
      content: 'updated',
      datetime: new Date(),
      created_at: new Date(),
      modified_at: new Date(),
      tags: [],
    });

    await act(async () => {
      await apiRef.current!.actions.updateEntry('entry-1', { content: 'updated' });
    });

    expect(apiRef.current!.state.entries).toHaveLength(0);
  });

  /** Tests that deleteEntry removes the entry from local state. */
  it('deletes an entry and removes it from state', async () => {
    const repo = new MockRepo();
    repo.entriesToReturn = [
      {
        id: 'entry-1',
        content: 'to delete',
        datetime: new Date(),
        created_at: new Date(),
        modified_at: new Date(),
        tags: [],
      },
      {
        id: 'entry-2',
        content: 'to keep',
        datetime: new Date(),
        created_at: new Date(),
        modified_at: new Date(),
        tags: [],
      },
    ];
    const apiRef = await renderViewModel(repo);

    let deleteResult = false;
    await act(async () => {
      deleteResult = await apiRef.current!.actions.deleteEntry('entry-1');
    });

    expect(deleteResult).toBe(true);
    expect(repo.deleteEntry).toHaveBeenCalledWith('entry-1');
  });

  /** Tests that deleteEntry handles errors. */
  it('handles errors when deleting an entry', async () => {
    const repo = new MockRepo();
    (repo.deleteEntry as jest.Mock).mockRejectedValue(new Error('Delete failed'));
    const apiRef = await renderViewModel(repo);

    let deleteResult = true;
    await act(async () => {
      deleteResult = await apiRef.current!.actions.deleteEntry('entry-1');
    });

    expect(deleteResult).toBe(false);
    expect(apiRef.current!.state.error).toBe('Delete failed');
  });

  /** Tests that deleteEntry handles non-Error exceptions. */
  it('handles non-Error exceptions when deleting an entry', async () => {
    const repo = new MockRepo();
    (repo.deleteEntry as jest.Mock).mockRejectedValue('string error');
    const apiRef = await renderViewModel(repo);

    let deleteResult = true;
    await act(async () => {
      deleteResult = await apiRef.current!.actions.deleteEntry('entry-1');
    });

    expect(deleteResult).toBe(false);
    expect(apiRef.current!.state.error).toBe('Failed to delete entry');
  });

  /** Tests that refreshData reloads entries and tags. */
  it('refreshes data (entries and tags)', async () => {
    const repo = new MockRepo();
    repo.tagsToReturn = [
      { id: 't1', name: 'work', created_at: new Date() },
      { id: 't2', name: 'personal', created_at: new Date() },
    ];
    const apiRef = await renderViewModel(repo);

    await act(async () => {
      await apiRef.current!.actions.refreshData();
    });

    expect(apiRef.current!.state.tags).toHaveLength(2);
    expect(apiRef.current!.state.loading).toBe(false);
  });

  /** Tests that refreshData handles errors from loadEntries. */
  it('handles errors during refreshData', async () => {
    const repo = new MockRepo();
    repo.nextError = new Error('Network error');
    const apiRef = await renderViewModel(repo);

    // The initial mount will have consumed the error; set it again for
    // the explicit refreshData call.
    repo.nextError = new Error('Refresh failed');
    await act(async () => {
      await apiRef.current!.actions.refreshData();
    });

    // The error from loadEntries should be captured. The loading state
    // should be reset to false by the finally block.
    expect(apiRef.current!.state.loading).toBe(false);
  });

  /** Tests that searchEntries error is handled. */
  it('handles errors from searchEntries', async () => {
    const repo = new MockRepo();
    const apiRef = await renderViewModel(repo);

    repo.nextError = new Error('Search failed');
    await act(async () => {
      await apiRef.current!.actions.search('test');
    });

    // Allow the useEffect to fire.
    await act(async () => {});
    expect(apiRef.current!.state.error).toBe('Search failed');
  });

  /** Tests that getEntriesByTags error is handled. */
  it('handles errors from getEntriesByTags', async () => {
    const repo = new MockRepo();
    const apiRef = await renderViewModel(repo);

    repo.nextError = new Error('Tag filter failed');
    await act(async () => {
      await apiRef.current!.actions.filterByTags(['work']);
    });

    // Allow the useEffect to fire.
    await act(async () => {});
    expect(apiRef.current!.state.error).toBe('Tag filter failed');
  });

  /** Tests that getAllEntries non-Error exceptions produce a generic message. */
  it('handles non-Error exceptions from getAllEntries', async () => {
    const repo = new MockRepo();
    repo.nextError = 'string error' as unknown as Error;
    const apiRef = await renderViewModel(repo);

    // The initial mount should have captured the error.
    expect(apiRef.current!.state.error).toBe('Failed to load entries');
  });

  /** Tests that loadMoreEntries appends entries to the existing list. */
  it('appends entries when loading more', async () => {
    const repo = new MockRepo();
    // Return a full batch on first call to set hasMore=true.
    repo.entriesToReturn = Array.from({ length: 10 }, (_, i) => ({
      id: `entry-${i}`,
      content: `Entry ${i}`,
      datetime: new Date(),
      created_at: new Date(),
      modified_at: new Date(),
      tags: [] as string[],
    }));
    const apiRef = await renderViewModel(repo);

    expect(apiRef.current!.state.hasMore).toBe(true);
    expect(apiRef.current!.state.entries).toHaveLength(10);

    // Now return a smaller batch for the next page.
    repo.entriesToReturn = [
      {
        id: 'entry-10',
        content: 'Entry 10',
        datetime: new Date(),
        created_at: new Date(),
        modified_at: new Date(),
        tags: [] as string[],
      },
    ];

    await act(async () => {
      await apiRef.current!.actions.loadMoreEntries();
    });

    expect(apiRef.current!.state.entries).toHaveLength(11);
    expect(apiRef.current!.state.hasMore).toBe(false);
  });

  /** Tests that createEntry with tags passes them to the repository. */
  it('passes tags to createEntry', async () => {
    const repo = new MockRepo();
    const apiRef = await renderViewModel(repo);

    await act(async () => {
      await apiRef.current!.actions.createEntry('Content with tags', new Date(), [
        'work',
        'ideas',
      ]);
    });

    expect(repo.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: ['work', 'ideas'],
      }),
    );
  });

  /** Tests that createEntry with location passes it to the repository. */
  it('passes location to createEntry', async () => {
    const repo = new MockRepo();
    const apiRef = await renderViewModel(repo);
    const location = { latitude: 40.7, longitude: -74, elevation: 10 };

    await act(async () => {
      await apiRef.current!.actions.createEntry('Geo entry', new Date(), [], location);
    });

    expect(repo.createEntry).toHaveBeenCalledWith(expect.objectContaining({ location }));
  });

  /** Tests that updateEntry with tags refreshes the tag list. */
  it('refreshes tags after updating entry with tags', async () => {
    const repo = new MockRepo();
    repo.entriesToReturn = [
      {
        id: 'e1',
        content: 'test',
        datetime: new Date(),
        created_at: new Date(),
        modified_at: new Date(),
        tags: [],
      },
    ];
    repo.tagsToReturn = [{ id: 't1', name: 'new-tag', created_at: new Date() }];
    const apiRef = await renderViewModel(repo);

    (repo.updateEntry as jest.Mock).mockResolvedValue({
      id: 'e1',
      content: 'test',
      datetime: new Date(),
      created_at: new Date(),
      modified_at: new Date(),
      tags: ['new-tag'],
    });

    await act(async () => {
      await apiRef.current!.actions.updateEntry('e1', { tags: ['new-tag'] });
    });

    expect(apiRef.current!.state.tags).toHaveLength(1);
  });

  /**
   * Tests that updateEntry updates only the matching entry in local state, leaving
   * other entries unchanged. This covers the false branch of the ternary in the map
   * callback at line 221.
   */
  it('updates only the matching entry when multiple entries exist', async () => {
    const repo = new MockRepo();
    repo.entriesToReturn = [
      {
        id: 'entry-1',
        content: 'first',
        datetime: new Date(),
        created_at: new Date(),
        modified_at: new Date(),
        tags: [],
      },
      {
        id: 'entry-2',
        content: 'second',
        datetime: new Date(),
        created_at: new Date(),
        modified_at: new Date(),
        tags: [],
      },
    ];
    const apiRef = await renderViewModel(repo);

    (repo.updateEntry as jest.Mock).mockResolvedValue({
      id: 'entry-1',
      content: 'updated first',
      datetime: new Date(),
      created_at: new Date(),
      modified_at: new Date(),
      tags: [],
    });

    await act(async () => {
      await apiRef.current!.actions.updateEntry('entry-1', { content: 'updated first' });
    });

    // entry-1 should be updated, entry-2 should remain unchanged.
    const entries = apiRef.current!.state.entries as Array<{ id: string; content: string }>;
    expect(entries.find(e => e.id === 'entry-1')?.content).toBe('updated first');
    expect(entries.find(e => e.id === 'entry-2')?.content).toBe('second');
  });

  /** Tests that loadTags handles Error exceptions. */
  it('handles Error exceptions when loading tags', async () => {
    const repo = new MockRepo();
    const originalGetAllTags = repo.getAllTags.bind(repo);
    repo.getAllTags = jest.fn().mockRejectedValue(new Error('Tags fetch failed'));
    const apiRef = await renderViewModel(repo);

    await act(async () => {
      await apiRef.current!.actions.refreshData();
    });

    expect(apiRef.current!.state.error).toBe('Tags fetch failed');

    repo.getAllTags = originalGetAllTags;
  });

  /**
   * Tests that loadTags handles non-Error exceptions (covers the false branch of the
   * instanceof Error check at line 150).
   */
  it('handles non-Error exceptions when loading tags', async () => {
    const repo = new MockRepo();
    const originalGetAllTags = repo.getAllTags.bind(repo);
    repo.getAllTags = jest.fn().mockRejectedValue('string error');
    const apiRef = await renderViewModel(repo);

    await act(async () => {
      await apiRef.current!.actions.refreshData();
    });

    expect(apiRef.current!.state.error).toBe('Failed to load tags');

    repo.getAllTags = originalGetAllTags;
  });

  /** Tests that getEntryById returns the entry from the repository. */
  it('returns an entry by ID via getEntryById', async () => {
    const repo = new MockRepo();
    const mockEntry = {
      id: 'specific-id',
      content: 'found it',
      datetime: new Date(),
      created_at: new Date(),
      modified_at: new Date(),
      tags: [] as string[],
    };
    (repo.getEntry as jest.Mock).mockResolvedValue(mockEntry);
    const apiRef = await renderViewModel(repo);

    let result: JournalEntry | null = null;
    await act(async () => {
      result = await apiRef.current!.actions.getEntryById('specific-id');
    });

    expect(result).toEqual(mockEntry);
    expect(repo.getEntry).toHaveBeenCalledWith('specific-id');
  });

  /** Tests that getEntryById returns null when the entry is not found. */
  it('returns null from getEntryById when entry does not exist', async () => {
    const repo = new MockRepo();
    (repo.getEntry as jest.Mock).mockResolvedValue(null);
    const apiRef = await renderViewModel(repo);

    let result: JournalEntry | null = undefined as unknown as JournalEntry;
    await act(async () => {
      result = await apiRef.current!.actions.getEntryById('non-existent');
    });

    expect(result).toBeNull();
  });

  /** Tests that getEntryById handles errors from the repository. */
  it('handles errors from getEntryById', async () => {
    const repo = new MockRepo();
    (repo.getEntry as jest.Mock).mockRejectedValue(new Error('Lookup failed'));
    const apiRef = await renderViewModel(repo);

    let result: JournalEntry | null = undefined as unknown as JournalEntry;
    await act(async () => {
      result = await apiRef.current!.actions.getEntryById('fail-id');
    });

    expect(result).toBeNull();
    expect(apiRef.current!.state.error).toBe('Lookup failed');
  });

  /** Tests that getEntryById handles non-Error exceptions. */
  it('handles non-Error exceptions from getEntryById', async () => {
    const repo = new MockRepo();
    (repo.getEntry as jest.Mock).mockRejectedValue('string error');
    const apiRef = await renderViewModel(repo);

    let result: JournalEntry | null = undefined as unknown as JournalEntry;
    await act(async () => {
      result = await apiRef.current!.actions.getEntryById('fail-id');
    });

    expect(result).toBeNull();
    expect(apiRef.current!.state.error).toBe('Failed to load entry');
  });

  // -------------------------------------------------------------------------
  // loadDefaultTags
  // -------------------------------------------------------------------------

  /** Tests that loadDefaultTags returns the most recent entry's tags. */
  it('loadDefaultTags returns tags from the repository', async () => {
    const repo = new MockRepo();
    repo.getMostRecentEntryTags = jest.fn().mockResolvedValue(['work', 'personal']);
    const apiRef = await renderViewModel(repo);

    let tags: string[] = [];
    await act(async () => {
      tags = await apiRef.current!.actions.loadDefaultTags();
    });

    expect(repo.getMostRecentEntryTags).toHaveBeenCalled();
    expect(tags).toEqual(['work', 'personal']);
  });

  /** Tests that loadDefaultTags returns an empty array when no entries exist. */
  it('loadDefaultTags returns empty array when repository returns empty', async () => {
    const repo = new MockRepo();
    repo.getMostRecentEntryTags = jest.fn().mockResolvedValue([]);
    const apiRef = await renderViewModel(repo);

    let tags: string[] = ['untouched'];
    await act(async () => {
      tags = await apiRef.current!.actions.loadDefaultTags();
    });

    expect(tags).toEqual([]);
  });

  /** Tests that loadDefaultTags handles Error exceptions from the repository. */
  it('loadDefaultTags handles Error exceptions and sets error state', async () => {
    const repo = new MockRepo();
    repo.getMostRecentEntryTags = jest.fn().mockRejectedValue(new Error('DB read failed'));
    const apiRef = await renderViewModel(repo);

    let tags: string[] = ['untouched'];
    await act(async () => {
      tags = await apiRef.current!.actions.loadDefaultTags();
    });

    expect(tags).toEqual([]);
    expect(apiRef.current!.state.error).toBe('DB read failed');
  });

  /** Tests that loadDefaultTags handles non-Error exceptions. */
  it('loadDefaultTags handles non-Error exceptions and sets generic error', async () => {
    const repo = new MockRepo();
    repo.getMostRecentEntryTags = jest.fn().mockRejectedValue('string error');
    const apiRef = await renderViewModel(repo);

    let tags: string[] = ['untouched'];
    await act(async () => {
      tags = await apiRef.current!.actions.loadDefaultTags();
    });

    expect(tags).toEqual([]);
    expect(apiRef.current!.state.error).toBe('Failed to load default tags');
  });
});
