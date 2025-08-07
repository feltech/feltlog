export interface Database {
  journal_entries: JournalEntriesTable;
  tags: TagsTable;
  journal_entry_tags: JournalEntryTagsTable;
}

export interface JournalEntriesTable {
  id: string;
  content: string;
  datetime: string; // ISO string
  created_at: string; // ISO string
  modified_at: string; // ISO string
  location_latitude?: number;
  location_longitude?: number;
  location_elevation?: number;
  location_accuracy?: number;
  location_address?: string;
}

export interface TagsTable {
  id: string;
  name: string;
  created_at: string; // ISO string
}

export interface JournalEntryTagsTable {
  entry_id: string;
  tag_id: string;
}