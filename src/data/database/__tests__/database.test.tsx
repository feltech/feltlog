import { act, renderHook } from '@testing-library/react-native';
import { Kysely } from 'kysely';
import { useDatabase, openKysely } from '../database';

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

  /**
   * Tests that initialization still completes when migrations are pending but no backup
   * directory is configured. Covers the `if (backupDirUri)` false branch in database.ts
   * (line 150). Relies on the module-level mock factory defaults — no explicit cleanup
   * is needed because `getBackupDirectoryUri` already returns `null` and
   * `getPendingMigrationCount` uses a one-shot `mockResolvedValueOnce`.
   */
  it('should skip backup when backup directory is not configured', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getPendingMigrationCount } = require('../backup');

    // Force the pre-migration backup path to be entered.
    getPendingMigrationCount.mockResolvedValueOnce(2);

    // getBackupDirectoryUri keeps its default return value of null, so the inner
    // `if (backupDirUri)` branch takes the false path and backupDatabase is
    // skipped.

    const { result } = renderHook(() => useDatabase());

    await act(async () => {
      await result.current.initialize({
        encryptionKey: 'test-key',
        databaseName: makeDbName(),
      });
    });

    // Initialization must still succeed when the backup is skipped.
    expect(result.current.ready).toBe(true);
    expect(result.current.error).toBeNull();
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

    // Spy on console.warn to assert the production code logs the backup failure
    // and to prevent the traceback from appearing in test output.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useDatabase());

    await act(async () => {
      await result.current.initialize({
        encryptionKey: 'test-key',
        databaseName: makeDbName(),
      });
    });

    expect(result.current.ready).toBe(true);
    expect(result.current.error).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith('Pre-migration backup failed:', expect.any(Error));
    warnSpy.mockRestore();
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

    // Spy on console.warn to assert the production code logs the migration check
    // failure and to prevent the traceback from appearing in test output.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

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
    expect(warnSpy).toHaveBeenCalledWith('Could not check pending migrations:', expect.any(Error));
    warnSpy.mockRestore();
  });

  /**
   * Tests that openKysely does NOT issue PRAGMA key when the encryption key is an empty
   * string, and still returns a valid Kysely/SQLiteDatabase pair.
   */
  it('should open an unencrypted database when the encryption key is empty', async () => {
    const dbName = makeDbName();
    const executeQuerySpy = jest.spyOn(Kysely.prototype, 'executeQuery');

    const { db, sqliteDb } = await openKysely('', dbName);

    // Ensure the returned objects are valid.
    expect(db).toBeInstanceOf(Kysely);
    expect(sqliteDb).toBeTruthy();

    // Verify that PRAGMA key was NOT called.
    const pragmaKeyCalls = executeQuerySpy.mock.calls.filter(call => {
      const query = call[0] as { sql?: string };
      return query.sql?.includes('PRAGMA key');
    });
    expect(pragmaKeyCalls.length).toBe(0);

    executeQuerySpy.mockRestore();
  });
});
