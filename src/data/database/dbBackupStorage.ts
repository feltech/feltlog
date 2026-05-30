import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_BACKUP_DIRECTORY_URI = 'feltlog.backupDirectoryUri';
const KEY_LAST_BACKUP_TIMESTAMP = 'feltlog.lastBackupTimestamp';
const KEY_BACKUP_MAX_COUNT = 'feltlog.backupMaxCount';

/**
 * Retrieve the persisted SAF backup directory URI.
 *
 * @returns The content:// URI string, or null if not set.
 */
export async function getBackupDirectoryUri(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(KEY_BACKUP_DIRECTORY_URI);
    return v ?? null;
  } catch {
    return null;
  }
}

/**
 * Persist the SAF backup directory URI.
 *
 * @param uri The content:// URI string to store.
 */
export async function setBackupDirectoryUri(uri: string): Promise<void> {
  await AsyncStorage.setItem(KEY_BACKUP_DIRECTORY_URI, uri);
}

/** Clear the persisted backup directory URI. */
export async function clearBackupDirectoryUri(): Promise<void> {
  await AsyncStorage.removeItem(KEY_BACKUP_DIRECTORY_URI);
}

/**
 * Retrieve the timestamp of the last successful backup.
 *
 * @returns The ISO 8601 timestamp string, or null if no backup has been made.
 */
export async function getLastBackupTimestamp(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(KEY_LAST_BACKUP_TIMESTAMP);
    return v ?? null;
  } catch {
    return null;
  }
}

/**
 * Persist the timestamp of the last successful backup.
 *
 * @param ts The ISO 8601 timestamp string to store.
 */
export async function setLastBackupTimestamp(ts: string): Promise<void> {
  await AsyncStorage.setItem(KEY_LAST_BACKUP_TIMESTAMP, ts);
}

/**
 * Retrieve the maximum number of backup files to keep.
 *
 * Defaults to 5 if the value is not set or cannot be parsed.
 *
 * @returns The maximum backup count as a number.
 */
export async function getBackupMaxCount(): Promise<number> {
  try {
    const v = await AsyncStorage.getItem(KEY_BACKUP_MAX_COUNT);
    if (v === null) return 5;
    const parsed = parseInt(v, 10);
    return Number.isNaN(parsed) ? 5 : parsed;
  } catch {
    return 5;
  }
}

/**
 * Persist the maximum number of backup files to keep.
 *
 * @param count The maximum backup count to store.
 */
// TODO: expose in Settings UI.
export async function setBackupMaxCount(count: number): Promise<void> {
  await AsyncStorage.setItem(KEY_BACKUP_MAX_COUNT, String(count));
}
