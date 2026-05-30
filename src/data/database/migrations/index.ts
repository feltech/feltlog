import { Migrator } from 'kysely';
import type { Migration } from 'kysely';
import { InMemoryMigrationProvider } from './migrationProvider';
import * as m20260523 from './20260523_one_create_initial_tables';

/**
 * Registry of all migrations in alpha-numeric order.
 *
 * The keys determine execution order. Never delete or rename keys that have already
 * been shipped — add new migrations at the end instead.
 */
export const MIGRATIONS: Record<string, Migration> = {
  // Key format: ISO_date + sequence + description (snake_case)
  '20260523_one_create_initial_tables': {
    up: m20260523.up,
    down: m20260523.down,
  },
};

/** Migration provider that can be passed to Kysely's Migrator. */
export const migrationProvider = new InMemoryMigrationProvider(MIGRATIONS);

/**
 * Run all pending migrations via Kysely's Migrator.
 *
 * This creates Kysely's internal migration tracking tables and applies any pending
 * migrations. Subsequent calls detect no pending migrations and do nothing.
 *
 * @param db - The Kysely database instance to migrate.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Parameters<typeof m20260523.up>[0]): Promise<void> {
  const migrator = new Migrator({ db, provider: migrationProvider });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
}
