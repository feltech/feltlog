import React from 'react';
import {act, render} from '@testing-library/react-native';
import {RepositoryProvider} from '@/src/domain/repositories/RepositoryContext';
import {useJournalViewModel} from '../JournalViewModel';
import type {JournalRepository} from '@/src/domain/repositories/JournalRepository';
import type {JournalEntry, Tag} from '@/src/domain/entities/JournalEntry';

class MockRepo implements JournalRepository {
  // State for assertions
  getAllEntriesCalls = 0;
  searchEntriesCalls = 0;

  // Unused methods mocked
  createEntry = jest.fn();
  updateEntry = jest.fn();
  deleteEntry = jest.fn();
  getEntry = jest.fn(async () => null);
  getEntriesByTags = jest.fn(async () => []);
  getAllTags = jest.fn(async () => [] as Tag[]);
  createTag = jest.fn();
  getOrCreateTag = jest.fn();
  deleteTag = jest.fn();
  getTagsForEntry = jest.fn();

  async getAllEntries(): Promise<JournalEntry[]> {
    this.getAllEntriesCalls++;
    return [];
  }

  async searchEntries(): Promise<JournalEntry[]> {
    this.searchEntriesCalls++;
    return [];
  }
}

function Harness({onReady}: { onReady: (api: any) => void }) {
  const api = useJournalViewModel();
  React.useEffect(() => onReady(api), [api, onReady]);
  return null;
}

describe('JournalViewModel', () => {
  it('calls repository methods at most once per action', async () => {
    const repo = new MockRepo();
    let vm: ReturnType<typeof useJournalViewModel> | null = null;

    render(
      <RepositoryProvider repository={repo as unknown as JournalRepository}>
        <Harness repo={repo as unknown as JournalRepository} onReady={(api) => {
          vm = api;
        }}/>
      </RepositoryProvider>
    );

    // Initial mount should load entries at least once.
    await act(async () => {
    });
    expect(repo.getAllEntriesCalls).toBeGreaterThanOrEqual(1);
    const initialCalls = repo.getAllEntriesCalls;

    // Trigger a search; should call searchEntries once.
    await act(async () => {
      await vm!.actions.search('hello');
    });

    await act(async () => {
    });
    expect(repo.searchEntriesCalls).toBe(1);

    // Ensure no runaway repeated loading after this point.
    await act(async () => {
    });
    expect(repo.getAllEntriesCalls).toBe(initialCalls);
  });

  it('does not call load more when entries are empty', async () => {
    const repo = new MockRepo();
    let vm: ReturnType<typeof useJournalViewModel> | null = null;

    render(
      <RepositoryProvider repository={repo as unknown as JournalRepository}>
        <Harness repo={repo as unknown as JournalRepository} onReady={(api) => {
          vm = api;
        }}/>
      </RepositoryProvider>
    );

    // Initial refresh
    await act(async () => {
    });
    const initialCalls = repo.getAllEntriesCalls;

    // Try to load more with empty entries; should be a no-op
    await act(async () => {
      await vm!.actions.loadMoreEntries();
    });

    expect(repo.getAllEntriesCalls).toBe(initialCalls);
  });
});
