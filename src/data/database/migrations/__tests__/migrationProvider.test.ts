import { InMemoryMigrationProvider } from '@/src/data/database/migrations/migrationProvider';

/** Unit tests for the InMemoryMigrationProvider. */
describe('InMemoryMigrationProvider', () => {
  /**
   * Tests that getMigrations returns the exact record passed to the constructor,
   * without copies or transformations.
   */
  it('getMigrations() returns the migrations record passed to the constructor', async () => {
    const migrations: Record = {
      '001_test': {
        up: async () => {},
        down: async () => {},
      },
      '002_other': {
        up: async () => {},
        down: async () => {},
      },
    };

    const provider = new InMemoryMigrationProvider(migrations);
    const result = await provider.getMigrations();

    expect(result).toBe(migrations);
    expect(Object.keys(result)).toHaveLength(2);
    expect(Object.keys(result)).toEqual(['001_test', '002_other']);
  });

  /**
   * Tests that getMigrations returns an empty object when the provider is constructed
   * with an empty record.
   */
  it('getMigrations() returns an empty object when constructed with an empty record', async () => {
    const provider = new InMemoryMigrationProvider({});
    const result = await provider.getMigrations();

    expect(result).toEqual({});
    expect(Object.keys(result)).toHaveLength(0);
  });

  /**
   * Tests that getMigrations returns a Promise, satisfying Kysely's MigrationProvider
   * contract which expects an async method.
   */
  it('getMigrations() returns a promise', () => {
    const provider = new InMemoryMigrationProvider({});
    const result = provider.getMigrations();

    expect(result).toBeInstanceOf(Promise);
    expect(typeof result.then).toBe('function');
  });

  /**
   * Tests that the provider exposes the getMigrations method, confirming it
   * structurally implements Kysely's MigrationProvider interface.
   */
  it('implements the MigrationProvider interface', () => {
    const provider = new InMemoryMigrationProvider({});

    expect(typeof provider.getMigrations).toBe('function');
  });
});
