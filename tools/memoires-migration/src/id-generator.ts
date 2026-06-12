import { v5 as uuidv5 } from 'uuid';

/**
 * Deterministic UUIDv5 namespace for tag IDs.
 *
 * Using a fixed namespace guarantees that re-running the script produces identical IDs
 * for the same source data, making the migration idempotent.
 */
const TAG_NAMESPACE = uuidv5('memoires-tag', uuidv5.DNS);

/**
 * Deterministic UUIDv5 namespace for entry IDs.
 *
 * Same rationale as TAG_NAMESPACE: idempotent re-runs.
 */
const ENTRY_NAMESPACE = uuidv5('memoires-entry', uuidv5.DNS);

/**
 * Generate a deterministic UUIDv5 for a tag.
 *
 * @param originalId - The original `_id` from the memoires `tag` table.
 *
 * @returns A UUID string derived from the tag namespace and the original ID.
 */
export function generateTagId(originalId: number): string {
  return uuidv5(String(originalId), TAG_NAMESPACE);
}

/**
 * Generate a deterministic UUIDv5 for a journal entry.
 *
 * @param originalId - The original `_id` from the memoires `memo` table.
 *
 * @returns A UUID string derived from the entry namespace and the original ID.
 */
export function generateEntryId(originalId: number): string {
  return uuidv5(String(originalId), ENTRY_NAMESPACE);
}

/** Expose the namespace constants for test assertions. */
export const NAMESPACE = {
  tag: TAG_NAMESPACE,
  entry: ENTRY_NAMESPACE,
} as const;
