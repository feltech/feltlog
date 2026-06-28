import { renderHook, act } from '@testing-library/react-native';
import { useChangePassword, type UseChangePasswordDeps } from '../useChangePassword';

/**
 * Creates a fully-mocked UseChangePasswordDeps object for testing.
 *
 * @param overrides - Optional partial deps to merge over the defaults.
 *
 * @returns A UseChangePasswordDeps object suitable for passing to useChangePassword.
 */
function makeDeps(overrides: Partial<UseChangePasswordDeps> = {}): UseChangePasswordDeps {
  return {
    closeCurrentConnection: jest.fn().mockResolvedValue(undefined),
    changeDatabaseEncryptionKey: jest.fn().mockResolvedValue({ success: true }),
    resetDatabase: jest.fn(),
    backupDatabase: jest.fn().mockResolvedValue({ success: true }),
    getBackupDirectoryUri: jest.fn().mockResolvedValue('content://mock-dir'),
    setBackupDirectoryUri: jest.fn().mockResolvedValue(undefined),
    getDatabasePath: jest.fn().mockResolvedValue('/mock/test.db'),
    getLatestMigrationKey: jest.fn().mockReturnValue('20260523_one'),
    requestDirectoryPermissions: jest
      .fn()
      .mockResolvedValue({ granted: true, directoryUri: 'content://new' }),
    showSnackbar: jest.fn(),
    ...overrides,
  };
}

