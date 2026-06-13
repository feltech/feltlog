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

import { changeDatabaseEncryptionKey } from '../rekey';

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
  });

  /** Tests changing the key on an encrypted database. */
  it('changes the key on an encrypted database', async () => {
    const sqliteDb = { closeAsync: jest.fn().mockResolvedValue(undefined) };
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

  /** Tests adding encryption to an unencrypted database. */
  it('adds encryption to an unencrypted database', async () => {
    const sqliteDb = { closeAsync: jest.fn().mockResolvedValue(undefined) };
    mockOpenKysely.mockResolvedValue({
      db: { executeQuery: mockExecuteQuery.mockResolvedValue(undefined) },
      sqliteDb,
    });
    mockCloseSqlite.mockResolvedValue(undefined);

    const result = await changeDatabaseEncryptionKey('', 'new-key', 'test.db');

    expect(result.success).toBe(true);
    expect(mockOpenKysely).toHaveBeenCalledWith('', 'test.db');
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    expect(mockExecuteQuery.mock.calls[0][0]).toEqual({ sql: "PRAGMA rekey='new-key'" });
    expect(mockCloseSqlite).toHaveBeenCalledWith(sqliteDb);
  });

  /** Tests removing encryption from an encrypted database. */
  it('removes encryption from an encrypted database', async () => {
    const sqliteDb = { closeAsync: jest.fn().mockResolvedValue(undefined) };
    mockOpenKysely.mockResolvedValue({
      db: { executeQuery: mockExecuteQuery.mockResolvedValue(undefined) },
      sqliteDb,
    });
    mockCloseSqlite.mockResolvedValue(undefined);

    const result = await changeDatabaseEncryptionKey('current-key', '', 'test.db');

    expect(result.success).toBe(true);
    expect(mockOpenKysely).toHaveBeenCalledWith('current-key', 'test.db');
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    expect(mockExecuteQuery.mock.calls[0][0]).toEqual({ sql: "PRAGMA rekey=''" });
    expect(mockCloseSqlite).toHaveBeenCalledWith(sqliteDb);
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
    const sqliteDb = { closeAsync: jest.fn().mockResolvedValue(undefined) };
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
    const sqliteDb = { closeAsync: jest.fn().mockResolvedValue(undefined) };
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
});
