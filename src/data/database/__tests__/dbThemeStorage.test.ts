import AsyncStorage from '@react-native-async-storage/async-storage';
import { getThemeMode, setThemeMode } from '../dbThemeStorage';

/**
 * Test suite for dbThemeStorage. Covers storing, retrieving, and error handling for
 * theme mode preference, plus default value and invalid value fallback.
 */
describe('dbThemeStorage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  /** Tests that getThemeMode returns 'auto' when nothing is stored. */
  it('returns default "auto" when nothing stored', async () => {
    const mode = await getThemeMode();
    expect(mode).toBe('auto');
  });

  /** Tests persisting and retrieving the theme mode. */
  it('persists and retrieves theme mode', async () => {
    await setThemeMode('dark');
    const mode = await getThemeMode();
    expect(mode).toBe('dark');

    await setThemeMode('light');
    const mode2 = await getThemeMode();
    expect(mode2).toBe('light');
  });

  /** Tests that getThemeMode returns 'auto' when stored value is invalid. */
  it('returns default "auto" when stored value is invalid', async () => {
    await AsyncStorage.setItem('feltlog.themeMode', 'invalid-value');
    const mode = await getThemeMode();
    expect(mode).toBe('auto');
  });

  /** Tests that getThemeMode returns default when AsyncStorage throws. */
  it('returns default "auto" when getThemeMode throws', async () => {
    const originalGetItem = AsyncStorage.getItem;
    AsyncStorage.getItem = jest.fn().mockRejectedValue(new Error('Storage error'));

    const mode = await getThemeMode();
    expect(mode).toBe('auto');

    AsyncStorage.getItem = originalGetItem;
  });

  /** Tests that setThemeMode propagates errors from AsyncStorage. */
  it('propagates errors from AsyncStorage.setItem', async () => {
    const originalSetItem = AsyncStorage.setItem;
    AsyncStorage.setItem = jest.fn().mockRejectedValue(new Error('Storage error'));

    await expect(setThemeMode('dark')).rejects.toThrow('Storage error');

    AsyncStorage.setItem = originalSetItem;
  });
});
