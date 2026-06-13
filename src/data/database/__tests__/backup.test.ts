// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-file-system/legacy', () => require('../../../test-utils/expo-file-system-mock'));

const mockSqlExecute = jest.fn();
jest.mock('kysely', () => ({
  ...jest.requireActual('kysely'),
  sql: Object.assign(
    jest.fn(() => ({ execute: mockSqlExecute })),
    {},
  ),
}));

import * as ExpoFileSystem from 'expo-file-system/legacy';
const { __resetMockFiles, __setMockFile } = ExpoFileSystem as unknown as {
  __resetMockFiles: () => void;
  __setMockFile: (
    uri: string,
    data: { modificationTime: number; size: number; content?: string },
  ) => void;
};
import {
  ensureFileUri,
  getLatestMigrationKey,
  getPendingMigrationCount,
  buildBackupFileName,
  extractFileName,
  isBackupStale,
  rotateBackups,
  backupDatabase,
  performLifecycleBackup,
} from '../backup';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Kysely } from 'kysely';

// Mock console.warn to keep test output clean.
const originalWarn = console.warn;
beforeAll(() => {
  console.warn = jest.fn();
});
afterAll(() => {
  console.warn = originalWarn;
});

/**
 * Test suite for backup logic. Covers migration key extraction, pending migration
 * counting, filename generation, staleness checks, backup rotation, database backup
 * operations, and lifecycle backup orchestration.
 */
