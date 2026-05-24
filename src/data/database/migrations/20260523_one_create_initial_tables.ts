import { type Kysely } from 'kysely';

/**
 * Creates the initial database tables: tags, journal_entries, and journal_entry_tags.
 *
 * This is the first migration and handles both schema creation and any initial seed
 * data for a fresh database.
 */

/**
 * Creates the initial schema.
 *
 * @param db - The Kysely database instance (untyped for migrations).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  // Create tags table
  await db.schema
    .createTable('tags')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addColumn('id', 'text', (col: any) => col.primaryKey())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addColumn('name', 'text', (col: any) => col.notNull().unique())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addColumn('created_at', 'text', (col: any) => col.notNull())
    .execute();

  // Create journal_entries table
  await db.schema
    .createTable('journal_entries')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addColumn('id', 'text', (col: any) => col.primaryKey())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addColumn('content', 'text', (col: any) => col.notNull())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addColumn('datetime', 'text', (col: any) => col.notNull())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addColumn('created_at', 'text', (col: any) => col.notNull())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addColumn('modified_at', 'text', (col: any) => col.notNull())
    .addColumn('location_latitude', 'real')
    .addColumn('location_longitude', 'real')
    .addColumn('location_elevation', 'real')
    .addColumn('location_accuracy', 'real')
    .addColumn('location_address', 'text')
    .execute();

  // Create junction table for many-to-many relationship between entries and tags
  await db.schema
    .createTable('journal_entry_tags')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addColumn('entry_id', 'text', (col: any) =>
      col.references('journal_entries.id').onDelete('cascade').notNull(),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addColumn('tag_id', 'text', (col: any) =>
      col.references('tags.id').onDelete('cascade').notNull(),
    )
    .addPrimaryKeyConstraint('journal_entry_tags_pk', ['entry_id', 'tag_id'])
    .execute();
}

/**
 * Drops all tables in reverse dependency order.
 *
 * @param db - The Kysely database instance (untyped for migrations).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('journal_entry_tags').execute();
  await db.schema.dropTable('journal_entries').execute();
  await db.schema.dropTable('tags').execute();
}
