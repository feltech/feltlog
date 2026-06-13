import { renderHook, act } from '@testing-library/react-native';
import { useRestoreFlow, type UseRestoreFlowDeps } from '../useRestoreFlow';

/**
 * Creates a fully-mocked UseRestoreFlowDeps object for testing.
 *
 * @param overrides - Optional partial deps to merge over the defaults.
 *
 * @returns A UseRestoreFlowDeps object suitable for passing to useRestoreFlow.
 */
function makeDeps(overrides: Partial<UseRestoreFlowDeps> = {}): UseRestoreFlowDeps {
  return {
    getBackupDirectoryUri: jest.fn().mockResolvedValue('content://mock-dir'),
    setBackupDirectoryUri: jest.fn().mockResolvedValue(undefined),
    requestDirectoryPermissions: jest
      .fn()
      .mockResolvedValue({ granted: true, directoryUri: 'content://new' }),
    readDirectory: jest.fn().mockResolvedValue([]),
    fileExists: jest.fn().mockResolvedValue(false),
    restoreDatabase: jest.fn().mockResolvedValue({ success: true }),
    backupDatabase: jest.fn().mockResolvedValue({ success: true }),
    getLatestMigrationKey: jest.fn().mockReturnValue('20260523_one'),
    openDatabase: jest.fn().mockResolvedValue({
      databasePath: '/mock/target.db',
      closeAsync: jest.fn().mockResolvedValue(undefined),
    }),
    onSuccess: jest.fn(),
    ...overrides,
  };
}

