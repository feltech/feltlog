// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-file-system/legacy', () => require('../../../test-utils/expo-file-system-mock'));

const mockOpenDatabaseAsync = jest.fn();
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: (...args: unknown[]) => mockOpenDatabaseAsync(...args),
}));

import * as ExpoFileSystem from 'expo-file-system/legacy';
const { __resetMockFiles, __setMockFile } = ExpoFileSystem as unknown as {
  __resetMockFiles: () => void;
  __setMockFile: (
    uri: string,
    data: { modificationTime: number; size: number; content?: string },
  ) => void;
};

import { restoreDatabase } from '../restore';

/**
 * Test suite for the restoreDatabase helper. Covers the happy path, missing source
 * file, write failures, and the contract that the function does not reopen the database
 * itself.
 */
describe('restoreDatabase', () => {
  beforeEach(() => {
    __resetMockFiles();
    jest.clearAllMocks();
  });

  /** Tests a successful restore to a target database path. */
  it('reads a backup file and writes it to the target db path', async () => {
    const targetDbName = 'target.db';
    const sourceUri = 'content://mock-saf-directory/feltlog-backup.db';
    const targetPath = 'file:///mock/target.db';

    __setMockFile(sourceUri, {
      modificationTime: 1000,
      size: 12,
      content: 'YmFzZTY0ZGF0YQ==',
    });

    mockOpenDatabaseAsync.mockResolvedValue({
      databasePath: '/mock/target.db',
      closeAsync: jest.fn().mockResolvedValue(undefined),
    });

    const result = await restoreDatabase(targetDbName, 'any-key', sourceUri);

    expect(result.success).toBe(true);
    expect(mockOpenDatabaseAsync).toHaveBeenCalledWith(targetDbName);

    // Verify the target file was written.
    const targetInfo = await ExpoFileSystem.getInfoAsync(targetPath);
    expect(targetInfo.exists).toBe(true);
  });

  /** Tests that restoreDatabase returns an error when the source file is missing. */
  it('returns an error when the source file is missing', async () => {
    const targetDbName = 'target.db';
    const sourceUri = 'content://mock-saf-directory/missing.db';

    mockOpenDatabaseAsync.mockResolvedValue({
      databasePath: '/mock/target.db',
      closeAsync: jest.fn().mockResolvedValue(undefined),
    });

    const result = await restoreDatabase(targetDbName, 'any-key', sourceUri);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Mock file not found');
  });

  /** Tests that restoreDatabase returns an error when the write fails. */
  it('returns an error when writing to the target path fails', async () => {
    const targetDbName = 'target.db';
    const sourceUri = 'content://mock-saf-directory/feltlog-backup.db';

    __setMockFile(sourceUri, {
      modificationTime: 1000,
      size: 12,
      content: 'YmFzZTY0ZGF0YQ==',
    });

    mockOpenDatabaseAsync.mockResolvedValue({
      databasePath: '/mock/target.db',
      closeAsync: jest.fn().mockResolvedValue(undefined),
    });

    // Force writeAsStringAsync to throw.
    (ExpoFileSystem.writeAsStringAsync as jest.Mock).mockRejectedValueOnce(new Error('Disk full'));

    const result = await restoreDatabase(targetDbName, 'any-key', sourceUri);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Disk full');
  });

  /**
   * Tests that restoreDatabase does not attempt to reopen the database. The function's
   * only responsibility is file-level copy; reopening is left to the caller.
   */
  it('does not itself reopen the database (no executeQuery side effects)', async () => {
    const targetDbName = 'target.db';
    const sourceUri = 'content://mock-saf-directory/feltlog-backup.db';
    const closeAsync = jest.fn().mockResolvedValue(undefined);

    __setMockFile(sourceUri, {
      modificationTime: 1000,
      size: 12,
      content: 'YmFzZTY0ZGF0YQ==',
    });

    mockOpenDatabaseAsync.mockResolvedValue({
      databasePath: '/mock/target.db',
      closeAsync,
    });

    await restoreDatabase(targetDbName, 'any-key', sourceUri);

    // openDatabaseAsync is called only to discover the path, not to keep the
    // connection open.
    expect(closeAsync).toHaveBeenCalled();
  });

  /**
   * Tests that restoreDatabase falls back to String(error) when the thrown value is not
   * an Error instance. Covers the second branch of the catch block.
   */
  it('returns the stringified error when a non-Error value is thrown', async () => {
    const targetDbName = 'target.db';
    const sourceUri = 'content://mock-saf-directory/feltlog-backup.db';

    __setMockFile(sourceUri, {
      modificationTime: 1000,
      size: 12,
      content: 'YmFzZTY0ZGF0YQ==',
    });

    mockOpenDatabaseAsync.mockResolvedValue({
      databasePath: '/mock/target.db',
      closeAsync: jest.fn().mockResolvedValue(undefined),
    });

    // Force readAsStringAsync to throw a non-Error value.
    (ExpoFileSystem.readAsStringAsync as jest.Mock).mockRejectedValueOnce('disk is sad');

    const result = await restoreDatabase(targetDbName, 'any-key', sourceUri);

    expect(result.success).toBe(false);
    expect(result.error).toBe('disk is sad');
  });
});
