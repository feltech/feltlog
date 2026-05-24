import type { MigrationProvider } from 'kysely';

/**
 * A MigrationProvider that serves migrations from an in-memory record.
 *
 * This replaces Kysely's FileMigrationProvider (which requires Node.js fs/path) for use
 * in React Native / Expo where those modules are unavailable.
 */
export class InMemoryMigrationProvider implements MigrationProvider {
  private readonly migrations: Record;

  /**
   * Creates a new InMemoryMigrationProvider.
   *
   * @param migrations - A record of migration name to Migration object.
   */
  constructor(migrations: Record) {
    this.migrations = migrations;
  }

  /**
   * Returns all migrations, old and new.
   *
   * Kysely sorts the keys alphabetically to determine execution order.
   *
   * @returns A record of migration name to Migration object.
   */
  async getMigrations(): Promise {
    return this.migrations;
  }
}
