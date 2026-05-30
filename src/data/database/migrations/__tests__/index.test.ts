import { Kysely, Migrator } from 'kysely';
import { up } from '@/src/data/database/migrations';

jest.mock('kysely', () => {
  const actual = jest.requireActual('kysely');
  return {
    ...actual,
    Migrator: jest.fn(),
  };
});

/** Unit tests for the migrations index up() wrapper. */
describe('migrations index up()', () => {
  /** Tests that up() throws when Migrator reports an error. */
  it('should throw if migrateToLatest returns an error', async () => {
    const mockDb = {} as Kysely<unknown>;

    (Migrator as jest.Mock).mockImplementation(() => ({
      migrateToLatest: jest.fn().mockResolvedValue({
        error: new Error('migration failed'),
      }),
    }));

    await expect(up(mockDb)).rejects.toThrow('migration failed');
  });

  /** Tests that up() resolves when migrateToLatest succeeds. */
  it('should resolve when migrateToLatest succeeds', async () => {
    const mockDb = {} as Kysely<unknown>;

    (Migrator as jest.Mock).mockImplementation(() => ({
      migrateToLatest: jest.fn().mockResolvedValue({
        error: undefined,
        results: [],
      }),
    }));

    await expect(up(mockDb)).resolves.toBeUndefined();
  });
});
