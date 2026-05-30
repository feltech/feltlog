import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearBackupDirectoryUri,
  getBackupDirectoryUri,
  getBackupMaxCount,
  getLastBackupTimestamp,
  setBackupDirectoryUri,
  setBackupMaxCount,
  setLastBackupTimestamp,
} from '../dbBackupStorage';

/**
 * Test suite for dbBackupStorage. Covers storing, retrieving, and clearing backup
 * settings, plus error handling and default values.
 */
describe('dbBackupStorage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  // -------------------------------------------------------------------------
  // Backup directory URI
  // -------------------------------------------------------------------------

  /** Tests that getBackupDirectoryUri returns null when nothing is stored. */
  it('returns null for backup directory URI when nothing stored', async () => {
    const uri = await getBackupDirectoryUri();
    expect(uri).toBeNull();
  });

  /** Tests persisting and retrieving the backup directory URI. */
  it('persists and retrieves backup directory URI', async () => {
    await setBackupDirectoryUri('content://mock-backup-dir');
    const uri = await getBackupDirectoryUri();
    expect(uri).toBe('content://mock-backup-dir');
  });

  /** Tests clearing the backup directory URI. */
  it('clears stored backup directory URI', async () => {
    await setBackupDirectoryUri('content://mock-backup-dir');
    await clearBackupDirectoryUri();
    const uri = await getBackupDirectoryUri();
    expect(uri).toBeNull();
  });

  /** Tests that getBackupDirectoryUri returns null when AsyncStorage throws. */
  it('returns null when getBackupDirectoryUri throws', async () => {
    const originalGetItem = AsyncStorage.getItem;
    AsyncStorage.getItem = jest.fn().mockRejectedValue(new Error('Storage error'));

    const uri = await getBackupDirectoryUri();
    expect(uri).toBeNull();

    AsyncStorage.getItem = originalGetItem;
  });

  // -------------------------------------------------------------------------
  // Last backup timestamp
  // -------------------------------------------------------------------------

  /** Tests that getLastBackupTimestamp returns null when nothing is stored. */
  it('returns null for last backup timestamp when nothing stored', async () => {
    const ts = await getLastBackupTimestamp();
    expect(ts).toBeNull();
  });

  /** Tests persisting and retrieving the last backup timestamp. */
  it('persists and retrieves last backup timestamp', async () => {
    await setLastBackupTimestamp('2026-05-28T14:30:00.000Z');
    const ts = await getLastBackupTimestamp();
    expect(ts).toBe('2026-05-28T14:30:00.000Z');
  });

  /** Tests that getLastBackupTimestamp returns null when AsyncStorage throws. */
  it('returns null when getLastBackupTimestamp throws', async () => {
    const originalGetItem = AsyncStorage.getItem;
    AsyncStorage.getItem = jest.fn().mockRejectedValue(new Error('Storage error'));

    const ts = await getLastBackupTimestamp();
    expect(ts).toBeNull();

    AsyncStorage.getItem = originalGetItem;
  });

  // -------------------------------------------------------------------------
  // Backup max count
  // -------------------------------------------------------------------------

  /** Tests that getBackupMaxCount defaults to 5 when nothing is stored. */
  it('returns default max count of 5 when nothing stored', async () => {
    const count = await getBackupMaxCount();
    expect(count).toBe(5);
  });

  /** Tests persisting and retrieving the backup max count. */
  it('persists and retrieves backup max count', async () => {
    await setBackupMaxCount(10);
    const count = await getBackupMaxCount();
    expect(count).toBe(10);
  });

  /** Tests that getBackupMaxCount defaults to 5 when stored value is invalid. */
  it('returns default max count when stored value is invalid', async () => {
    await AsyncStorage.setItem('feltlog.backupMaxCount', 'not-a-number');
    const count = await getBackupMaxCount();
    expect(count).toBe(5);
  });

  /** Tests that getBackupMaxCount returns default when AsyncStorage throws. */
  it('returns default max count when getBackupMaxCount throws', async () => {
    const originalGetItem = AsyncStorage.getItem;
    AsyncStorage.getItem = jest.fn().mockRejectedValue(new Error('Storage error'));

    const count = await getBackupMaxCount();
    expect(count).toBe(5);

    AsyncStorage.getItem = originalGetItem;
  });
});
