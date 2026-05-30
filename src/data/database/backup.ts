import {
  getInfoAsync,
  readAsStringAsync,
  writeAsStringAsync,
  deleteAsync,
  StorageAccessFramework,
  EncodingType,
} from 'expo-file-system';
import { Kysely, sql } from 'kysely';
import { MIGRATIONS } from './migrations';
import {
  getBackupMaxCount,
  getLastBackupTimestamp,
  setLastBackupTimestamp,
} from './dbBackupStorage';

/**
 * Escapes regex metacharacters in a string so it can be used safely inside a RegExp.
 *
 * @param s - The string to escape.
 *
 * @returns The escaped string.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ensures a path is a valid file:// URI for expo-file-system APIs.
 *
 * Expo-file-system's getInfoAsync, readAsStringAsync, etc. require file:// URIs. The
 * sqliteDb.databasePath property returns a raw filesystem path, so we prepend the
 * scheme when it's missing.
 *
 * @param path - A raw filesystem path or already-valid file:// URI.
 *
 * @returns A file:// URI.
 */
export function ensureFileUri(path: string): string {
  if (path.startsWith('file://')) {
    return path;
  }
  return `file://${path}`;
}

/**
 * Returns the lexicographically last migration key from the registry. This represents
 * the current schema version (e.g., "20260523_one_create_initial_tables").
 *
 * @returns The latest migration key string.
 */
export function getLatestMigrationKey(): string {
  const keys = Object.keys(MIGRATIONS);
  keys.sort();
  return keys.length > 0 ? keys[keys.length - 1] : 'unknown';
}

/**
 * Counts how many registered migrations have not yet been applied. Queries Kysely's
 * internal `kysely_migration` table. If the table doesn't exist (fresh DB), returns the
 * total registered count.
 *
 * @param db - The Kysely database instance to query.
 *
 * @returns The number of pending migrations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getPendingMigrationCount(db: Kysely<any>): Promise<number> {
  const registeredKeys = Object.keys(MIGRATIONS);
  try {
    const result = await sql<{ name: string }>`SELECT name FROM kysely_migration`.execute(db);
    const executedNames = new Set(result.rows.map(r => r.name));
    return registeredKeys.filter(k => !executedNames.has(k)).length;
  } catch {
    // Table doesn't exist yet — all migrations are pending.
    return registeredKeys.length;
  }
}

/**
 * Generates a timestamped, version-tagged backup filename. Format:
 * "feltlog-20260528T143000Z-v20260523.db" When dbName is provided:
 * "feltlog-mydb-20260528T143000Z-v20260523.db"
 *
 * @param migrationKey - The migration key to derive the version tag from.
 * @param dbName - Optional database name to include in the filename prefix.
 *
 * @returns The generated backup filename.
 */
export function buildBackupFileName(migrationKey: string, dbName?: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
  const version = migrationKey.split('_')[0];
  const prefix = dbName ? `feltlog-${dbName}` : 'feltlog';
  return `${prefix}-${timestamp}-v${version}.db`;
}

/**
 * Extracts the filename from a URI by decoding the last path segment. SAF content://
 * URIs encode the full relative path in the last URI segment (e.g.
 * "primary%3APictures%2Ffile.db" decodes to "primary:Pictures/file.db"), so after
 * decoding we must split again by "/" to isolate just the filename. For file:// URIs
 * the last segment is already the filename.
 *
 * @param uri - A file:// or content:// URI.
 *
 * @returns The decoded filename from the URI, or the full URI if no path segments are
 *   found.
 */
export function extractFileName(uri: string): string {
  const segments = uri.split('/');
  const lastSegment = segments[segments.length - 1] || uri;
  const decoded = decodeURIComponent(lastSegment);
  // SAF URIs encode the full relative path in the last segment (e.g.
  // "primary%3APictures%2Ffile.db" decodes to "primary:Pictures/file.db").
  // Split the decoded value by "/" to get just the filename.
  const decodedSegments = decoded.split('/');
  return decodedSegments[decodedSegments.length - 1] || decoded;
}

/**
 * Checks whether the database file has been modified since the last backup. Returns
 * true if backup is needed (stale or never performed).
 *
 * IMPORTANT: FileSystem.getInfoAsync returns modificationTime as epoch seconds. This
 * function normalizes to milliseconds for comparison against stored ISO timestamps.
 *
 * @param sourcePath - The full path to the SQLite database file.
 *
 * @returns True if the backup is stale or has never been performed.
 */
export async function isBackupStale(sourcePath: string): Promise<boolean> {
  const lastTimestamp = await getLastBackupTimestamp();
  if (lastTimestamp === null) {
    return true;
  }

  const info = await getInfoAsync(ensureFileUri(sourcePath));
  if (!info.exists) {
    return true;
  }

  // modificationTime is epoch seconds; convert to milliseconds.
  const dbModTimeMs = info.modificationTime * 1000;
  const lastBackupMs = new Date(lastTimestamp).getTime();

  return dbModTimeMs > lastBackupMs;
}