describe('useChangePassword', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** Tests that open resets form state and shows the dialog. */
  it('open resets form state and shows dialog', () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useChangePassword({ databaseName: 'test.db', isCurrentlyEncrypted: true }, deps),
    );

    act(() => {
      result.current.setCurrentKey('old');
      result.current.setNewKey('new');
      result.current.setConfirmKey('new');
    });

    act(() => {
      result.current.open();
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.currentKey).toBe('');
    expect(result.current.newKey).toBe('');
    expect(result.current.confirmKey).toBe('');
  });

  /** Tests that close hides the dialog and resets form state. */
  it('close hides dialog and resets form', () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useChangePassword({ databaseName: 'test.db', isCurrentlyEncrypted: true }, deps),
    );

    act(() => {
      result.current.open();
    });
    expect(result.current.isOpen).toBe(true);

    act(() => {
      result.current.setCurrentKey('old');
      result.current.setNewKey('new');
    });

    act(() => {
      result.current.close();
    });

    expect(result.current.isOpen).toBe(false);
    expect(result.current.currentKey).toBe('');
    expect(result.current.newKey).toBe('');
  });

  /** Tests that submit with mismatched newKey/confirmKey shows error snackbar. */
  it('submit shows error when newKey and confirmKey do not match', () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useChangePassword({ databaseName: 'test.db', isCurrentlyEncrypted: true }, deps),
    );

    act(() => {
      result.current.setNewKey('new');
      result.current.setConfirmKey('different');
    });

    act(() => {
      result.current.submit();
    });

    expect(deps.showSnackbar).toHaveBeenCalledWith('New key and confirmation do not match', true);
    expect(result.current.showConfirmDialog).toBe(false);
  });

  /** Tests that submit with same newKey/currentKey shows "key unchanged" error. */
  it('submit shows error when newKey equals currentKey on encrypted DB', () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useChangePassword({ databaseName: 'test.db', isCurrentlyEncrypted: true }, deps),
    );

    act(() => {
      result.current.setCurrentKey('same');
      result.current.setNewKey('same');
      result.current.setConfirmKey('same');
    });

    act(() => {
      result.current.submit();
    });

    expect(deps.showSnackbar).toHaveBeenCalledWith(
      'New key must be different from the current key',
      true,
    );
    expect(result.current.showConfirmDialog).toBe(false);
  });

  /** Tests that submit with valid inputs opens the confirm dialog. */
  it('submit opens confirm dialog when inputs are valid', () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useChangePassword({ databaseName: 'test.db', isCurrentlyEncrypted: true }, deps),
    );

    act(() => {
      result.current.setCurrentKey('old');
      result.current.setNewKey('new');
      result.current.setConfirmKey('new');
    });

    act(() => {
      result.current.submit();
    });

    expect(result.current.showConfirmDialog).toBe(true);
    expect(deps.showSnackbar).not.toHaveBeenCalled();
  });

  /** ConfirmProceed shows error when no backup directory is configured. */
  it('confirmProceed shows error when no backup directory is configured', async () => {
    const deps = makeDeps({
      getBackupDirectoryUri: jest.fn().mockResolvedValue(null),
      requestDirectoryPermissions: jest.fn().mockResolvedValue({ granted: false }),
    });
    const { result } = renderHook(() =>
      useChangePassword({ databaseName: 'test.db', isCurrentlyEncrypted: true }, deps),
    );

    act(() => {
      result.current.setCurrentKey('old');
      result.current.setNewKey('new');
      result.current.setConfirmKey('new');
    });
    act(() => {
      result.current.submit();
    });

    await act(async () => {
      await result.current.confirmProceed();
    });

    expect(deps.showSnackbar).toHaveBeenCalledWith('Choose a backup location first', true);
    expect(result.current.submitting).toBe(false);
  });

  /** ConfirmProceed shows error when user declines directory picker. */
  it('confirmProceed shows error when user declines directory picker', async () => {
    const deps = makeDeps({
      getBackupDirectoryUri: jest.fn().mockResolvedValue(null),
      requestDirectoryPermissions: jest.fn().mockResolvedValue({ granted: true }),
    });
    const { result } = renderHook(() =>
      useChangePassword({ databaseName: 'test.db', isCurrentlyEncrypted: true }, deps),
    );

    act(() => {
      result.current.setCurrentKey('old');
      result.current.setNewKey('new');
      result.current.setConfirmKey('new');
    });
    act(() => {
      result.current.submit();
    });

    await act(async () => {
      await result.current.confirmProceed();
    });

    expect(deps.showSnackbar).toHaveBeenCalledWith('Choose a backup location first', true);
  });

  /**
   * Tests the happy path where the user grants permission AND provides a directoryUri.
   * The hook should persist the new URI and proceed.
   */
  it('confirmProceed: persists the picked directoryUri and proceeds with the backup', async () => {
    const setBackupDirectoryUri = jest.fn().mockResolvedValue(undefined);
    const backupDatabase = jest.fn().mockResolvedValue({ success: true });
    const closeCurrentConnection = jest.fn().mockResolvedValue(undefined);
    const rekey = jest.fn().mockResolvedValue({ success: true });
    const resetDatabase = jest.fn();
    const getBackupDirectoryUri = jest.fn().mockResolvedValue(null); // not configured yet
    const getDatabasePath = jest.fn().mockResolvedValue('/mock/target.db');
    const getLatestMigrationKey = jest.fn().mockReturnValue('20260523_one');
    const requestDirectoryPermissions = jest.fn().mockResolvedValue({
      granted: true,
      directoryUri: 'content://picked',
    });
    const showSnackbar = jest.fn();

    const deps: UseChangePasswordDeps = {
      closeCurrentConnection,
      changeDatabaseEncryptionKey: rekey,
      resetDatabase,
      backupDatabase,
      getBackupDirectoryUri,
      setBackupDirectoryUri,
      getDatabasePath,
      getLatestMigrationKey,
      requestDirectoryPermissions,
      showSnackbar,
    };

    const { result } = renderHook(() =>
      useChangePassword({ databaseName: 'test.db', isCurrentlyEncrypted: true }, deps),
    );

    // Open the dialog and fill in the form.
    act(() => result.current.open());
    act(() => {
      result.current.setCurrentKey('oldkey');
      result.current.setNewKey('newkey');
      result.current.setConfirmKey('newkey');
    });

    // Submit (opens the confirm dialog).
    act(() => {
      result.current.submit();
    });

    // Confirm (proceeds with the flow).
    await act(async () => {
      await result.current.confirmProceed();
    });

    // The new URI was persisted.
    expect(setBackupDirectoryUri).toHaveBeenCalledWith('content://picked');
    // The backup was performed.
    expect(backupDatabase).toHaveBeenCalled();
    // The rekey was performed.
    expect(rekey).toHaveBeenCalledWith('oldkey', 'newkey', 'test.db');
    // The app state was reset so the setup screen reappears.
    expect(resetDatabase).toHaveBeenCalled();
  });

  /** Tests the happy path of confirmProceed. */
  it('confirmProceed happy path: backup, rekey, resetDatabase, dialog closes', async () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useChangePassword({ databaseName: 'test.db', isCurrentlyEncrypted: true }, deps),
    );

    act(() => {
      result.current.setCurrentKey('old');
      result.current.setNewKey('new');
      result.current.setConfirmKey('new');
    });
    act(() => {
      result.current.submit();
    });

    await act(async () => {
      await result.current.confirmProceed();
    });

    expect(deps.closeCurrentConnection).toHaveBeenCalled();
    expect(deps.changeDatabaseEncryptionKey).toHaveBeenCalledWith('old', 'new', 'test.db');
    expect(deps.resetDatabase).toHaveBeenCalled();
    // No success snackbar — the component unmounts as the setup screen replaces
    // the app tree.
    expect(deps.showSnackbar).not.toHaveBeenCalled();
    expect(result.current.isOpen).toBe(false);
    expect(result.current.submitting).toBe(false);
  });

  /** ConfirmProceed shows error when rekey fails. */
  it('confirmProceed shows error when rekey fails', async () => {
    const deps = makeDeps({
      changeDatabaseEncryptionKey: jest
        .fn()
        .mockResolvedValue({ success: false, error: 'bad key' }),
    });
    const { result } = renderHook(() =>
      useChangePassword({ databaseName: 'test.db', isCurrentlyEncrypted: true }, deps),
    );

    act(() => {
      result.current.open();
      result.current.setCurrentKey('old');
      result.current.setNewKey('new');
      result.current.setConfirmKey('new');
    });
    act(() => {
      result.current.submit();
    });

    await act(async () => {
      await result.current.confirmProceed();
    });

    expect(deps.showSnackbar).toHaveBeenCalledWith('Failed to change password: bad key', true);
    expect(result.current.isOpen).toBe(true);
    expect(result.current.submitting).toBe(false);
  });

  /** Tests that a safety backup failure shows an error snackbar. */
  it('confirmProceed shows error when safety backup fails', async () => {
    const deps = makeDeps({
      backupDatabase: jest.fn().mockResolvedValue({ success: false, error: 'disk full' }),
    });
    const { result } = renderHook(() =>
      useChangePassword({ databaseName: 'test.db', isCurrentlyEncrypted: true }, deps),
    );

    act(() => {
      result.current.setCurrentKey('old');
      result.current.setNewKey('new');
      result.current.setConfirmKey('new');
    });
    act(() => {
      result.current.submit();
    });

    await act(async () => {
      await result.current.confirmProceed();
    });

    expect(deps.showSnackbar).toHaveBeenCalledWith('Safety backup failed: disk full', true);
    expect(deps.changeDatabaseEncryptionKey).not.toHaveBeenCalled();
    expect(result.current.submitting).toBe(false);
  });

  /** Tests that cancelProceed closes the confirm dialog. */
  it('cancelProceed closes confirm dialog', () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useChangePassword({ databaseName: 'test.db', isCurrentlyEncrypted: true }, deps),
    );

    act(() => {
      result.current.setCurrentKey('old');
      result.current.setNewKey('new');
      result.current.setConfirmKey('new');
    });
    act(() => {
      result.current.submit();
    });
    expect(result.current.showConfirmDialog).toBe(true);

    act(() => {
      result.current.cancelProceed();
    });
    expect(result.current.showConfirmDialog).toBe(false);
  });

  /** Tests removing encryption (currentKey non-empty, newKey empty). */
  it('removing encryption succeeds with empty newKey', async () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useChangePassword({ databaseName: 'test.db', isCurrentlyEncrypted: true }, deps),
    );

    act(() => {
      result.current.setCurrentKey('old');
      result.current.setNewKey('');
      result.current.setConfirmKey('');
    });
    act(() => {
      result.current.submit();
    });
    expect(result.current.showConfirmDialog).toBe(true);

    await act(async () => {
      await result.current.confirmProceed();
    });

    expect(deps.changeDatabaseEncryptionKey).toHaveBeenCalledWith('old', '', 'test.db');
    expect(deps.resetDatabase).toHaveBeenCalled();
  });

  /** Tests adding encryption to an unencrypted DB. */
  it('adding encryption succeeds with empty currentKey', async () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useChangePassword({ databaseName: 'test.db', isCurrentlyEncrypted: false }, deps),
    );

    act(() => {
      result.current.setCurrentKey('');
      result.current.setNewKey('new');
      result.current.setConfirmKey('new');
    });
    act(() => {
      result.current.submit();
    });
    expect(result.current.showConfirmDialog).toBe(true);

    await act(async () => {
      await result.current.confirmProceed();
    });

    expect(deps.changeDatabaseEncryptionKey).toHaveBeenCalledWith('', 'new', 'test.db');
    expect(deps.resetDatabase).toHaveBeenCalled();
  });

  /** Tests that an exception during confirmProceed is caught and shown as snackbar. */
  it('confirmProceed shows error when an unexpected exception is thrown', async () => {
    const deps = makeDeps({
      backupDatabase: jest.fn().mockRejectedValue(new Error('network error')),
    });
    const { result } = renderHook(() =>
      useChangePassword({ databaseName: 'test.db', isCurrentlyEncrypted: true }, deps),
    );

    act(() => {
      result.current.setCurrentKey('old');
      result.current.setNewKey('new');
      result.current.setConfirmKey('new');
    });
    act(() => {
      result.current.submit();
    });

    await act(async () => {
      await result.current.confirmProceed();
    });

    expect(deps.showSnackbar).toHaveBeenCalledWith(
      'Failed to change password: network error',
      true,
    );
    expect(result.current.submitting).toBe(false);
  });

  /** The catch block stringifies non-Error rejections. */
  it('shows a stringified error when changeDatabaseEncryptionKey rejects with a string', async () => {
    const deps = makeDeps({
      changeDatabaseEncryptionKey: jest.fn().mockRejectedValue('raw error'),
    });

    const { result } = renderHook(() =>
      useChangePassword({ databaseName: 'test.db', isCurrentlyEncrypted: true }, deps),
    );

    act(() => {
      result.current.setCurrentKey('old');
      result.current.setNewKey('new');
      result.current.setConfirmKey('new');
    });
    act(() => {
      result.current.submit();
    });

    await act(async () => {
      await result.current.confirmProceed();
    });

    expect(deps.showSnackbar).toHaveBeenCalledWith('Failed to change password: raw error', true);
    expect(result.current.submitting).toBe(false);
  });

  /** The hook requests a backup directory when none is configured. */
  it('requests a backup directory when none is configured', async () => {
    const deps = makeDeps({
      getBackupDirectoryUri: jest.fn().mockResolvedValue(null),
      requestDirectoryPermissions: jest
        .fn()
        .mockResolvedValue({ granted: true, directoryUri: 'content://new-dir' }),
    });

    const { result } = renderHook(() =>
      useChangePassword({ databaseName: 'test.db', isCurrentlyEncrypted: true }, deps),
    );

    act(() => {
      result.current.setCurrentKey('old');
      result.current.setNewKey('new');
      result.current.setConfirmKey('new');
    });
    act(() => {
      result.current.submit();
    });

    await act(async () => {
      await result.current.confirmProceed();
    });

    expect(deps.requestDirectoryPermissions).toHaveBeenCalled();
    expect(deps.setBackupDirectoryUri).toHaveBeenCalledWith('content://new-dir');
  });

  /** Tests that unencrypted DB with empty newKey shows validation error. */
  it('submit shows error when adding encryption with empty newKey', () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useChangePassword({ databaseName: 'test.db', isCurrentlyEncrypted: false }, deps),
    );

    act(() => {
      result.current.setCurrentKey('');
      result.current.setNewKey('');
      result.current.setConfirmKey('');
    });

    act(() => {
      result.current.submit();
    });

    expect(deps.showSnackbar).toHaveBeenCalledWith('Provide a new key to add encryption', true);
    expect(result.current.showConfirmDialog).toBe(false);
  });
});