describe('backup', () => {
  beforeEach(async () => {
    __resetMockFiles();
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  // -------------------------------------------------------------------------
  // ensureFileUri
  // -------------------------------------------------------------------------

  /** Tests that ensureFileUri prepends file:// to raw paths and leaves URIs unchanged. */
  it('ensureFileUri prepends file:// to raw paths and preserves existing URIs', () => {
    expect(ensureFileUri('/data/data/test.db')).toBe('file:///data/data/test.db');
    expect(ensureFileUri('file:///data/data/test.db')).toBe('file:///data/data/test.db');
  });

  // -------------------------------------------------------------------------
  // getLatestMigrationKey
  // -------------------------------------------------------------------------

  /** Tests that getLatestMigrationKey returns the last sorted key. */
  it('returns the latest migration key', () => {
    expect(getLatestMigrationKey()).toBe('20260523_one_create_initial_tables');
  });

  /** Tests that getLatestMigrationKey returns 'unknown' when MIGRATIONS is empty. */
  it('returns unknown when MIGRATIONS is empty', () => {
    jest.isolateModules(() => {
      jest.doMock('../migrations', () => ({ MIGRATIONS: {} }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getLatestMigrationKey: getKey } = require('../backup');
      expect(getKey()).toBe('unknown');
    });
  });

  // -------------------------------------------------------------------------
  // getPendingMigrationCount
  // -------------------------------------------------------------------------

  /** Tests that getPendingMigrationCount returns total count when table is missing. */
  it('returns total count when kysely_migration table does not exist', async () => {
    mockSqlExecute.mockRejectedValueOnce(new Error('no such table'));
    const mockDb = {} as unknown as Kysely<unknown>;
    expect(await getPendingMigrationCount(mockDb)).toBe(1);
  });

  /** Tests that getPendingMigrationCount returns 0 when all migrations are applied. */
  it('returns zero when all migrations are applied', async () => {
    mockSqlExecute.mockResolvedValueOnce({
      rows: [{ name: '20260523_one_create_initial_tables' }],
    });
    const mockDb = {} as unknown as Kysely<unknown>;
    expect(await getPendingMigrationCount(mockDb)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // buildBackupFileName
  // -------------------------------------------------------------------------

  /** Tests that buildBackupFileName generates a correctly formatted filename. */
  it('generates a timestamped backup filename with version', () => {
    const fileName = buildBackupFileName('20260523_one_create_initial_tables');
    expect(fileName).toMatch(/^feltlog-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-v20260523\.db$/);
  });

  /** Tests that buildBackupFileName includes dbName when provided. */
  it('includes dbName in the filename when provided', () => {
    const fileName = buildBackupFileName('20260523_one_create_initial_tables', 'mydata.db');
    expect(fileName).toMatch(
      /^feltlog-mydata\.db-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-v20260523\.db$/,
    );
  });

  /** Tests that buildBackupFileName includes a tag when provided. */
  it('includes a tag in the filename when provided', () => {
    const fileName = buildBackupFileName(
      '20260523_one_create_initial_tables',
      'mydata.db',
      'before_restore_backup',
    );
    expect(fileName).toMatch(
      /^feltlog-mydata\.db\.before_restore_backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-v20260523\.db$/,
    );
  });

  // -------------------------------------------------------------------------
  // extractFileName
  // -------------------------------------------------------------------------

  /** Tests that extractFileName handles both file:// and content:// URIs. */
  it('extracts filename from file:// and content:// URIs', () => {
    expect(extractFileName('file:///data/data/feltlog-backup.db')).toBe('feltlog-backup.db');
    expect(
      extractFileName(
        'content://com.android.externalstorage.documents/tree/primary%3ABackups/document/primary%3ABackups%2Ffeltlog-backup.db',
      ),
    ).toBe('feltlog-backup.db');
  });

  /** Tests that extractFileName handles URL-encoded characters and edge cases. */
  it('handles URL-encoded characters and edge cases', () => {
    expect(extractFileName('content://saf/dir/feltlog-file%20name.db')).toBe(
      'feltlog-file name.db',
    );
    expect(extractFileName('nosegments')).toBe('nosegments');
  });

  /** Tests that extractFileName returns the full URI when the last segment is empty. */
  it('returns the full URI when the last segment is empty (trailing slash)', () => {
    expect(extractFileName('content://saf/dir/')).toBe('content://saf/dir/');
  });

  // -------------------------------------------------------------------------
  // isBackupStale
  // -------------------------------------------------------------------------

  /** Tests that isBackupStale returns true when no backup has been made. */
  it('returns true when no backup timestamp exists', async () => {
    __setMockFile('file:///mock/db.db', { modificationTime: 1000, size: 100 });
    expect(await isBackupStale('/mock/db.db')).toBe(true);
  });

  /** Tests that isBackupStale returns true when DB is newer than last backup. */
  it('returns true when DB is newer than last backup', async () => {
    await AsyncStorage.setItem('feltlog.lastBackupTimestamp', '2026-01-01T00:00:00.000Z');
    __setMockFile('file:///mock/db.db', { modificationTime: 1800000000, size: 100 });
    expect(await isBackupStale('/mock/db.db')).toBe(true);
  });

  /** Tests that isBackupStale returns false when backup is up to date. */
  it('returns false when backup is up to date', async () => {
    const futureDate = new Date('2099-01-01T00:00:00.000Z');
    await AsyncStorage.setItem('feltlog.lastBackupTimestamp', futureDate.toISOString());
    __setMockFile('file:///mock/db.db', { modificationTime: 1000, size: 100 });
    expect(await isBackupStale('/mock/db.db')).toBe(false);
  });

  /** Tests that isBackupStale returns true when the DB file does not exist. */
  it('returns true when DB file does not exist', async () => {
    await AsyncStorage.setItem('feltlog.lastBackupTimestamp', '2026-01-01T00:00:00.000Z');
    expect(await isBackupStale('/mock/nonexistent.db')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // rotateBackups
  // -------------------------------------------------------------------------

  /** Tests that rotateBackups keeps the newest N files and deletes the rest. */
  it('keeps the newest N backup files and deletes older ones', async () => {
    const dirUri = 'content://mock-saf-directory';
    __setMockFile(`${dirUri}/feltlog-2026-01-01T10-00-00Z-v20260523.db`, {
      modificationTime: 1000,
      size: 10,
    });
    __setMockFile(`${dirUri}/feltlog-2026-01-02T10-00-00Z-v20260523.db`, {
      modificationTime: 2000,
      size: 10,
    });
    __setMockFile(`${dirUri}/feltlog-2026-01-03T10-00-00Z-v20260523.db`, {
      modificationTime: 500,
      size: 10,
    });

    await rotateBackups(dirUri, 1);

    // Only the newest (by filename) should remain.
    const infoNewest = await ExpoFileSystem.getInfoAsync(
      `${dirUri}/feltlog-2026-01-03T10-00-00Z-v20260523.db`,
    );
    expect(infoNewest.exists).toBe(true);

    const infoMiddle = await ExpoFileSystem.getInfoAsync(
      `${dirUri}/feltlog-2026-01-02T10-00-00Z-v20260523.db`,
    );
    expect(infoMiddle.exists).toBe(false);

    const infoOldest = await ExpoFileSystem.getInfoAsync(
      `${dirUri}/feltlog-2026-01-01T10-00-00Z-v20260523.db`,
    );
    expect(infoOldest.exists).toBe(false);
  });

  /** Tests that rotateBackups handles an empty directory gracefully. */
  it('handles empty directory gracefully', async () => {
    const dirUri = 'content://mock-saf-directory';
    await expect(rotateBackups(dirUri, 5)).resolves.not.toThrow();
  });

  /** Tests that rotateBackups skips rotation when readDirectoryAsync throws. */
  it('skips rotation when readDirectoryAsync throws', async () => {
    const dirUri = 'content://mock-saf-directory';
    (ExpoFileSystem.StorageAccessFramework.readDirectoryAsync as jest.Mock).mockRejectedValueOnce(
      new Error('Permission denied'),
    );
    await expect(rotateBackups(dirUri, 5)).resolves.not.toThrow();
  });

  // -------------------------------------------------------------------------
  // backupDatabase
  // -------------------------------------------------------------------------

  /** Tests a successful backup operation with dbName. */
  it('performs a successful backup with dbName in the filename', async () => {
    const dirUri = 'content://mock-saf-directory';
    __setMockFile('file:///mock/source.db', {
      modificationTime: 1000,
      size: 10,
      content: 'base64data',
    });

    const result = await backupDatabase(
      '/mock/source.db',
      dirUri,
      '20260523_one_create_initial_tables',
      'mydb.db',
    );

    expect(result.success).toBe(true);
    expect(result.fileName).toMatch(/^feltlog-mydb\.db-.*-v20260523\.db$/);

    // Verify backup timestamp was updated.
    const ts = await AsyncStorage.getItem('feltlog.lastBackupTimestamp');
    expect(ts).not.toBeNull();
  });

  /** Tests that backupDatabase returns error when source file is missing. */
  it('returns error when source file is missing', async () => {
    const dirUri = 'content://mock-saf-directory';
    const result = await backupDatabase('/mock/missing.db', dirUri);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Mock file not found');
  });

  /** Tests that backupDatabase returns error when an unexpected non-Error is thrown. */
  it('returns error when a plain string is thrown', async () => {
    const dirUri = 'content://mock-saf-directory';
    __setMockFile('file:///mock/source.db', {
      modificationTime: 1000,
      size: 10,
      content: 'base64data',
    });

    // Force readAsStringAsync to throw a plain string to cover String(error) branch.
    (ExpoFileSystem.readAsStringAsync as jest.Mock).mockImplementationOnce(() => {
      throw 'Plain string error';
    });

    const result = await backupDatabase('/mock/source.db', dirUri);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Plain string error');
  });

  /** Tests that concurrent backup calls are rejected. */
  it('rejects concurrent backup calls', async () => {
    const dirUri = 'content://mock-saf-directory';
    __setMockFile('file:///mock/source.db', {
      modificationTime: 1000,
      size: 10,
      content: 'base64data',
    });

    const promise1 = backupDatabase('/mock/source.db', dirUri);
    const promise2 = backupDatabase('/mock/source.db', dirUri);

    const [result1, result2] = await Promise.all([promise1, promise2]);

    // One should succeed, the other should be rejected as concurrent.
    const results = [result1, result2];
    expect(results.some(r => r.success)).toBe(true);
    expect(results.some(r => !r.success && r.error === 'Backup already in progress')).toBe(true);
  });

  /**
   * Tests that backupDatabase does not rotate old backups when the write fails.
   * Rotation should only happen after the new backup is confirmed written.
   */
  it('does not rotate old backups when write fails', async () => {
    const dirUri = 'content://mock-saf-directory';
    __setMockFile('file:///mock/source.db', {
      modificationTime: 1000,
      size: 10,
      content: 'base64data',
    });
    __setMockFile(`${dirUri}/feltlog-2026-01-01T10-00-00Z-v20260523.db`, {
      modificationTime: 1000,
      size: 10,
    });

    // Make the write fail — old backups should be preserved.
    (ExpoFileSystem.writeAsStringAsync as jest.Mock).mockRejectedValueOnce(new Error('Disk full'));

    const result = await backupDatabase('/mock/source.db', dirUri);
    expect(result.success).toBe(false);

    // The old backup should still exist because rotation happens after success.
    const infoOld = await ExpoFileSystem.getInfoAsync(
      `${dirUri}/feltlog-2026-01-01T10-00-00Z-v20260523.db`,
    );
    expect(infoOld.exists).toBe(true);
  });

  // -------------------------------------------------------------------------
  // performLifecycleBackup
  // -------------------------------------------------------------------------

  /** Tests that performLifecycleBackup skips when paths are missing. */
  it('skips when sourcePath or directoryUri is missing', async () => {
    expect(await performLifecycleBackup('', 'content://dir', 'key')).toBe('skipped');
    expect(await performLifecycleBackup('/mock/db', '', 'key')).toBe('skipped');
  });

  /** Tests that performLifecycleBackup skips when backup is not stale. */
  it('skips when backup is not stale', async () => {
    const dirUri = 'content://mock-saf-directory';
    const futureDate = new Date('2099-01-01T00:00:00.000Z');
    await AsyncStorage.setItem('feltlog.lastBackupTimestamp', futureDate.toISOString());
    __setMockFile('file:///mock/db.db', { modificationTime: 1000, size: 10 });

    expect(await performLifecycleBackup('/mock/db.db', dirUri, 'key')).toBe('skipped');
  });

  /** Tests that performLifecycleBackup returns saved on success. */
  it('returns saved when backup succeeds', async () => {
    const dirUri = 'content://mock-saf-directory';
    __setMockFile('file:///mock/db.db', {
      modificationTime: 1000,
      size: 10,
      content: 'base64data',
    });

    expect(await performLifecycleBackup('/mock/db.db', dirUri, 'key')).toBe('saved');
  });

  /** Tests that performLifecycleBackup returns failed when backup fails. */
  it('returns failed when backup fails', async () => {
    const dirUri = 'content://mock-saf-directory';
    // No mock file, so read will fail.
    expect(await performLifecycleBackup('/mock/db.db', dirUri, 'key')).toBe('failed');
  });
});
