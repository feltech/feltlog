import { Kysely, sql } from 'kysely';
import { Database } from './schema';

export async function up(db: Kysely<Database>): Promise<void> {
  // Create tags table
  await db.schema
    .createTable('tags')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull().unique())
    .addColumn('created_at', 'text', (col) => col.notNull())
    .execute();

  // Create journal_entries table
  await db.schema
    .createTable('journal_entries')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('datetime', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('modified_at', 'text', (col) => col.notNull())
    .addColumn('location_latitude', 'real')
    .addColumn('location_longitude', 'real')
    .addColumn('location_elevation', 'real')
    .addColumn('location_accuracy', 'real')
    .addColumn('location_address', 'text')
    .execute();

  // Create junction table for many-to-many relationship between entries and tags
  await db.schema
    .createTable('journal_entry_tags')
    .ifNotExists()
    .addColumn('entry_id', 'text', (col) => 
      col.references('journal_entries.id').onDelete('cascade').notNull())
    .addColumn('tag_id', 'text', (col) => 
      col.references('tags.id').onDelete('cascade').notNull())
    .addPrimaryKeyConstraint('journal_entry_tags_pk', ['entry_id', 'tag_id'])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable('journal_entry_tags').execute();
  await db.schema.dropTable('journal_entries').execute();
  await db.schema.dropTable('tags').execute();
}