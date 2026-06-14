import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_THEME_MODE = 'feltlog.themeMode';

/** Valid theme mode values. */
export type ThemeMode = 'auto' | 'light' | 'dark';

/**
 * Checks if a value is a valid ThemeMode.
 *
 * @param value - The value to check.
 *
 * @returns True if the value is a valid ThemeMode.
 */
function isValidThemeMode(value: string): value is ThemeMode {
  return value === 'auto' || value === 'light' || value === 'dark';
}

/**
 * Retrieve the persisted theme mode preference.
 *
 * Defaults to 'auto' if nothing is stored or if the stored value is invalid.
 *
 * @returns The theme mode ('auto' | 'light' | 'dark').
 */
export async function getThemeMode(): Promise<ThemeMode> {
  try {
    const v = await AsyncStorage.getItem(KEY_THEME_MODE);
    if (v === null) return 'auto';
    return isValidThemeMode(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/**
 * Persist the theme mode preference.
 *
 * @param mode The theme mode to store ('auto' | 'light' | 'dark').
 */
export async function setThemeMode(mode: ThemeMode): Promise<void> {
  await AsyncStorage.setItem(KEY_THEME_MODE, mode);
}