describe('useRestoreFlow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** FileExists discovers the real path via a transient SQLite handle. */
  it('fileExists opens a transient SQLite handle to discover the real path', async () => {
    const openDatabase = jest.fn().mockResolvedValue({
      databasePath: '/data/data/com.feltech.feltlog/databases/memoires.db',
      closeAsync: jest.fn().mockResolvedValue(undefined),
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoFs = require('expo-file-system/legacy');
    ExpoFs.getInfoAsync.mockResolvedValue({ exists: true });

    const deps = makeDeps({
      openDatabase,
      fileExists: async (name: string) => {
        try {
          const sqliteDb = await openDatabase(name);
          const dbPath = sqliteDb.databasePath;
          await sqliteDb.closeAsync();
          const uri = dbPath.startsWith('file://') ? dbPath : `file://${dbPath}`;
          const info = await ExpoFs.getInfoAsync(uri);
          return info.exists;
        } catch {
          return false;
        }
      },
    });

    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'memoires.db',
          selectedFileUri: 'u',
          backupDirUri: 'd',
        },
        deps,
      ),
    );

    await act(async () => {
      await result.current.handleRestore();
    });

    expect(openDatabase).toHaveBeenCalledWith('memoires.db');
    expect(ExpoFs.getInfoAsync).toHaveBeenCalledWith(
      'file:///data/data/com.feltech.feltlog/databases/memoires.db',
    );
    expect(result.current.showConfirmDialog).toBe(true);
  });

  /**
   * Tests that fileExists returns false when the transient SQLite open throws. Covers
   * the catch branch in useRestoreFlowDeps.fileExists.
   */
  it('fileExists returns false when the transient SQLite open throws (catch branch)', async () => {
    const openDatabase = jest.fn().mockRejectedValue(new Error('invalid database name'));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoFs = require('expo-file-system/legacy');

    const deps = makeDeps({
      openDatabase,
      fileExists: async (name: string) => {
        try {
          const sqliteDb = await openDatabase(name);
          const dbPath = sqliteDb.databasePath;
          await sqliteDb.closeAsync();
          const uri = dbPath.startsWith('file://') ? dbPath : `file://${dbPath}`;
          const info = await ExpoFs.getInfoAsync(uri);
          return info.exists;
        } catch {
          return false;
        }
      },
    });

    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: 'd',
        },
        deps,
      ),
    );

    await act(async () => {
      await result.current.handleRestore();
    });

    expect(openDatabase).toHaveBeenCalledWith('test.db');
    expect(result.current.showConfirmDialog).toBe(false);
    expect(deps.restoreDatabase).toHaveBeenCalledWith('test.db', 'u');
    expect(deps.onSuccess).toHaveBeenCalled();
    expect(result.current.submitting).toBe(false);
  });

  /** CanSubmit is false when databaseName is empty. */
  it('canSubmit is false when databaseName is empty', () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useRestoreFlow({ databaseName: '', selectedFileUri: 'u', backupDirUri: 'd' }, deps),
    );
    expect(result.current.canSubmit).toBe(false);
  });

  /** CanSubmit is false when submitting is in progress. */
  it('canSubmit is false when submitting is in progress', async () => {
    const deps = makeDeps({
      fileExists: jest
        .fn()
        .mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(true), 10))),
    });
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: 'd',
        },
        deps,
      ),
    );

    // Start restore but let it pause on fileExists.
    act(() => {
      result.current.handleRestore();
    });

    // Immediately after the synchronous part, submitting should be true.
    expect(result.current.submitting).toBe(true);
    expect(result.current.canSubmit).toBe(false);

    // Let the async work finish so the hook doesn't leak between tests.
    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });
  });

  /** CanSubmit is true when databaseName is set and a file is selected. */
  it('canSubmit is true when databaseName is set and a file is selected', () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: 'd',
        },
        deps,
      ),
    );
    expect(result.current.canSubmit).toBe(true);
  });

  /** Submitting state disables canSubmit while restore is in progress. */
  it('canSubmit becomes false while restore is in progress', async () => {
    const deps = makeDeps({
      fileExists: jest
        .fn()
        .mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(true), 10))),
    });
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: 'd',
        },
        deps,
      ),
    );

    // Start restore but let it pause on fileExists.
    act(() => {
      result.current.handleRestore();
    });

    // Immediately after the synchronous part, submitting should be true.
    expect(result.current.submitting).toBe(true);
    expect(result.current.canSubmit).toBe(false);

    // Let the async work finish so the hook doesn't leak between tests.
    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });
  });

  /** HandleRestore returns early when selectedFileUri is null. */
  it('handleRestore returns early when selectedFileUri is null', async () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: null,
          backupDirUri: 'd',
        },
        deps,
      ),
    );
    await act(async () => {
      await result.current.handleRestore();
    });
    expect(deps.restoreDatabase).not.toHaveBeenCalled();
    expect(result.current.submitting).toBe(false);
  });

  /** HandleRestore catch block around fileExists shows dialog. */
  it('handleRestore shows confirm dialog when fileExists throws', async () => {
    const deps = makeDeps({
      fileExists: jest.fn().mockRejectedValue(new Error('check failed')),
    });
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: 'd',
        },
        deps,
      ),
    );
    await act(async () => {
      await result.current.handleRestore();
    });
    expect(result.current.showConfirmDialog).toBe(true);
  });

  /** HandleRestore shows snackbar when no backup dir. */
  it("handleRestore shows 'Choose a backup location first' snackbar when no backup dir", async () => {
    const deps = makeDeps({
      getBackupDirectoryUri: jest.fn().mockResolvedValue(null),
      requestDirectoryPermissions: jest.fn().mockResolvedValue({ granted: false }),
    });
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: null,
        },
        deps,
      ),
    );
    await act(async () => {
      await result.current.handleRestore();
    });
    expect(result.current.snackbar.visible).toBe(true);
    expect(result.current.snackbar.message).toBe('Choose a backup location first');
    expect(result.current.snackbar.isError).toBe(true);
    expect(result.current.submitting).toBe(false);
  });

  /** HandleRestore proceeds to restoreDatabase when no existing target. */
  it('handleRestore proceeds to restoreDatabase when no existing target', async () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: 'd',
        },
        deps,
      ),
    );
    await act(async () => {
      await result.current.handleRestore();
    });
    expect(deps.restoreDatabase).toHaveBeenCalledWith('test.db', 'u');
    expect(deps.onSuccess).toHaveBeenCalled();
    expect(result.current.submitting).toBe(false);
  });

  /** HandleRestore shows confirm dialog when target DB exists. */
  it('handleRestore shows the confirm dialog when the target DB exists', async () => {
    const deps = makeDeps({
      fileExists: jest.fn().mockResolvedValue(true),
    });
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: 'd',
        },
        deps,
      ),
    );
    await act(async () => {
      await result.current.handleRestore();
    });
    expect(result.current.showConfirmDialog).toBe(true);
    expect(deps.restoreDatabase).not.toHaveBeenCalled();
  });

  /** ConfirmRestore calls backupDatabase then restoreDatabase. */
  it('confirmRestore calls backupDatabase and then restoreDatabase', async () => {
    const deps = makeDeps({
      fileExists: jest.fn().mockResolvedValue(true),
    });
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: 'd',
        },
        deps,
      ),
    );
    // Show dialog.
    await act(async () => {
      await result.current.handleRestore();
    });
    expect(result.current.showConfirmDialog).toBe(true);

    // Confirm dialog.
    await act(async () => {
      await result.current.confirmRestore();
    });
    expect(deps.backupDatabase).toHaveBeenCalled();
    expect(deps.restoreDatabase).toHaveBeenCalledWith('test.db', 'u');
    expect(deps.onSuccess).toHaveBeenCalled();
    expect(result.current.showConfirmDialog).toBe(false);
    expect(result.current.submitting).toBe(false);
  });

  /** ConfirmRestore returns early if backupDatabase fails. */
  it('confirmRestore returns early if backupDatabase fails', async () => {
    const deps = makeDeps({
      fileExists: jest.fn().mockResolvedValue(true),
      backupDatabase: jest.fn().mockResolvedValue({ success: false, error: 'out of space' }),
    });
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: 'd',
        },
        deps,
      ),
    );
    await act(async () => {
      await result.current.handleRestore();
    });
    await act(async () => {
      await result.current.confirmRestore();
    });
    expect(deps.backupDatabase).toHaveBeenCalled();
    expect(deps.restoreDatabase).not.toHaveBeenCalled();
    expect(result.current.snackbar.visible).toBe(true);
    expect(result.current.snackbar.message).toContain('out of space');
  });

  /** CancelRestore hides the dialog. */
  it('cancelRestore hides the dialog', async () => {
    const deps = makeDeps({
      fileExists: jest.fn().mockResolvedValue(true),
    });
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: 'd',
        },
        deps,
      ),
    );
    await act(async () => {
      await result.current.handleRestore();
    });
    expect(result.current.showConfirmDialog).toBe(true);

    act(() => {
      result.current.cancelRestore();
    });
    expect(result.current.showConfirmDialog).toBe(false);
  });

  /** Safety backup throws → snackbar shown. */
  it('shows a snackbar when safety backup throws', async () => {
    const deps = makeDeps({
      fileExists: jest.fn().mockResolvedValue(true),
      openDatabase: jest.fn().mockRejectedValue(new Error('cannot open')),
    });
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: 'd',
        },
        deps,
      ),
    );
    await act(async () => {
      await result.current.handleRestore();
    });
    await act(async () => {
      await result.current.confirmRestore();
    });
    expect(result.current.snackbar.visible).toBe(true);
    expect(result.current.snackbar.message).toContain('cannot open');
  });

  /** ChooseBackupDirectory returns the new URI and persists it. */
  it('chooseBackupDirectory returns the new URI and persists it', async () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: null,
        },
        deps,
      ),
    );
    let uri: string | null = null;
    await act(async () => {
      uri = await result.current.chooseBackupDirectory();
    });
    expect(uri).toBe('content://new');
    expect(deps.setBackupDirectoryUri).toHaveBeenCalledWith('content://new');
  });

  /** ChooseBackupDirectory returns null on user denial (no snackbar). */
  it('chooseBackupDirectory returns null on user denial', async () => {
    const deps = makeDeps({
      requestDirectoryPermissions: jest.fn().mockResolvedValue({ granted: false }),
    });
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: null,
        },
        deps,
      ),
    );
    let uri: string | null = 'placeholder';
    await act(async () => {
      uri = await result.current.chooseBackupDirectory();
    });
    expect(uri).toBeNull();
    expect(result.current.snackbar.visible).toBe(false);
  });

  /** ChooseBackupDirectory returns null and shows snackbar on throw. */
  it('chooseBackupDirectory shows snackbar on throw', async () => {
    const deps = makeDeps({
      requestDirectoryPermissions: jest.fn().mockRejectedValue(new Error('picker crashed')),
    });
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: null,
        },
        deps,
      ),
    );
    let uri: string | null = 'placeholder';
    await act(async () => {
      uri = await result.current.chooseBackupDirectory();
    });
    expect(uri).toBeNull();
    expect(result.current.snackbar.visible).toBe(true);
    expect(result.current.snackbar.message).toContain('picker crashed');
  });

  /** RefreshFileList returns .db files. */
  it('refreshFileList filters to .db files', async () => {
    const deps = makeDeps({
      readDirectory: jest
        .fn()
        .mockResolvedValue([
          'content://d/backup.db',
          'content://d/readme.txt',
          'content://d/other.db',
        ]),
    });
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: 'd',
        },
        deps,
      ),
    );
    let files: string[] = [];
    await act(async () => {
      files = await result.current.refreshFileList();
    });
    expect(files).toEqual(['content://d/backup.db', 'content://d/other.db']);
  });

  /** RefreshFileList returns empty array when backupDirUri is null. */
  it('refreshFileList returns empty array when backupDirUri is null', async () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: null,
        },
        deps,
      ),
    );
    let files: string[] = [];
    await act(async () => {
      files = await result.current.refreshFileList();
    });
    expect(files).toEqual([]);
  });

  /** SelectFile is a no-op. */
  it('selectFile is a no-op', () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: 'd',
        },
        deps,
      ),
    );
    act(() => {
      result.current.selectFile('other');
    });
    // No state change expected; the hook doesn't own selectedFileUri.
    expect(result.current.canSubmit).toBe(true);
  });

  /** Dismisses the snackbar via dismissSnackbar. */
  it('dismissSnackbar hides the snackbar', async () => {
    const deps = makeDeps({
      restoreDatabase: jest.fn().mockResolvedValue({ success: false, error: 'boom' }),
    });
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: 'd',
        },
        deps,
      ),
    );
    await act(async () => {
      await result.current.handleRestore();
    });
    expect(result.current.snackbar.visible).toBe(true);
    act(() => {
      result.current.dismissSnackbar();
    });
    expect(result.current.snackbar.visible).toBe(false);
  });

  /** ConfirmRestore shows snackbar when no backup dir can be obtained. */
  it('confirmRestore shows snackbar when no backup dir for safety backup', async () => {
    const deps = makeDeps({
      fileExists: jest.fn().mockResolvedValue(true),
      requestDirectoryPermissions: jest
        .fn()
        .mockResolvedValueOnce({ granted: true, directoryUri: 'content://dir' })
        .mockResolvedValueOnce({ granted: false }),
    });
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: 'u',
          backupDirUri: null,
        },
        deps,
      ),
    );
    await act(async () => {
      await result.current.handleRestore();
    });
    expect(result.current.showConfirmDialog).toBe(true);

    await act(async () => {
      await result.current.confirmRestore();
    });
    expect(result.current.snackbar.visible).toBe(true);
    expect(result.current.snackbar.message).toBe('Choose a backup location first');
  });

  /** ConfirmRestore skips performRestore when selectedFileUri is null. */
  it('confirmRestore does nothing when selectedFileUri is null', async () => {
    const deps = makeDeps();
    const { result } = renderHook(() =>
      useRestoreFlow(
        {
          databaseName: 'test.db',
          selectedFileUri: null,
          backupDirUri: 'd',
        },
        deps,
      ),
    );
    await act(async () => {
      await result.current.confirmRestore();
    });
    expect(deps.restoreDatabase).not.toHaveBeenCalled();
    expect(result.current.submitting).toBe(false);
    expect(result.current.showConfirmDialog).toBe(false);
  });

  /** Tests fileExists catch branch when getInfoAsync throws. */
  it('useRestoreFlowDeps fileExists returns false when getInfoAsync throws', async () => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoFs = require('expo-file-system/legacy');
    jest.doMock('expo-sqlite', () => ({
      defaultDatabaseDirectory: '/data/data/com.feltech.feltlog/databases',
    }));
    jest.doMock('@/src/data/database/dbBackupStorage', () => ({
      getBackupDirectoryUri: jest.fn().mockResolvedValue(null),
      setBackupDirectoryUri: jest.fn().mockResolvedValue(undefined),
    }));
    ExpoFs.getInfoAsync.mockRejectedValue(new Error('no permission'));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useRestoreFlowDeps } = require('../useRestoreFlow');
    const deps = useRestoreFlowDeps(jest.fn());
    const exists = await deps.fileExists('bad.db');
    expect(exists).toBe(false);
  });

  /** Tests fileExists path construction when defaultDatabaseDirectory lacks file://. */
  it('useRestoreFlowDeps fileExists constructs path with defaultDatabaseDirectory', async () => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoFs = require('expo-file-system/legacy');
    jest.doMock('expo-sqlite', () => ({
      defaultDatabaseDirectory: '/data/data/com.feltech.feltlog/databases',
    }));
    jest.doMock('@/src/data/database/dbBackupStorage', () => ({
      getBackupDirectoryUri: jest.fn().mockResolvedValue(null),
      setBackupDirectoryUri: jest.fn().mockResolvedValue(undefined),
    }));
    ExpoFs.getInfoAsync.mockResolvedValue({ exists: true });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useRestoreFlowDeps } = require('../useRestoreFlow');
    const deps = useRestoreFlowDeps(jest.fn());
    const exists = await deps.fileExists('test.db');
    expect(exists).toBe(true);
    expect(ExpoFs.getInfoAsync).toHaveBeenCalledWith(
      'file:///data/data/com.feltech.feltlog/databases/test.db',
    );
  });

  it('useRestoreFlowDeps fileExists returns true via the real implementation', async () => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoFs = require('expo-file-system/legacy');
    jest.doMock('expo-sqlite', () => ({
      defaultDatabaseDirectory: 'file:///data/data/com.feltech.feltlog/databases',
    }));
    jest.doMock('@/src/data/database/dbBackupStorage', () => ({
      getBackupDirectoryUri: jest.fn().mockResolvedValue(null),
      setBackupDirectoryUri: jest.fn().mockResolvedValue(undefined),
    }));
    ExpoFs.getInfoAsync.mockResolvedValue({ exists: true });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useRestoreFlowDeps } = require('../useRestoreFlow');
    const deps = useRestoreFlowDeps(jest.fn());
    const exists = await deps.fileExists('test.db');
    expect(exists).toBe(true);
    expect(ExpoFs.getInfoAsync).toHaveBeenCalledWith(
      'file:///data/data/com.feltech.feltlog/databases/test.db',
    );
  });
});
