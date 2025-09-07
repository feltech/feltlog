import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'feltlog.lastDatabaseName';

/**
 * Persist and retrieve the last used database name/location.
 * We only store the filename/path; never store the encryption key.
 */
export async function getLastDatabaseName(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v ?? null;
  } catch {
    return null;
  }
}

export async function setLastDatabaseName(name: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, name);
  } catch {
    // ignore storage errors
  }
}

export async function clearLastDatabaseName(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore storage errors
  }
}
