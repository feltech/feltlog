import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'feltlog.lastDatabaseName';

/**
 * Persist and retrieve the last used database name/location. We only store the
 * filename/path; never store the encryption key.
 *
 * @returns The last used database name or null if not set.
 */
export async function getLastDatabaseName(): Promise {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v ?? null;
  } catch {
    return null;
  }
}

/**
 * Update the last used database name.
 *
 * @param name The name of the database to persist.
 */
export async function setLastDatabaseName(name: string): Promise {
  await AsyncStorage.setItem(KEY, name);
}

/** Clear the last used database name from storage. */
export async function clearLastDatabaseName(): Promise {
  await AsyncStorage.removeItem(KEY);
}
