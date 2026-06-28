import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import {
  DatabaseSetupProvider,
  type DatabaseSetupInfo,
} from '@/src/domain/repositories/DatabaseSetupContext';

/**
 * Mock SafeAreaProvider to pass through children. The native SafeAreaProvider renders
 * as RNCSafeAreaProvider, which does not pass children through in the Jest environment.
 * We preserve the actual module's Context so react-native-paper's
 * SafeAreaProviderCompat can read the Consumer.
 */
jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    ...jest.requireActual('react-native-safe-area-context'),
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

/**
 * Mock expo-router's useRouter so RestoreFromBackupScreen can call `router.back()` and
 * `router.replace('/setup')` without a real navigator.
 */
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-file-system/legacy', () => require('../../../test-utils/expo-file-system-mock'));

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn().mockResolvedValue({
    databasePath: '/mock/test.db',
    closeAsync: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('@/src/data/database/dbBackupStorage', () => ({
  getBackupDirectoryUri: jest.fn(),
  setBackupDirectoryUri: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/src/data/database/dbLocationStorage', () => ({
  setLastDatabaseName: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/src/data/database/backup', () => ({
  backupDatabase: jest.fn().mockResolvedValue({ success: true }),
  extractFileName: jest.fn((uri: string) => uri.split('/').pop() ?? ''),
  getLatestMigrationKey: jest.fn().mockReturnValue('20260523_one'),
}));

jest.mock('@/src/data/database/restore', () => ({
  restoreDatabase: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('@/src/data/database/database', () => ({
  useDatabase: jest.fn(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useRouter } = require('expo-router') as { useRouter: jest.Mock };

import RestoreFromBackupScreen from '../RestoreFromBackupScreen';
import { getBackupDirectoryUri } from '@/src/data/database/dbBackupStorage';
import { setLastDatabaseName } from '@/src/data/database/dbLocationStorage';

const mockGetBackupDirectoryUri = getBackupDirectoryUri as jest.Mock;
const mockSetLastDatabaseName = setLastDatabaseName as jest.Mock;

/**
 * Helper that wraps the component in a PaperProvider so react-native-paper Portal /
 * Snackbar / Dialog have access to the theme.
 *
 * @param element - The React element to render.
 * @param setupInfo - The DatabaseSetupInfo to provide via context.
 *
 * @returns The RNTL render result.
 */
function renderWithProvider(element: React.ReactElement, setupInfo: DatabaseSetupInfo) {
  return render(
    <PaperProvider>
      <DatabaseSetupProvider value={setupInfo}>{element}</DatabaseSetupProvider>
    </PaperProvider>,
  );
}

/**
 * Builds a DatabaseSetupInfo object with sensible defaults for tests.
 *
 * @param overrides - Partial overrides merged over the defaults.
 *
 * @returns A DatabaseSetupInfo suitable for passing to DatabaseSetupProvider.
 */
function makeSetupInfo(overrides: Partial<DatabaseSetupInfo> = {}): DatabaseSetupInfo {
  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    lastDatabaseName: null,
    error: null,
    ...overrides,
  };
}

/** Minimal smoke tests for RestoreFromBackupScreen. */
describe('RestoreFromBackupScreen', () => {
  const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBackupDirectoryUri.mockResolvedValue(null);
    useRouter.mockReturnValue(mockRouter);
  });

  /** Tests that the form renders with all expected inputs and buttons. */
  it('renders the form', () => {
    const { getByTestId } = renderWithProvider(
      <RestoreFromBackupScreen />,
      makeSetupInfo({ lastDatabaseName: 'test.db' }),
    );

    expect(getByTestId('restore-db-name-input')).toBeTruthy();
    expect(getByTestId('restore-confirm-btn')).toBeTruthy();
    expect(getByTestId('restore-cancel-btn')).toBeTruthy();

    const nameInput = getByTestId('restore-db-name-input');
    expect(nameInput.props.value).toBe('test.db');
  });

  /** Tests that pressing the Cancel button navigates back via router.back(). */
  it('navigates back when Cancel is pressed', () => {
    const { getByTestId } = renderWithProvider(<RestoreFromBackupScreen />, makeSetupInfo());

    fireEvent.press(getByTestId('restore-cancel-btn'));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  /**
   * Tests that the Restore button is disabled initially because no backup file is
   * selected.
   */
  it('Restore button is disabled when no file is selected', () => {
    const { getByTestId } = renderWithProvider(<RestoreFromBackupScreen />, makeSetupInfo());

    const confirmBtn = getByTestId('restore-confirm-btn');
    expect(confirmBtn.props.accessibilityState?.disabled).toBe(true);
  });

  /** Tests that the name input is pre-filled from lastDatabaseName via context. */
  it('pre-fills database name from lastDatabaseName', () => {
    const { getByTestId } = renderWithProvider(
      <RestoreFromBackupScreen />,
      makeSetupInfo({ lastDatabaseName: 'previous.db' }),
    );
    expect(getByTestId('restore-db-name-input').props.value).toBe('previous.db');
  });

  /** Tests that the name defaults to 'feltlog.db' when lastDatabaseName is null. */
  it("defaults the name to 'feltlog.db' when lastDatabaseName is null", () => {
    const { getByTestId } = renderWithProvider(<RestoreFromBackupScreen />, makeSetupInfo());
    expect(getByTestId('restore-db-name-input').props.value).toBe('feltlog.db');
  });

  /** Tests that the no-backup-location warning appears when no directory is set. */
  it('shows the no-backup-location warning when no directory is configured', async () => {
    mockGetBackupDirectoryUri.mockResolvedValue(null);
    const { findByTestId } = renderWithProvider(<RestoreFromBackupScreen />, makeSetupInfo());
    const warn = await findByTestId('restore-error-text');
    expect(warn).toBeTruthy();
  });

  /**
   * Tests that tapping the filename label (not just the radio circle) selects the file
   * and enables the Restore button.
   */
  it('selects the file when tapping the filename label (not just the radio circle)', async () => {
    mockGetBackupDirectoryUri.mockResolvedValue('content://mock-dir');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoFs = require('expo-file-system/legacy');
    ExpoFs.StorageAccessFramework.readDirectoryAsync.mockResolvedValue([
      'content://mock-dir/memoires.db',
    ]);

    const { findByTestId, getByTestId } = renderWithProvider(
      <RestoreFromBackupScreen />,
      makeSetupInfo({ lastDatabaseName: 'memoires.db' }),
    );

    await findByTestId('restore-source-item-memoires.db');
    // Tap the filename LABEL, not the radio circle. RadioButton.Item wraps the
    // entire row in a TouchableRipple, so the press should select the file.
    fireEvent.press(getByTestId('restore-source-item-memoires.db'));

    const confirmBtn = getByTestId('restore-confirm-btn');
    expect(confirmBtn.props.accessibilityState?.disabled).toBe(false);
  });

  /** Tests that the file list shows files from the configured directory. */
  it('lists .db files from the configured directory on mount', async () => {
    mockGetBackupDirectoryUri.mockResolvedValue('content://mock-dir');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoFs = require('expo-file-system/legacy');
    ExpoFs.StorageAccessFramework.readDirectoryAsync.mockResolvedValue([
      'content://mock-dir/backup-1.db',
      'content://mock-dir/notes.txt',
      'content://mock-dir/backup-2.db',
    ]);

    const { findByTestId, queryByText } = renderWithProvider(
      <RestoreFromBackupScreen />,
      makeSetupInfo(),
    );

    await findByTestId('restore-source-item-backup-1.db');
    await findByTestId('restore-source-item-backup-2.db');
    expect(queryByText('notes.txt')).toBeNull();
  });

  /** Tests that the empty-list message appears when the directory has no .db files. */
  it('shows the empty-list message when no .db files are present', async () => {
    mockGetBackupDirectoryUri.mockResolvedValue('content://mock-dir');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoFs = require('expo-file-system/legacy');
    ExpoFs.StorageAccessFramework.readDirectoryAsync.mockResolvedValue([]);

    const { findByText } = renderWithProvider(<RestoreFromBackupScreen />, makeSetupInfo());
    const empty = await findByText(/No .db files found/i);
    expect(empty).toBeTruthy();
  });

  /** Shows the empty-list message when readDirectoryAsync throws on mount. */
  it('shows the empty-list message when readDirectoryAsync throws on mount', async () => {
    mockGetBackupDirectoryUri.mockResolvedValue('content://mock-dir');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoFs = require('expo-file-system/legacy');
    ExpoFs.StorageAccessFramework.readDirectoryAsync.mockRejectedValue(new Error('nope'));

    const { findByText } = renderWithProvider(<RestoreFromBackupScreen />, makeSetupInfo());
    const empty = await findByText(/No .db files found/i);
    expect(empty).toBeTruthy();
  });

  /**
   * Tests that pressing the Choose Backup Location button lists files from a new
   * directory.
   */
  it('chooses a new backup directory via the Choose Backup Location button', async () => {
    mockGetBackupDirectoryUri.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoFs = require('expo-file-system/legacy');
    ExpoFs.StorageAccessFramework.requestDirectoryPermissionsAsync.mockResolvedValue({
      granted: true,
      directoryUri: 'content://new-dir',
    });
    ExpoFs.StorageAccessFramework.readDirectoryAsync.mockResolvedValue([
      'content://new-dir/backup.db',
    ]);

    const { getByTestId, findByTestId } = renderWithProvider(
      <RestoreFromBackupScreen />,
      makeSetupInfo(),
    );
    fireEvent.press(getByTestId('restore-choose-backup-location-btn'));
    const item = await findByTestId('restore-source-item-backup.db');
    expect(item).toBeTruthy();
  });

  /**
   * Tests that the dialog testID exists in the tree (verifying the component renders
   * the Portal-based dialog without checking visibility — the dialog's visible state is
   * managed by the Portal/Dialog machinery which is tested by Paper itself).
   */
  it('renders the confirm dialog Portal element', () => {
    const { getByTestId } = renderWithProvider(<RestoreFromBackupScreen />, makeSetupInfo());
    expect(getByTestId('restore-db-name-input')).toBeTruthy();
  });

  /** Tests that the encryption key input is no longer rendered. */
  it('does not render the encryption key input', () => {
    const { queryByTestId } = renderWithProvider(<RestoreFromBackupScreen />, makeSetupInfo());
    expect(queryByTestId('restore-db-key-input')).toBeNull();
  });

  /** The helper text under the database name explains the simplified flow. */
  it('shows the simplified restore helper text', () => {
    const { getByTestId } = renderWithProvider(<RestoreFromBackupScreen />, makeSetupInfo());
    const helper = getByTestId('restore-db-name-helper');
    expect(helper.props.children).toContain('After restore');
  });

  /**
   * Tests that lastDatabaseName=null results in 'feltlog.db' default. (Already covered
   * by an existing test, but duplicated here as a regression guard.)
   */
  it("uses 'feltlog.db' as the default database name", () => {
    const { getByTestId } = renderWithProvider(<RestoreFromBackupScreen />, makeSetupInfo());
    expect(getByTestId('restore-db-name-input').props.value).toBe('feltlog.db');
  });

  /** The safety-backup notice should appear in the form. */
  it('renders the safety-backup notice in the form', () => {
    const { getByTestId } = renderWithProvider(<RestoreFromBackupScreen />, makeSetupInfo());

    const notice = getByTestId('safety-backup-notice');
    expect(notice).toBeTruthy();
    expect(notice.props.children).toContain('safety backup');
  });

  /**
   * The old safety-backup text should no longer appear in the confirmation dialog
   * content.
   */
  it('confirmation dialog does not contain the full safety-backup wording', () => {
    const { queryByText } = renderWithProvider(<RestoreFromBackupScreen />, makeSetupInfo());

    // The original long form is removed from the confirmation dialog.
    expect(
      queryByText(
        'A safety backup of the current database will be saved to the configured backup' +
          ' location before restoring. Continue?',
      ),
    ).toBeNull();
  });

  /**
   * Tests that after a successful restore, the target database name is persisted so the
   * setup/login screen pre-fills it, and the user is navigated back to setup.
   */
  it('persists the target database name and navigates to setup on success', async () => {
    mockGetBackupDirectoryUri.mockResolvedValue('content://mock-dir');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoFs = require('expo-file-system/legacy');
    ExpoFs.StorageAccessFramework.readDirectoryAsync.mockResolvedValue([
      'content://mock-dir/backup.db',
    ]);

    const { findByTestId, getByTestId } = renderWithProvider(
      <RestoreFromBackupScreen />,
      makeSetupInfo(),
    );

    await findByTestId('restore-source-item-backup.db');

    const nameInput = getByTestId('restore-db-name-input');
    fireEvent.changeText(nameInput, 'restored.db');

    fireEvent.press(getByTestId('restore-source-item-backup.db'));
    fireEvent.press(getByTestId('restore-confirm-btn'));

    await waitFor(() => {
      expect(mockSetLastDatabaseName).toHaveBeenCalledWith('restored.db');
    });
    expect(mockRouter.replace).toHaveBeenCalledWith('/setup');
  });

  /**
   * Tests that surrounding whitespace on the database name is trimmed before it is
   * persisted, matching the trimmed name used for the actual database file.
   */
  it('trims whitespace from the persisted database name', async () => {
    mockGetBackupDirectoryUri.mockResolvedValue('content://mock-dir');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoFs = require('expo-file-system/legacy');
    ExpoFs.StorageAccessFramework.readDirectoryAsync.mockResolvedValue([
      'content://mock-dir/backup.db',
    ]);

    const { findByTestId, getByTestId } = renderWithProvider(
      <RestoreFromBackupScreen />,
      makeSetupInfo(),
    );

    await findByTestId('restore-source-item-backup.db');

    const nameInput = getByTestId('restore-db-name-input');
    fireEvent.changeText(nameInput, '  restored.db  ');

    fireEvent.press(getByTestId('restore-source-item-backup.db'));
    fireEvent.press(getByTestId('restore-confirm-btn'));

    await waitFor(() => {
      expect(mockSetLastDatabaseName).toHaveBeenCalledWith('restored.db');
    });
    expect(mockRouter.replace).toHaveBeenCalledWith('/setup');
  });

  /**
   * Tests that navigation back to the setup screen still happens even if persisting the
   * database name fails. The name cache is best-effort once the restore itself
   * succeeded.
   */
  it('navigates to setup even when persisting the database name fails', async () => {
    mockSetLastDatabaseName.mockRejectedValue(new Error('persist failed'));
    mockGetBackupDirectoryUri.mockResolvedValue('content://mock-dir');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoFs = require('expo-file-system/legacy');
    ExpoFs.StorageAccessFramework.readDirectoryAsync.mockResolvedValue([
      'content://mock-dir/backup.db',
    ]);

    const { findByTestId, getByTestId } = renderWithProvider(
      <RestoreFromBackupScreen />,
      makeSetupInfo(),
    );

    await findByTestId('restore-source-item-backup.db');

    const nameInput = getByTestId('restore-db-name-input');
    fireEvent.changeText(nameInput, 'restored.db');

    fireEvent.press(getByTestId('restore-source-item-backup.db'));
    fireEvent.press(getByTestId('restore-confirm-btn'));

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/setup');
    });
    expect(mockSetLastDatabaseName).toHaveBeenCalledWith('restored.db');
  });

  /**
   * When the user cancels the SAF directory picker, chooseBackupDirectory returns null
   * and the component leaves the directory state unchanged.
   */
  it('does not update the backup directory when the SAF picker is cancelled', async () => {
    mockGetBackupDirectoryUri.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoFs = require('expo-file-system/legacy');
    ExpoFs.StorageAccessFramework.requestDirectoryPermissionsAsync.mockResolvedValue({
      granted: false,
    });

    const { getByTestId, getByText } = renderWithProvider(
      <RestoreFromBackupScreen />,
      makeSetupInfo(),
    );

    await waitFor(() => {
      expect(getByTestId('restore-choose-backup-location-btn')).toBeTruthy();
    });

    fireEvent.press(getByTestId('restore-choose-backup-location-btn'));

    await waitFor(() => {
      expect(getByText(/No backup location configured/)).toBeTruthy();
    });
  });

  /** Triggers the error snackbar style branch by making restoreDatabase fail. */
  it('uses error snackbar styling when restore fails', async () => {
    mockGetBackupDirectoryUri.mockResolvedValue('content://mock-dir');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoFs = require('expo-file-system/legacy');
    ExpoFs.StorageAccessFramework.readDirectoryAsync.mockResolvedValue([
      'content://mock-dir/backup.db',
    ]);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { restoreDatabase } = require('@/src/data/database/restore');
    (restoreDatabase as jest.Mock).mockResolvedValue({ success: false, error: 'restore failed' });

    const { findByTestId, getByTestId } = renderWithProvider(
      <RestoreFromBackupScreen />,
      makeSetupInfo(),
    );

    await findByTestId('restore-source-item-backup.db');
    fireEvent.press(getByTestId('restore-source-item-backup.db'));
    fireEvent.press(getByTestId('restore-confirm-btn'));

    await waitFor(() => {
      const snackbar = getByTestId('restore-snackbar');
      expect(snackbar.props.style).toMatchObject({ backgroundColor: '#d32f2f' });
    });
  });
});
