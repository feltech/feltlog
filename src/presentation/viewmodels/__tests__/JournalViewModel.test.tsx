import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useJournalViewModel } from '../JournalViewModel';
import type { JournalRepository } from '@/src/domain/repositories/JournalRepository';
import type { JournalEntry, Tag } from '@/src/domain/entities/JournalEntry';
import { RepositoryProvider } from '@/src/domain/repositories/RepositoryContext';

type MockRepo = jest.Mocked<JournalRepository>;

function createMockRepo(): MockRepo {
  return {
    // entries
    createEntry: jest.fn(),
    updateEntry: jest.fn(),
    deleteEntry: jest.fn(),
    getEntry: jest.fn(),
    getAllEntries: jest.fn(),
    searchEntries: jest.fn(),
    getEntriesByTags: jest.fn(),
    // tags
    getAllTags: jest.fn(),
    createTag: jest.fn(),
    getOrCreateTag: jest.fn(),
    deleteTag: jest.fn(),
    getTagsForEntry: jest.fn(),
  } as unknown as MockRepo;
}

function makeEntry(partial: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: partial.id ?? 'e1',
    content: partial.content ?? 'content',
    datetime: partial.datetime ?? new Date('2024-01-01T10:00:00Z'),
    created_at: partial.created_at ?? new Date('2024-01-01T10:00:00Z'),
    modified_at: partial.modified_at ?? new Date('2024-01-01T10:00:00Z'),
    tags: partial.tags ?? [],
    location: partial.location,
  } as JournalEntry;
}

function makeTag(name: string): Tag { return { id: name, name }; }

describe('useJournalViewModel with repository from context', () => {
  const makeWrapper = (repo: MockRepo) => ({ children }: any) => (
    <RepositoryProvider repository={repo}>{children}</RepositoryProvider>
  );
  let repo: MockRepo;

  beforeEach(() => {
    jest.useFakeTimers();
    repo = createMockRepo();
    // defaults
    repo.getAllEntries.mockResolvedValue([]);
    repo.getAllTags.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('initializes by calling getAllEntries and getAllTags', async () => {
    const wrapper = makeWrapper(repo);
    const { result } = renderHook(() => useJournalViewModel(), { wrapper });

    await waitFor(() => expect(result.current.state.loading).toBe(false));

    expect(repo.getAllEntries).toHaveBeenCalledWith(0, 10);
    expect(repo.getAllTags).toHaveBeenCalledTimes(1);
    expect(result.current.state.entries).toEqual([]);
    expect(result.current.state.tags).toEqual([]);
  });

  it('createEntry calls repository and refreshes entries and tags', async () => {
    const created = makeEntry({ id: 'e1', content: 'Test entry content', tags: ['test', 'journal'] });
    repo.createEntry.mockResolvedValue(created);
    // After creation, loadEntries() will ask repo again; provide one entry
    repo.getAllEntries.mockResolvedValue([created]);

    const wrapper = makeWrapper(repo);
    const { result } = renderHook(() => useJournalViewModel(), { wrapper });
    await waitFor(() => expect(result.current.state.loading).toBe(false));

    let returned: any;
    await act(async () => {
      returned = await result.current.actions.createEntry(
        'Test entry content',
        new Date('2024-01-01T10:00:00Z'),
        ['test', 'journal']
      );
    });

    expect(repo.createEntry).toHaveBeenCalledWith({
      content: 'Test entry content',
      datetime: new Date('2024-01-01T10:00:00Z'),
      tags: ['test', 'journal'],
      location: undefined,
    });
    expect(returned).toEqual(created);

    // After creation it reloads entries and tags
    expect(repo.getAllEntries).toHaveBeenCalledWith(0, 10);
    expect(repo.getAllTags).toHaveBeenCalledTimes(1 + 1); // initial + after create

    await waitFor(() => {
      expect(result.current.state.entries).toEqual([created]);
    });
  });

  it('search uses searchEntries with correct parameters', async () => {
    const entry = makeEntry({ id: 'e2', content: 'found' });
    repo.searchEntries.mockResolvedValue([entry]);

    const wrapper = makeWrapper(repo);
    const { result } = renderHook(() => useJournalViewModel(), { wrapper });
    await waitFor(() => expect(result.current.state.loading).toBe(false));

    await act(async () => {
      await result.current.actions.search('foo');
    });

    expect(repo.searchEntries).toHaveBeenCalledWith('foo', 0, 10);
    await waitFor(() => expect(result.current.state.entries).toEqual([entry]));
  });

  it('filterByTags uses getEntriesByTags with correct parameters', async () => {
    const entry = makeEntry({ id: 'e3', content: 'tagged', tags: ['a', 'b'] });
    repo.getEntriesByTags.mockResolvedValue([entry]);

    const wrapper = makeWrapper(repo);
    const { result } = renderHook(() => useJournalViewModel(), { wrapper });
    await waitFor(() => expect(result.current.state.loading).toBe(false));

    await act(async () => {
      await result.current.actions.filterByTags(['a', 'b']);
    });

    expect(repo.getEntriesByTags).toHaveBeenCalledWith(['a', 'b'], 0, 10);
    await waitFor(() => expect(result.current.state.entries).toEqual([entry]));
  });

  it('rejects empty content without calling repository.createEntry', async () => {
    const wrapper = makeWrapper(repo);
    const { result } = renderHook(() => useJournalViewModel(), { wrapper });
    await waitFor(() => expect(result.current.state.loading).toBe(false));

    let returned: any;
    await act(async () => {
      returned = await result.current.actions.createEntry('   ');
    });

    expect(returned).toBeNull();
    expect(result.current.state.error).toBe('Content cannot be empty');
    expect(repo.createEntry).not.toHaveBeenCalled();
  });
});
