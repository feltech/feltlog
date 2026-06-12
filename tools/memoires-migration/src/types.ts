/** @category Types Shared TypeScript types for the memoires-to-FeltLog migration. */

/** A raw row from the memoires `memo` table. */
export interface MemoRow {
  _id: number;
  header: string | null;
  note: string;
  created: number;
  modified: number | null;
  tags: string | null;
  locality: string | null;
  address: string | null;
}

/** A raw row from the memoires `tag` table. */
export interface SourceTagRow {
  _id: number;
  name: string;
}

/** A transformed FeltLog tag row ready for insertion. */
export interface TagRow {
  id: string;
  name: string;
  created_at: string;
}

/** A transformed FeltLog journal entry row ready for insertion. */
export interface JournalEntryRow {
  id: string;
  content: string;
  datetime: string;
  created_at: string;
  modified_at: string;
  location_latitude: number | null;
  location_longitude: number | null;
  location_elevation: number | null;
  location_accuracy: number | null;
  location_address: string | null;
}

/** A junction row linking an entry to a tag. */
export interface EntryTagRow {
  entry_id: string;
  tag_id: string;
}

/** Metadata for the kysely_migration table. */
export interface MigrationMeta {
  name: string;
  timestamp: string;
}
