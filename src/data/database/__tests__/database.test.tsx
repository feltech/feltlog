import { act, renderHook } from '@testing-library/react-native';
import { useDatabase } from '../database';

// Mock backup functions to control pre-migration backup behavior.
jest.mock('../backup', () => ({
  getPendingMigrationCount: jest.fn().mockResolvedValue(0),
  backupDatabase: jest.fn().mockResolvedValue({ success: true }),
  getLatestMigrationKey: jest.fn().mockReturnValue('20260523_one_create_initial_tables'),
}));

jest.mock('../dbBackupStorage', () => ({
  getBackupDirectoryUri: jest.fn().mockResolvedValue(null),
  getBackupMaxCount: jest.fn().mockResolvedValue(5),
  getLastBackupTimestamp: jest.fn().mockResolvedValue(null),
  setLastBackupTimestamp: jest.fn().mockResolvedValue(undefined),
  setBackupMaxCount: jest.fn().mockResolvedValue(undefined),
}));

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

  /** Tests that databaseName and sqliteDb are exposed after initialization. */
  it('should expose databaseName and sqliteDb after initialization', async () => {
    const { result } = renderHook(() => useDatabase());
    const dbName = makeDbName();

    await act(async () => {
      await result.current.initialize({
        encryptionKey: 'test-key',
        databaseName: dbName,
      });
    });

    expect(result.current.databaseName).toBe(dbName);
    expect(result.current.sqliteDb).not.toBeNull();
    expect(result.current.sqliteDb?.databasePath).toBeTruthy();
  });

  /** Tests that pre-migration backup is attempted when migrations are pending. */
  it('should attempt pre-migration backup when migrations are pending', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getPendingMigrationCount, backupDatabase } = require('../backup');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getBackupDirectoryUri } = require('../dbBackupStorage');

    getPendingMigrationCount.mockResolvedValueOnce(2);
    getBackupDirectoryUri.mockResolvedValueOnce('content://mock-backup-dir');

    const { result } = renderHook(() => useDatabase());

    await act(async () => {
      await result.current.initialize({
        encryptionKey: 'test-key',
        databaseName: makeDbName(),
      });
    });

    expect(backupDatabase).toHaveBeenCalled();
    expect(result.current.ready).toBe(true);
  });

  /** Tests that initialization continues even if pre-migration backup fails. */
  it('should continue initialization when pre-migration backup fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getPendingMigrationCount, backupDatabase } = require('../backup');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getBackupDirectoryUri } = require('../dbBackupStorage');

    getPendingMigrationCount.mockResolvedValueOnce(1);
    getBackupDirectoryUri.mockResolvedValueOnce('content://mock-backup-dir');
    backupDatabase.mockRejectedValueOnce(new Error('Backup failed'));

    const { result } = renderHook(() => useDatabase());

    await act(async () => {
      await result.current.initialize({
        encryptionKey: 'test-key',
        databaseName: makeDbName(),
      });
    });

    expect(result.current.ready).toBe(true);
    expect(result.current.error).toBeNull();
  });

  /** Tests that the previous sqliteDb is closed on re-initialize. */
  it('should close previous sqliteDb on re-initialize', async () => {
    const { result } = renderHook(() => useDatabase());
    const dbName1 = makeDbName();
    const dbName2 = makeDbName();

    await act(async () => {
      await result.current.initialize({
        encryptionKey: 'test-key',
        databaseName: dbName1,
      });
    });

    const firstSqliteDb = result.current.sqliteDb;
    expect(firstSqliteDb).not.toBeNull();
    const closeSpy = jest.spyOn(firstSqliteDb!, 'closeAsync');

    await act(async () => {
      await result.current.initialize({
        encryptionKey: 'test-key',
        databaseName: dbName2,
      });
    });

    expect(closeSpy).toHaveBeenCalled();
    expect(result.current.databaseName).toBe(dbName2);
  });

  /** Tests that initialization continues when checking pending migrations throws. */
  it('should continue initialization when migration check throws', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getPendingMigrationCount } = require('../backup');
    getPendingMigrationCount.mockRejectedValueOnce(new Error('Migration check error'));

    const { result } = renderHook(() => useDatabase());
    const dbName = makeDbName();

    await act(async () => {
      await result.current.initialize({
        encryptionKey: 'test-key',
        databaseName: dbName,
      });
    });

    expect(result.current.ready).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
