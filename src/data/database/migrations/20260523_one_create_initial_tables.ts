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
export async function up(db: Kysely): Promise {
  // Create tags table
  await db.schema
    .createTable('tags')
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('name', 'text', col => col.notNull().unique())
    .addColumn('created_at', 'text', col => col.notNull())
    .execute();

  // Create journal_entries table
  await db.schema
    .createTable('journal_entries')
    .addColumn('id', 'text', col => col.primaryKey())
    .addColumn('content', 'text', col => col.notNull())
    .addColumn('datetime', 'text', col => col.notNull())
    .addColumn('created_at', 'text', col => col.notNull())
    .addColumn('modified_at', 'text', col => col.notNull())
    .addColumn('location_latitude', 'real')
    .addColumn('location_longitude', 'real')
    .addColumn('location_elevation', 'real')
    .addColumn('location_accuracy', 'real')
    .addColumn('location_address', 'text')
    .execute();

  // Create junction table for many-to-many relationship between entries and tags
  await db.schema
    .createTable('journal_entry_tags')
    .addColumn('entry_id', 'text', col =>
      col.references('journal_entries.id').onDelete('cascade').notNull(),
    )
    .addColumn('tag_id', 'text', col => col.references('tags.id').onDelete('cascade').notNull())
    .addPrimaryKeyConstraint('journal_entry_tags_pk', ['entry_id', 'tag_id'])
    .execute();
}

/**
 * Drops all tables in reverse dependency order.
 *
 * @param db - The Kysely database instance (untyped for migrations).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely): Promise {
  await db.schema.dropTable('journal_entry_tags').execute();
  await db.schema.dropTable('journal_entries').execute();
  await db.schema.dropTable('tags').execute();
}
