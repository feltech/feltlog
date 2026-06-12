import { MemoRow, SourceTagRow, JournalEntryRow, TagRow, EntryTagRow } from './types.js';
import { generateEntryId, generateTagId } from './id-generator.js';
import { buildContent } from './html-converter.js';
import { parseAddressBlob } from './address-parser.js';

/**
 * Convert all memoires rows into FeltLog-compatible row arrays.
 *
 * This function also computes the "bulk-update sentinel" heuristic for the `modified`
 * column: many entries share the exact same `modified` timestamp because a past app
 * version performed a bulk update (e.g. schema migration or sync) that rewrote the
 * `modified` field to the same value for every row. We detect this by finding the most
 * common non-NULL `modified` value; if it appears in more than 50 % of all rows, we
 * treat it as a sentinel and fall back to the row's `created` value for those rows.
 * This preserves the original authorship date rather than falsely claiming every entry
 * was edited at the same instant.
 *
 * @param memos - All rows from the memoires `memo` table.
 * @param tags - All rows from the memoires `tag` table.
 * @param tagEarliestCreated - Map from tag name to earliest `created` timestamp.
 *
 * @returns The complete transformed dataset as three row arrays.
 */
export function transformAll(
  memos: MemoRow[],
  tags: SourceTagRow[],
  tagEarliestCreated: Map<string, number>,
): {
  entries: JournalEntryRow[];
  tags: TagRow[];
  entryTags: EntryTagRow[];
} {
  const sentinel = computeBulkUpdateSentinel(memos);

  const tagMap = new Map<string, string>();
  const transformedTags: TagRow[] = tags.map(tag => {
    const id = generateTagId(tag._id);
    tagMap.set(tag.name, id);
    const earliest = tagEarliestCreated.get(tag.name);
    const createdAt =
      earliest !== undefined ? new Date(earliest).toISOString() : '1970-01-01T00:00:00.000Z';
    return { id, name: tag.name, created_at: createdAt };
  });

  const entries: JournalEntryRow[] = [];
  const entryTags: EntryTagRow[] = [];

  for (const memo of memos) {
    const id = generateEntryId(memo._id);
    const content = buildContent(memo.note, memo.created);
    const datetime = new Date(memo.created).toISOString();

    const created_at = datetime;
    const modified_at =
      memo.modified !== null && memo.modified !== sentinel
        ? new Date(memo.modified).toISOString()
        : datetime;

    const { latitude, longitude } = parseAddressBlob(memo.address);

    entries.push({
      id,
      content,
      datetime,
      created_at,
      modified_at,
      location_latitude: latitude,
      location_longitude: longitude,
      location_elevation: null,
      location_accuracy: null,
      location_address: memo.locality ?? null,
    });

    if (memo.tags !== null && memo.tags.trim().length > 0) {
      const tagId = tagMap.get(memo.tags.trim());
      if (tagId !== undefined) {
        entryTags.push({ entry_id: id, tag_id: tagId });
      }
    }
  }

  return { entries, tags: transformedTags, entryTags };
}

/**
 * Compute the bulk-update sentinel value for the `modified` column.
 *
 * 1. Collect all non-NULL `modified` values.
 * 2. Find the most common value and its frequency.
 * 3. If that value accounts for > 50 % of all rows, treat it as a sentinel.
 * 4. Return the sentinel (or `undefined` if none is detected).
 *
 * @param memos - All memo rows.
 *
 * @returns The sentinel timestamp, or `undefined` if no sentinel is found.
 */
function computeBulkUpdateSentinel(memos: MemoRow[]): number | undefined {
  const totalRows = memos.length;
  if (totalRows === 0) {
    return undefined;
  }

  const frequencies = new Map<number, number>();
  for (const memo of memos) {
    if (memo.modified !== null) {
      frequencies.set(memo.modified, (frequencies.get(memo.modified) ?? 0) + 1);
    }
  }

  let mostCommon: number | undefined;
  let highestCount = 0;
  for (const [value, count] of frequencies) {
    if (count > highestCount) {
      highestCount = count;
      mostCommon = value;
    }
  }

  if (mostCommon !== undefined && highestCount > totalRows / 2) {
    return mostCommon;
  }

  return undefined;
}