/**
 * Lists backup files in the SAF directory, keeps the newest N files, and deletes the
 * rest. Files matching "feltlog-*.db" are considered backups.
 *
 * @param directoryUri - The SAF directory URI containing backups.
 * @param maxBackups - The maximum number of backup files to retain.
 * @param dbName - Optional database name to scope the backup prefix.
 */
export async function rotateBackups(
  directoryUri: string,
  maxBackups: number,
  dbName?: string,
): Promise<void> {
  let entries: string[];
  try {
    entries = await StorageAccessFramework.readDirectoryAsync(directoryUri);
  } catch {
    // readDirectoryAsync may fail on some devices/emulators even when the
    // directory is usable for file operations. Skip rotation — the new
    // backup file will still be written.
    return;
  }

  const safeDbName = dbName ? escapeRegex(dbName) : '';
  const prefix = dbName ? `feltlog-${safeDbName}` : 'feltlog';
  const backupPattern = new RegExp(`${prefix}-.*\\.db$`);
  const backupEntries = entries.filter(f => backupPattern.test(f));

  const infos = await Promise.all(
    backupEntries.map(async uri => {
      const info = await getInfoAsync(uri);
      return { uri, exists: info.exists };
    }),
  );

  // Only consider files that the provider confirms exist. SAF files may
  // return exists: false immediately after creation (media scanner hasn't
  // indexed them yet). Deleting such files would destroy a valid backup.
  const existingInfos = infos.filter(f => f.exists);

  // Sort by filename descending (newest first). Backup filenames contain
  // ISO timestamps (e.g.
  // feltlog-2026-05-29T17-52-30Z-v20260523.db) that are lexicographically
  // sortable in chronological order — no need to use modificationTime as
  // a separate sort key.
  existingInfos.sort((a, b) => {
    const nameA = extractFileName(a.uri);
    const nameB = extractFileName(b.uri);
    return nameB.localeCompare(nameA);
  });

  const toDelete = existingInfos.slice(maxBackups);

  for (const { uri } of toDelete) {
    await deleteAsync(uri);
  }
}

export interface BackupResult {
  success: boolean;
  fileName?: string;
  error?: string;
}

let backingUp = false;

/**
 * Copies the database file to the SAF backup directory as an encrypted backup.
 *
 * Uses a module-level guard to prevent concurrent backup operations.
 *
 * The base64 read/write approach loads the entire DB into JS memory. Acceptable for a
 * diary app's small databases; may need revision if media attachments are added.
 *
 * @param sourcePath - Full path to the SQLite database file (from
 *   sqliteDb.databasePath).
 * @param directoryUri - SAF directory URI for backup storage.
 * @param migrationKey - Optional migration version key (for filename tagging).
 * @param dbName - Optional database name to include in the backup filename.
 *
 * @returns A BackupResult indicating success or failure.
 */
export async function backupDatabase(
  sourcePath: string,
  directoryUri: string,
  migrationKey?: string,
  dbName?: string,
): Promise<BackupResult> {
  if (backingUp) {
    return { success: false, error: 'Backup already in progress' };
  }

  backingUp = true;
  try {
    const versionKey = migrationKey ?? getLatestMigrationKey();
    const fileName = buildBackupFileName(versionKey, dbName);

    const base64Content = await readAsStringAsync(ensureFileUri(sourcePath), {
      encoding: EncodingType.Base64,
    });

    const finalSafUri = await StorageAccessFramework.createFileAsync(
      directoryUri,
      fileName,
      'application/octet-stream',
    );
    await writeAsStringAsync(finalSafUri, base64Content, {
      encoding: EncodingType.Base64,
    });

    // Rotate only after the new backup is successfully written. If the write
    // had failed, old backups would still be intact.
    await rotateBackups(directoryUri, await getBackupMaxCount(), dbName);

    await setLastBackupTimestamp(new Date().toISOString());

    return { success: true, fileName };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  } finally {
    backingUp = false;
  }
}

export type LifecycleBackupResult = 'saved' | 'failed' | 'skipped';

/**
 * Pure function for the lifecycle backup hook. Checks staleness and performs a backup
 * if needed. Returns the outcome. Testable without React.
 *
 * @param sourcePath - Full path to the SQLite database file.
 * @param directoryUri - SAF directory URI for backup storage.
 * @param migrationKey - Migration version key for filename tagging.
 * @param dbName - Optional database name to include in the backup filename.
 *
 * @returns The lifecycle backup result.
 */
export async function performLifecycleBackup(
  sourcePath: string,
  directoryUri: string,
  migrationKey: string,
  dbName?: string,
): Promise<LifecycleBackupResult> {
  if (!sourcePath || !directoryUri) {
    return 'skipped';
  }

  const stale = await isBackupStale(sourcePath);
  if (!stale) {
    return 'skipped';
  }

  const result = await backupDatabase(sourcePath, directoryUri, migrationKey, dbName);
  return result.success ? 'saved' : 'failed';
}
