export interface Location {
  latitude: number;
  longitude: number;
  elevation: number;
  accuracy?: number;
  address?: string;
}

export interface JournalEntry {
  id: string;
  content: string;
  datetime: Date;  // User-adjustable timestamp
  created_at: Date;
  modified_at: Date;
  tags: string[];
  location?: Location;
}

export interface Tag {
  id: string;
  name: string;
  created_at: Date;
}

export interface JournalEntryTag {
  entry_id: string;
  tag_id: string;
}