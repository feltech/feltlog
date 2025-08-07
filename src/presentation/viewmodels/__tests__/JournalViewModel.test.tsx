import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useJournalViewModel } from '../JournalViewModel';
import { DatabaseInitializer } from '@/src/infrastructure/database/DatabaseInitializer';
import { DatabaseConnection } from '@/src/data/database/connection';

describe('JournalViewModel', () => {
  beforeEach(async () => {
    DatabaseInitializer.reset();
    const testDbName = `test_${Date.now()}_${Math.random()}.db`;
    await DatabaseInitializer.initialize(undefined, testDbName);
  });

  afterEach(async () => {
    const dbConnection = DatabaseConnection.getInstance();
    await dbConnection.close();
    DatabaseInitializer.reset();
  });

  it('should initialize and create entry', async () => {
    const { result } = renderHook(() => useJournalViewModel());

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.state.loading).toBe(false);
    }, {timeout: 1000});

    expect(result.current.state.error).toBe(null);
    expect(result.current.state.entries).toEqual([]);

    // Create entry
    let createdEntry: any;
    await act(async () => {
      createdEntry = await result.current.actions.createEntry(
        'Test entry content',
        new Date('2024-01-01T10:00:00Z'),
        ['test', 'journal']
      );
    });

    expect(createdEntry).toBeDefined();
    expect(createdEntry.content).toBe('Test entry content');
    expect(createdEntry.tags.sort()).toEqual(['test', 'journal'].sort());

    // Check state is updated
    await waitFor(() => {
      expect(result.current.state.entries).toHaveLength(1);
      expect(result.current.state.entries[0].content).toBe('Test entry content');
    }, { timeout: 5000 });
  });

  it('should handle empty content error', async () => {
    const { result } = renderHook(() => useJournalViewModel());

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.state.loading).toBe(false);
    });

    // Try to create entry with empty content (should fail)
    let entry: any;
    await act(async () => {
      entry = await result.current.actions.createEntry('', new Date(), []);
    });

    expect(entry).toBeNull();
    expect(result.current.state.error).toBe('Content cannot be empty');
  });
});
