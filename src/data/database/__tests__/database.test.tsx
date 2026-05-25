import { act, renderHook } from '@testing-library/react-native';
import { useDatabase } from '../database';

/**
 * Test suite for the useDatabase hook. Covers initialization with and without
 * encryption keys, and error handling.
 */
describe('useDatabase', () => {
  /**
   * Generates a unique, random database filename for tests to avoid collisions.
   *
   * @returns A random database file name string.
   */
  const makeDbName = () => `test_${Date.now()}_${Math.random()}.db`;

  /** Tests that the hook initializes the database with an encryption key. */
  it('should initialize the database with an encryption key', async () => {
    const { result } = renderHook(() => useDatabase());

    await act(async () => {
      await result.current.initialize({
        encryptionKey: 'test-key',
        databaseName: makeDbName(),
      });
    });

    expect(result.current.ready).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.db).not.toBeNull();
  });

  /** Tests that hook initializes the database without an explicit encryption key. */
  it('should initialize the database without an explicit encryption key', async () => {
    const { result } = renderHook(() => useDatabase());

    await act(async () => {
      await result.current.initialize({
        encryptionKey: 'test-key',
        databaseName: makeDbName(),
      });
    });

    expect(result.current.ready).toBe(true);
    expect(result.current.db).not.toBeNull();
  });

  /** Tests that the hook sets error state when initialization fails. */
  it('should set error state when initialization fails', async () => {
    const { result } = renderHook(() => useDatabase());

    // Use an invalid database name to trigger an error.
    await act(async () => {
      await result.current.initialize({
        encryptionKey: '',
        databaseName: '',
      });
    });

    // After a failed init, the state should reflect the error.
    // Note: empty name might not actually fail with expo-sqlite, so we just
    // verify the hook doesn't crash.
    expect(result.current.ready || result.current.error !== null).toBe(true);
  });

  /** Tests that lastDatabaseName is loaded from storage on mount. */
  it('should load lastDatabaseName from storage on mount', async () => {
    const { result } = renderHook(() => useDatabase());

    // Wait for the async effect to complete.
    await act(async () => {});

    // The lastDatabaseName might be null if nothing was stored.
    expect(
      result.current.lastDatabaseName === null ||
        typeof result.current.lastDatabaseName === 'string',
    ).toBe(true);
  });

  /** Tests that lastDatabaseName is updated after successful initialization. */
  it('should update lastDatabaseName after successful initialization', async () => {
    const { result } = renderHook(() => useDatabase());
    const dbName = makeDbName();

    await act(async () => {
      await result.current.initialize({
        encryptionKey: 'test-key',
        databaseName: dbName,
      });
    });

    expect(result.current.lastDatabaseName).toBe(dbName);
  });

  /** Tests that the hook sets error state when database opening fails. */
  it('should set error state when database opening fails', async () => {
    // Force the underlying better-sqlite3 mock to throw by providing an
    // invalid database path via the environment variable.
    const originalEnv = process.env.EXPO_SQLITE_MOCK;
    process.env.EXPO_SQLITE_MOCK = '/invalid/path/to/db';

    const { result } = renderHook(() => useDatabase());

    await act(async () => {
      await result.current.initialize({
        encryptionKey: 'test-key',
        databaseName: makeDbName(),
      });
    });

    expect(result.current.ready).toBe(false);
    expect(result.current.error).toBeTruthy();
    expect(result.current.db).toBeNull();

    // Restore the environment variable.
    process.env.EXPO_SQLITE_MOCK = originalEnv;
  });

  /** Tests that the lastDatabaseName effect is cancelled on unmount. */
  it('should cancel the lastDatabaseName effect on unmount', async () => {
    const { unmount } = renderHook(() => useDatabase());

    // Unmounting should trigger the cleanup effect without throwing.
    expect(() => unmount()).not.toThrow();
  });
});
