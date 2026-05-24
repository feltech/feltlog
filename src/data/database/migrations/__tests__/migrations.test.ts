import { CompiledQuery, Kysely, Migrator } from 'kysely';
import { SQLiteDatabase } from 'expo-sqlite';
import { migrationProvider } from '@/src/data/database/migrations';
import { closeSqlite, openKysely } from '@/src/data/database/database';
import * as m20260523 from '../20260523_one_create_initial_tables';

/**
 * Integration tests for the database migration system.
 *
 * These tests use the real migration files against an in-memory SQLite database to
 * verify schema creation, column definitions, constraints, foreign keys, rollback,
 * idempotency, and the schema contract.
 */
describe('Migrations', () => {
  let db: Kysely;
  let sqliteDb: SQLiteDatabase | null;

  beforeEach(async () => {
    // Each test gets a unique in-memory database.
    const testDbName = `test_${Date.now()}_${Math.random()}.db`;
    const result = await openKysely(undefined, testDbName);
    db = result.db;
    sqliteDb = result.sqliteDb;

    const migrator = new Migrator({
      db,
      provider: migrationProvider,
    });
    const { error: migrationError } = await migrator.migrateToLatest();
    if (migrationError) {
      throw migrationError;
    }
  });

  afterEach(async () => {
    if (sqliteDb) {
      await closeSqlite(sqliteDb);
      sqliteDb = null;
    }
  });

  describe('Migration up()', () => {
    /**
     * Tests that the initial migration creates all three application tables plus the
     * internal migration tracking tables.
     */
    it('should create all expected tables', async () => {
      const result = await db.executeQuery(
        CompiledQuery.raw("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"),
      );

      const tableNames: string[] = result.rows.map((r: Record) => String(r.name));

      // Application tables
      expect(tableNames).toContain('journal_entries');
      expect(tableNames).toContain('journal_entry_tags');
      expect(tableNames).toContain('tags');

      // Kysely internal migration tracking tables
      expect(tableNames).toContain('kysely_migration');
      expect(tableNames).toContain('kysely_migration_lock');
    });

    /**
     * Tests that the tags table has the correct columns and constraints: id (text PK),
     * name (text, not null, unique), created_at (text, not null).
     */
    it('should create tags table with correct columns', async () => {
      const tableInfo = await db.executeQuery(CompiledQuery.raw('PRAGMA table_info(tags)'));

      const idCol = tableInfo.rows.find((c: Record) => c.name === 'id');
      expect(idCol).toBeDefined();
      expect(idCol.type).toBe('TEXT');
      expect(idCol.pk).toBe(1);

      const nameCol = tableInfo.rows.find((c: Record) => c.name === 'name');
      expect(nameCol).toBeDefined();
      expect(nameCol.type).toBe('TEXT');
      expect(nameCol.notnull).toBe(1);

      const createdAtCol = tableInfo.rows.find((c: Record) => c.name === 'created_at');
      expect(createdAtCol).toBeDefined();
      expect(createdAtCol.type).toBe('TEXT');
      expect(createdAtCol.notnull).toBe(1);

      // Verify the UNIQUE constraint on name via its implicit index.
      const indexList = await db.executeQuery(CompiledQuery.raw('PRAGMA index_list(tags)'));

      const uniqueIndex = indexList.rows.find(
        (i: Record) => i.unique === 1 && String(i.origin || '').includes('u'),
      );
      expect(uniqueIndex).toBeDefined();
    });

    /**
     * Tests that the journal_entries table has all expected columns with correct types
     * and nullability, including nullable location fields.
     */
    it('should create journal_entries table with correct columns', async () => {
      const tableInfo = await db.executeQuery(
        CompiledQuery.raw('PRAGMA table_info(journal_entries)'),
      );

      /**
       * Finds a column definition by name from PRAGMA table_info results.
       *
       * @param name - The column name to look up.
       *
       * @returns The column info row, or undefined if not found.
       */
      const toCol = (name: string): Record | undefined =>
        tableInfo.rows.find((c: Record) => c.name === name);

      // Required columns
      const idCol = toCol('id');
      expect(idCol).toBeDefined();
      expect(idCol.type).toBe('TEXT');
      expect(idCol.pk).toBe(1);

      const contentCol = toCol('content');
      expect(contentCol).toBeDefined();
      expect(contentCol.type).toBe('TEXT');
      expect(contentCol.notnull).toBe(1);

      const datetimeCol = toCol('datetime');
      expect(datetimeCol).toBeDefined();
      expect(datetimeCol.type).toBe('TEXT');
      expect(datetimeCol.notnull).toBe(1);

      const createdAtCol = toCol('created_at');
      expect(createdAtCol).toBeDefined();
      expect(createdAtCol.type).toBe('TEXT');
      expect(createdAtCol.notnull).toBe(1);

      const modifiedAtCol = toCol('modified_at');
      expect(modifiedAtCol).toBeDefined();
      expect(modifiedAtCol.type).toBe('TEXT');
      expect(modifiedAtCol.notnull).toBe(1);

      // Nullable location columns
      const latCol = toCol('location_latitude');
      expect(latCol).toBeDefined();
      expect(latCol.type).toBe('REAL');
      expect(latCol.notnull).toBe(0);

      const lonCol = toCol('location_longitude');
      expect(lonCol).toBeDefined();
      expect(lonCol.type).toBe('REAL');
      expect(lonCol.notnull).toBe(0);

      const elevCol = toCol('location_elevation');
      expect(elevCol).toBeDefined();
      expect(elevCol.type).toBe('REAL');
      expect(elevCol.notnull).toBe(0);

      const accCol = toCol('location_accuracy');
      expect(accCol).toBeDefined();
      expect(accCol.type).toBe('REAL');
      expect(accCol.notnull).toBe(0);

      const addrCol = toCol('location_address');
      expect(addrCol).toBeDefined();
      expect(addrCol.type).toBe('TEXT');
      expect(addrCol.notnull).toBe(0);
    });

    /**
     * Tests that the journal_entry_tags junction table has both columns (entry_id,
     * tag_id) as NOT NULL and a composite primary key.
     */
    it('should create journal_entry_tags junction table with correct structure', async () => {
      const tableInfo = await db.executeQuery(
        CompiledQuery.raw('PRAGMA table_info(journal_entry_tags)'),
      );

      const cols = tableInfo.rows as Record[];

      const entryIdCol = cols.find(c => c.name === 'entry_id');
      expect(entryIdCol).toBeDefined();
      expect(entryIdCol.type).toBe('TEXT');
      expect(entryIdCol.notnull).toBe(1);

      const tagIdCol = cols.find(c => c.name === 'tag_id');
      expect(tagIdCol).toBeDefined();
      expect(tagIdCol.type).toBe('TEXT');
      expect(tagIdCol.notnull).toBe(1);

      // Verify composite primary key: the named PK constraint should
      // produce an index with origin 'pk'.
      const indexList = await db.executeQuery(
        CompiledQuery.raw('PRAGMA index_list(journal_entry_tags)'),
      );

      const pkIndex = indexList.rows.find((i: Record) => String(i.origin || '') === 'pk');
      expect(pkIndex).toBeDefined();
      expect(pkIndex.unique).toBe(1);
    });

    /**
     * Tests that the foreign key constraints on journal_entry_tags reference the
     * correct parent tables and columns with cascade delete.
     */
    it('should create foreign key constraints on journal_entry_tags', async () => {
      const fkList = await db.executeQuery(
        CompiledQuery.raw('PRAGMA foreign_key_list(journal_entry_tags)'),
      );

      const fks = fkList.rows as Record[];

      // FK from entry_id → journal_entries.id with cascade delete
      const entryFk = fks.find(fk => fk.from === 'entry_id');
      expect(entryFk).toBeDefined();
      expect(entryFk.table).toBe('journal_entries');
      expect(entryFk.to).toBe('id');
      expect(entryFk.on_delete).toBe('CASCADE');

      // FK from tag_id → tags.id with cascade delete
      const tagFk = fks.find(fk => fk.from === 'tag_id');
      expect(tagFk).toBeDefined();
      expect(tagFk.table).toBe('tags');
      expect(tagFk.to).toBe('id');
      expect(tagFk.on_delete).toBe('CASCADE');
    });
  });

  describe('Migration down()', () => {
    /**
     * Tests that running down() on the initial migration drops all three application
     * tables.
     */
    it('should drop all tables', async () => {
      // First ensure migrations are up (already done in beforeEach).
      // Then run the down() function directly.
      await m20260523.down(db);

      // Verify application tables are gone. Kysely tracking tables
      // survive (they are managed by Kysely, not the migration).
      const result = await db.executeQuery(
        CompiledQuery.raw("SELECT name FROM sqlite_master WHERE type = 'table'"),
      );

      const tableNames: string[] = result.rows.map((r: Record) => String(r.name));

      expect(tableNames).not.toContain('journal_entries');
      expect(tableNames).not.toContain('journal_entry_tags');
      expect(tableNames).not.toContain('tags');
    });

    /**
     * Tests that migrations can be re-applied after a rollback without errors,
     * producing the same schema.
     */
    it('should allow re-applying migrations after rollback', async () => {
      // Rollback: drop all application tables.
      await m20260523.down(db);

      // Remove the migration tracking record so that Kysely will
      // re-apply the migration on the next migrateToLatest call.
      await db.executeQuery(
        CompiledQuery.raw(
          "DELETE FROM kysely_migration WHERE name = '20260523_one_create_initial_tables'",
        ),
      );

      // Re-apply
      const migrator = new Migrator({
        db,
        provider: migrationProvider,
      });
      const { error: migrationError } = await migrator.migrateToLatest();
      if (migrationError) {
        throw migrationError;
      }

      // Verify all tables exist again.
      const result = await db.executeQuery(
        CompiledQuery.raw("SELECT name FROM sqlite_master WHERE type = 'table'"),
      );

      const tableNames: string[] = result.rows.map((r: Record) => String(r.name));

      expect(tableNames).toContain('journal_entries');
      expect(tableNames).toContain('journal_entry_tags');
      expect(tableNames).toContain('tags');
    });
  });

  describe('Migration idempotency', () => {
    /**
     * Tests that running migrateToLatest a second time on an already-migrated database
     * is safe and does not produce errors. Also verifies that Kysely records the
     * migration only once in the tracking table.
     */
    it('should be safe to run migrateToLatest twice', async () => {
      // Run migrations a second time on the same database.
      const migrator = new Migrator({
        db,
        provider: migrationProvider,
      });
      const { error: migrationError, results } = await migrator.migrateToLatest();

      // Should succeed with no errors.
      expect(migrationError).toBeUndefined();

      // Should not have applied anything new.
      results?.forEach(it => {
        expect(it.status).not.toBe('Success');
        // Already migrated entries show 'NotExecuted' status in Kysely
        // because Kysely skips already-run migrations.
      });

      // All tables should still exist.
      const tables = await db.executeQuery(
        CompiledQuery.raw("SELECT name FROM sqlite_master WHERE type = 'table'"),
      );

      const tableNames: string[] = tables.rows.map((r: Record) => String(r.name));

      expect(tableNames).toContain('journal_entries');
      expect(tableNames).toContain('journal_entry_tags');
      expect(tableNames).toContain('tags');

      // Kysely tracking table should contain the migration exactly once.
      // Use a raw query since kysely_migration is not in the Database type.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const trackingResult = await (db as any).executeQuery(
        CompiledQuery.raw('SELECT name FROM kysely_migration'),
      );

      const migrationNames: string[] = trackingResult.rows.map((r: Record) => String(r.name));

      expect(migrationNames).toEqual(['20260523_one_create_initial_tables']);
    });
  });

  describe('Schema contract', () => {
    /**
     * Tests that the actual database schema matches the TypeScript Database interface
     * by inserting a full row and reading it back, verifying every field round-trips
     * correctly.
     */
    it('should match the Database type interface', async () => {
      // Insert a complete journal_entries row (all fields populated).
      await db.executeQuery(
        CompiledQuery.raw(
          `INSERT INTO journal_entries
            (id, content, datetime, created_at, modified_at,
             location_latitude, location_longitude, location_elevation,
             location_accuracy, location_address)
           VALUES
            ('entry-1', 'Test content', '2024-06-01T12:00:00.000Z',
             '2024-06-01T12:00:00.000Z', '2024-06-01T12:00:01.000Z',
             40.7128, -74.006, 10.5, 5.0, 'New York, NY, USA')`,
        ),
      );

      // Insert a tags row.
      await db.executeQuery(
        CompiledQuery.raw(
          `INSERT INTO tags (id, name, created_at)
           VALUES ('tag-1', 'test-tag', '2024-06-01T12:00:00.000Z')`,
        ),
      );

      // Insert a journal_entry_tags row.
      await db.executeQuery(
        CompiledQuery.raw(
          `INSERT INTO journal_entry_tags (entry_id, tag_id)
           VALUES ('entry-1', 'tag-1')`,
        ),
      );

      // Verify journal_entries row.
      const entryResult = await db.executeQuery(
        CompiledQuery.raw("SELECT * FROM journal_entries WHERE id = 'entry-1'"),
      );
      const entry = entryResult.rows[0] as Record;

      expect(entry.id).toBe('entry-1');
      expect(entry.content).toBe('Test content');
      expect(entry.datetime).toBe('2024-06-01T12:00:00.000Z');
      expect(entry.created_at).toBe('2024-06-01T12:00:00.000Z');
      expect(entry.modified_at).toBe('2024-06-01T12:00:01.000Z');
      expect(entry.location_latitude).toBe(40.7128);
      expect(entry.location_longitude).toBe(-74.006);
      expect(entry.location_elevation).toBe(10.5);
      expect(entry.location_accuracy).toBe(5.0);
      expect(entry.location_address).toBe('New York, NY, USA');

      // Verify tags row.
      const tagResult = await db.executeQuery(
        CompiledQuery.raw("SELECT * FROM tags WHERE id = 'tag-1'"),
      );
      const tag = tagResult.rows[0] as Record;

      expect(tag.id).toBe('tag-1');
      expect(tag.name).toBe('test-tag');
      expect(tag.created_at).toBe('2024-06-01T12:00:00.000Z');

      // Verify journal_entry_tags row.
      const jetResult = await db.executeQuery(
        CompiledQuery.raw(
          "SELECT * FROM journal_entry_tags WHERE entry_id = 'entry-1' AND tag_id = 'tag-1'",
        ),
      );
      const jet = jetResult.rows[0] as Record;

      expect(jet.entry_id).toBe('entry-1');
      expect(jet.tag_id).toBe('tag-1');
    });

    /**
     * Tests that location fields in journal_entries accept NULL values and return as
     * null/undefined when read back.
     */
    it('should allow null location fields in journal_entries', async () => {
      await db.executeQuery(
        CompiledQuery.raw(
          `INSERT INTO journal_entries
            (id, content, datetime, created_at, modified_at,
             location_latitude, location_longitude, location_elevation,
             location_accuracy, location_address)
           VALUES
            ('entry-null-loc', 'No location', '2024-06-01T12:00:00.000Z',
             '2024-06-01T12:00:00.000Z', '2024-06-01T12:00:01.000Z',
             NULL, NULL, NULL, NULL, NULL)`,
        ),
      );

      const result = await db.executeQuery(
        CompiledQuery.raw("SELECT * FROM journal_entries WHERE id = 'entry-null-loc'"),
      );
      const row = result.rows[0] as Record;

      // Non-null columns should still be present.
      expect(row.id).toBe('entry-null-loc');
      expect(row.content).toBe('No location');

      // Location columns should be null.
      expect(row.location_latitude).toBeNull();
      expect(row.location_longitude).toBeNull();
      expect(row.location_elevation).toBeNull();
      expect(row.location_accuracy).toBeNull();
      expect(row.location_address).toBeNull();
    });
  });
});
