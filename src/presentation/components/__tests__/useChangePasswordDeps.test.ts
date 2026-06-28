import { renderHook } from '@testing-library/react-native';
import { useChangePasswordDeps } from '../useChangePassword';

// Mock DatabaseContext (useDatabaseInfo) — this is the source of truth for DB
// metadata in the component tree.
jest.mock('@/src/domain/repositories/DatabaseContext', () => ({
  useDatabaseInfo: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-file-system/legacy', () => require('../../../test-utils/expo-file-system-mock'));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockUseDatabaseInfo = require('@/src/domain/repositories/DatabaseContext')
  .useDatabaseInfo as jest.Mock;

/**
 * Test suite for the useChangePasswordDeps factory. Verifies that it returns a
 * correctly shaped dependency object wired to the data layer.
 */
describe('useChangePasswordDeps', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** Tests that the factory returns all expected dependencies. */
  it('returns a deps object with all required keys', () => {
    const resetDatabase = jest.fn();
    mockUseDatabaseInfo.mockReturnValue({
      databasePath: '/mock/test.db',
      sqliteDb: {
        closeAsync: jest.fn().mockResolvedValue(undefined),
      },
      isCurrentlyEncrypted: true,
      resetDatabase,
    });

    const showSnackbar = jest.fn();
    const { result } = renderHook(() => useChangePasswordDeps(showSnackbar));

    expect(typeof result.current.closeCurrentConnection).toBe('function');
    expect(typeof result.current.changeDatabaseEncryptionKey).toBe('function');
    expect(typeof result.current.resetDatabase).toBe('function');
    expect(typeof result.current.backupDatabase).toBe('function');
    expect(typeof result.current.getBackupDirectoryUri).toBe('function');
    expect(typeof result.current.setBackupDirectoryUri).toBe('function');
    expect(typeof result.current.getDatabasePath).toBe('function');
    expect(typeof result.current.getLatestMigrationKey).toBe('function');
    expect(typeof result.current.requestDirectoryPermissions).toBe('function');
    expect(result.current.showSnackbar).toBe(showSnackbar);
    // resetDatabase is forwarded from context verbatim.
    expect(result.current.resetDatabase).toBe(resetDatabase);
  });

  /** Tests that closeCurrentConnection calls closeAsync when sqliteDb is present. */
  it('closeCurrentConnection calls closeAsync on the sqliteDb', async () => {
    const closeAsync = jest.fn().mockResolvedValue(undefined);
    mockUseDatabaseInfo.mockReturnValue({
      databasePath: '/mock/test.db',
      sqliteDb: { closeAsync },
      isCurrentlyEncrypted: true,
      resetDatabase: jest.fn(),
    });

    const showSnackbar = jest.fn();
    const { result } = renderHook(() => useChangePasswordDeps(showSnackbar));

    await result.current.closeCurrentConnection();
    expect(closeAsync).toHaveBeenCalled();
  });

  /** Tests that closeCurrentConnection swallows close errors. */
  it('closeCurrentConnection swallows close errors', async () => {
    const closeAsync = jest.fn().mockRejectedValue(new Error('close failed'));
    mockUseDatabaseInfo.mockReturnValue({
      databasePath: '/mock/test.db',
      sqliteDb: { closeAsync },
      isCurrentlyEncrypted: true,
      resetDatabase: jest.fn(),
    });

    const showSnackbar = jest.fn();
    const { result } = renderHook(() => useChangePasswordDeps(showSnackbar));

    await expect(result.current.closeCurrentConnection()).resolves.not.toThrow();
  });

  /** Tests that getDatabasePath returns the path when databasePath is set. */
  it('getDatabasePath returns the databasePath from context', async () => {
    mockUseDatabaseInfo.mockReturnValue({
      databasePath: '/mock/prod.db',
      sqliteDb: null,
      isCurrentlyEncrypted: true,
      resetDatabase: jest.fn(),
    });

    const showSnackbar = jest.fn();
    const { result } = renderHook(() => useChangePasswordDeps(showSnackbar));

    await expect(result.current.getDatabasePath()).resolves.toBe('/mock/prod.db');
  });

  /** Tests that getDatabasePath throws when databasePath is null. */
  it('getDatabasePath throws when databasePath is not available', async () => {
    mockUseDatabaseInfo.mockReturnValue({
      databasePath: null,
      sqliteDb: null,
      isCurrentlyEncrypted: true,
      resetDatabase: jest.fn(),
    });

    const showSnackbar = jest.fn();
    const { result } = renderHook(() => useChangePasswordDeps(showSnackbar));

    await expect(result.current.getDatabasePath()).rejects.toThrow(
      'Database not initialized; cannot resolve path',
    );
  });

  /** CloseCurrentConnection is a no-op when sqliteDb is null. */
  it('closeCurrentConnection does nothing when sqliteDb is null', async () => {
    mockUseDatabaseInfo.mockReturnValue({
      databasePath: '/mock/test.db',
      sqliteDb: null,
      isCurrentlyEncrypted: true,
      resetDatabase: jest.fn(),
    });

    const showSnackbar = jest.fn();
    const { result } = renderHook(() => useChangePasswordDeps(showSnackbar));

    await expect(result.current.closeCurrentConnection()).resolves.toBeUndefined();
  });

  /** RequestDirectoryPermissions delegates to StorageAccessFramework. */
  it('requestDirectoryPermissions delegates to StorageAccessFramework', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoFs = require('expo-file-system/legacy');
    ExpoFs.StorageAccessFramework.requestDirectoryPermissionsAsync.mockResolvedValue({
      granted: true,
      directoryUri: 'content://dir',
    });

    mockUseDatabaseInfo.mockReturnValue({
      databasePath: '/mock/test.db',
      sqliteDb: null,
      isCurrentlyEncrypted: true,
      resetDatabase: jest.fn(),
    });

    const showSnackbar = jest.fn();
    const { result } = renderHook(() => useChangePasswordDeps(showSnackbar));

    const response = await result.current.requestDirectoryPermissions();
    expect(ExpoFs.StorageAccessFramework.requestDirectoryPermissionsAsync).toHaveBeenCalled();
    expect(response).toEqual({ granted: true, directoryUri: 'content://dir' });
  });
});
