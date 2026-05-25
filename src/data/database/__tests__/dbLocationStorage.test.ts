import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearLastDatabaseName,
  getLastDatabaseName,
  setLastDatabaseName,
} from '../dbLocationStorage';

/**
 * Test suite for dbLocationStorage. Covers storing, retrieving, and clearing the last
 * database name, plus error handling when AsyncStorage fails.
 */
describe('dbLocationStorage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  /** Tests that getLastDatabaseName returns null when nothing is stored. */
  it('returns null when nothing stored', async () => {
    const name = await getLastDatabaseName();
    expect(name).toBeNull();
  });

  /**
   * Tests that setLastDatabaseName persists the name and getLastDatabaseName retrieves
   * it.
   */
  it('persists and retrieves last database name', async () => {
    await setLastDatabaseName('mydb.db');
    const name = await getLastDatabaseName();
    expect(name).toBe('mydb.db');
  });

  /** Tests that clearLastDatabaseName removes the stored name. */
  it('clears stored database name', async () => {
    await setLastDatabaseName('temp.db');
    await clearLastDatabaseName();
    const name = await getLastDatabaseName();
    expect(name).toBeNull();
  });

  /**
   * Tests that getLastDatabaseName returns null when AsyncStorage.getItem throws an
   * error (covers the catch branch on line 16).
   */
  it('returns null when AsyncStorage.getItem throws', async () => {
    const originalGetItem = AsyncStorage.getItem;
    // Mock getItem to throw.
    const mockGetItem = jest.fn().mockRejectedValue(new Error('Storage error'));
    AsyncStorage.getItem = mockGetItem as unknown as typeof AsyncStorage.getItem;

    const name = await getLastDatabaseName();
    expect(name).toBeNull();

    // Restore.
    AsyncStorage.getItem = originalGetItem;
  });
});
