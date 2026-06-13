// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-file-system/legacy', () => require('../../../test-utils/expo-file-system-mock'));

const mockExecuteQuery = jest.fn();
const mockOpenKysely = jest.fn();
const mockCloseSqlite = jest.fn();

jest.mock('../database', () => ({
  openKysely: (...args: unknown[]) => mockOpenKysely(...args),
  closeSqlite: (...args: unknown[]) => mockCloseSqlite(...args),
}));

jest.mock('kysely', () => ({
  ...jest.requireActual('kysely'),
  CompiledQuery: {
    raw: (sql: string) => ({ sql }),
  },
}));

import { __resetMockFiles } from '../../../test-utils/expo-file-system-mock';
import { changeDatabaseEncryptionKey } from '../rekey';
import { copyAsync, deleteAsync } from 'expo-file-system/legacy';

/**
 * Test suite for the changeDatabaseEncryptionKey helper. Covers changing keys, adding
 * encryption, removing encryption, wrong current key, and the contract that the helper
 * does not itself reopen the database.
 */
describe('changeDatabaseEncryptionKey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecuteQuery.mockReset();
    mockOpenKysely.mockReset();
    mockCloseSqlite.mockReset();
    __resetMockFiles();
  });

  /** Tests changing the key on an encrypted database. */
  it('changes the key on an encrypted database', async () => {
    const sqliteDb = {
      closeAsync: jest.fn().mockResolvedValue(undefined),
      databasePath: '/path/to/test.db',
    };
    mockOpenKysely.mockResolvedValue({
      db: { executeQuery: mockExecuteQuery.mockResolvedValue(undefined) },
      sqliteDb,
    });
    mockCloseSqlite.mockResolvedValue(undefined);

    const result = await changeDatabaseEncryptionKey('old-key', 'new-key', 'test.db');

    expect(result.success).toBe(true);
    expect(mockOpenKysely).toHaveBeenCalledWith('old-key', 'test.db');
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    expect(mockExecuteQuery.mock.calls[0][0]).toEqual({ sql: "PRAGMA rekey='new-key'" });
    expect(mockCloseSqlite).toHaveBeenCalledWith(sqliteDb);
  });

  /** Tests adding encryption to an unencrypted database via sqlcipher_export. */
  it('adds encryption to an unencrypted database', async () => {
    const sqliteDb = {
      closeAsync: jest.fn().mockResolvedValue(undefined),
      databasePath: '/path/to/test.db',
    };
    mockOpenKysely.mockResolvedValue({
      db: { executeQuery: mockExecuteQuery.mockResolvedValue(undefined) },
      sqliteDb,
    });
    mockCloseSqlite.mockResolvedValue(undefined);
    (copyAsync as jest.Mock).mockResolvedValue(undefined);
    (deleteAsync as jest.Mock).mockResolvedValue(undefined);

    const result = await changeDatabaseEncryptionKey('', 'new-key', 'test.db');

    expect(result.success).toBe(true);
    expect(mockOpenKysely).toHaveBeenCalledWith('', 'test.db');
    expect(mockExecuteQuery).toHaveBeenCalledTimes(3);
    expect(mockExecuteQuery.mock.calls[0][0]).toEqual({
      sql: "ATTACH DATABASE '/path/to/test.db.tmp' AS new KEY 'new-key'",
    });
    expect(mockExecuteQuery.mock.calls[1][0]).toEqual({
      sql: "SELECT sqlcipher_export('new')",
    });
    expect(mockExecuteQuery.mock.calls[2][0]).toEqual({
      sql: 'DETACH DATABASE new',
    });
    expect(mockCloseSqlite).toHaveBeenCalledWith(sqliteDb);
    expect(copyAsync).toHaveBeenCalledWith({
      from: 'file:///path/to/test.db.tmp',
      to: 'file:///path/to/test.db',
    });
    expect(deleteAsync).toHaveBeenCalledWith('file:///path/to/test.db.tmp');
  });

  /** Tests removing encryption from an encrypted database via sqlcipher_export. */
  it('removes encryption from an encrypted database', async () => {
    const sqliteDb = {
      closeAsync: jest.fn().mockResolvedValue(undefined),
      databasePath: '/path/to/test.db',
    };
    mockOpenKysely.mockResolvedValue({
      db: { executeQuery: mockExecuteQuery.mockResolvedValue(undefined) },
      sqliteDb,
    });
    mockCloseSqlite.mockResolvedValue(undefined);
    (copyAsync as jest.Mock).mockResolvedValue(undefined);
    (deleteAsync as jest.Mock).mockResolvedValue(undefined);

    const result = await changeDatabaseEncryptionKey('current-key', '', 'test.db');

    expect(result.success).toBe(true);
    expect(mockOpenKysely).toHaveBeenCalledWith('current-key', 'test.db');
    expect(mockExecuteQuery).toHaveBeenCalledTimes(3);
    expect(mockExecuteQuery.mock.calls[0][0]).toEqual({
      sql: "ATTACH DATABASE '/path/to/test.db.tmp' AS new KEY ''",
    });
    expect(mockExecuteQuery.mock.calls[1][0]).toEqual({
      sql: "SELECT sqlcipher_export('new')",
    });
    expect(mockExecuteQuery.mock.calls[2][0]).toEqual({
      sql: 'DETACH DATABASE new',
    });
    expect(mockExecuteQuery).not.toHaveBeenCalledWith(
      expect.objectContaining({ sql: "PRAGMA rekey=''" }),
    );
    expect(mockCloseSqlite).toHaveBeenCalledWith(sqliteDb);
    expect(copyAsync).toHaveBeenCalledWith({
      from: 'file:///path/to/test.db.tmp',
      to: 'file:///path/to/test.db',
    });
    expect(deleteAsync).toHaveBeenCalledWith('file:///path/to/test.db.tmp');
  });

  /** Tests that a wrong current key causes the open to fail. */
  it('returns an error when the current key is wrong', async () => {
    mockOpenKysely.mockRejectedValue(new Error('file is not a database'));

    const result = await changeDatabaseEncryptionKey('wrong-key', 'new-key', 'test.db');

    expect(result.success).toBe(false);
    expect(result.error).toContain('file is not a database');
    expect(mockCloseSqlite).not.toHaveBeenCalled();
  });

  /** Tests that the function does not itself reopen the database. */
  it('does not itself reopen the database (no initialize calls)', async () => {
    const sqliteDb = {
      closeAsync: jest.fn().mockResolvedValue(undefined),
      databasePath: '/path/to/test.db',
    };
    mockOpenKysely.mockResolvedValue({
      db: { executeQuery: mockExecuteQuery.mockResolvedValue(undefined) },
      sqliteDb,
    });
    mockCloseSqlite.mockResolvedValue(undefined);

    await changeDatabaseEncryptionKey('old', 'new', 'test.db');

    // openKysely is called to perform the rekey, but no init/migrate happens.
    expect(mockOpenKysely).toHaveBeenCalledTimes(1);
    expect(mockCloseSqlite).toHaveBeenCalledTimes(1);
  });

  /** Tests that the function handles a non-Error thrown value. */
  it('returns stringified error when a non-Error value is thrown', async () => {
    mockOpenKysely.mockImplementation(() => {
      throw 'plain string failure';
    });

    const result = await changeDatabaseEncryptionKey('old', 'new', 'test.db');

    expect(result.success).toBe(false);
    expect(result.error).toBe('plain string failure');
  });

  /** Tests that close errors in the finally block are swallowed. */
  it('swallows close errors in the finally block', async () => {
    const sqliteDb = {
      closeAsync: jest.fn().mockResolvedValue(undefined),
      databasePath: '/path/to/test.db',
    };
    mockOpenKysely.mockResolvedValue({
      db: { executeQuery: mockExecuteQuery.mockResolvedValue(undefined) },
      sqliteDb,
    });
    mockCloseSqlite.mockRejectedValue(new Error('close failed'));

    const result = await changeDatabaseEncryptionKey('old', 'new', 'test.db');

    // The rekey itself succeeded; the close error is swallowed.
    expect(result.success).toBe(true);
    expect(mockCloseSqlite).toHaveBeenCalledWith(sqliteDb);
  });

  /** Tests cleanup of the temp file when sqlcipher_export fails. */
  it('cleans up temp file and returns error when export fails', async () => {
    const sqliteDb = {
      closeAsync: jest.fn().mockResolvedValue(undefined),
      databasePath: '/path/to/test.db',
    };
    mockOpenKysely.mockResolvedValue({
      db: {
        executeQuery: mockExecuteQuery.mockImplementation(async (query: { sql: string }) => {
          if (query.sql.includes('sqlcipher_export')) {
            throw new Error('export failed');
          }
          return undefined;
        }),
      },
      sqliteDb,
    });
    mockCloseSqlite.mockResolvedValue(undefined);

    const result = await changeDatabaseEncryptionKey('current-key', '', 'test.db');

    expect(result.success).toBe(false);
    expect(result.error).toContain('export failed');
    expect(deleteAsync).toHaveBeenCalledWith('file:///path/to/test.db.tmp');
  });
});
