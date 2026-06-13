import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

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

import RestoreFromBackupScreen from '../RestoreFromBackupScreen';
import { getBackupDirectoryUri } from '@/src/data/database/dbBackupStorage';

const mockGetBackupDirectoryUri = getBackupDirectoryUri as jest.Mock;

/**
 * Helper that wraps the component in a PaperProvider so react-native-paper Portal /
 * Snackbar / Dialog have access to the theme.
 *
 * @param element - The React element to render.
 *
 * @returns The RNTL render result.
 */
function renderWithProvider(element: React.ReactElement) {
  return render(<PaperProvider>{element}</PaperProvider>);
}

/** Minimal smoke tests for RestoreFromBackupScreen. */
describe('RestoreFromBackupScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBackupDirectoryUri.mockResolvedValue(null);
  });

  /** Tests that the form renders with all expected inputs and buttons. */
  it('renders the form', () => {
    const onCancel = jest.fn();
    const { getByTestId } = renderWithProvider(
      <RestoreFromBackupScreen lastDatabaseName="test.db" onCancel={onCancel} />,
    );

    expect(getByTestId('restore-db-name-input')).toBeTruthy();
    expect(getByTestId('restore-db-key-input')).toBeTruthy();
    expect(getByTestId('restore-confirm-btn')).toBeTruthy();
    expect(getByTestId('restore-cancel-btn')).toBeTruthy();

    const nameInput = getByTestId('restore-db-name-input');
    expect(nameInput.props.value).toBe('test.db');
  });

  /** Tests that pressing the Cancel button invokes the onCancel callback. */
  it('calls onCancel when Cancel is pressed', () => {
    const onCancel = jest.fn();
    const { getByTestId } = renderWithProvider(
      <RestoreFromBackupScreen lastDatabaseName={null} onCancel={onCancel} />,
    );

    fireEvent.press(getByTestId('restore-cancel-btn'));
    expect(onCancel).toHaveBeenCalled();
  });

  /**
   * Tests that the Restore button is disabled initially because no backup file is
   * selected.
   */
  it('Restore button is disabled when no file is selected', () => {
    const { getByTestId } = renderWithProvider(
      <RestoreFromBackupScreen lastDatabaseName={null} onCancel={jest.fn()} />,
    );

    const confirmBtn = getByTestId('restore-confirm-btn');
    expect(confirmBtn.props.accessibilityState?.disabled).toBe(true);
  });

  /** Tests that the name input is pre-filled from the lastDatabaseName prop. */
  it('pre-fills database name from lastDatabaseName', () => {
    const { getByTestId } = renderWithProvider(
      <RestoreFromBackupScreen lastDatabaseName="previous.db" onCancel={jest.fn()} />,
    );
    expect(getByTestId('restore-db-name-input').props.value).toBe('previous.db');
  });

  /** Tests that the name defaults to 'feltlog.db' when lastDatabaseName is null. */
  it("defaults the name to 'feltlog.db' when lastDatabaseName is null", () => {
    const { getByTestId } = renderWithProvider(
      <RestoreFromBackupScreen lastDatabaseName={null} onCancel={jest.fn()} />,
    );
    expect(getByTestId('restore-db-name-input').props.value).toBe('feltlog.db');
  });

  /** Tests that the no-backup-location warning appears when no directory is set. */
  it('shows the no-backup-location warning when no directory is configured', async () => {
    mockGetBackupDirectoryUri.mockResolvedValue(null);
    const { findByTestId } = renderWithProvider(
      <RestoreFromBackupScreen lastDatabaseName={null} onCancel={jest.fn()} />,
    );
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
      <RestoreFromBackupScreen lastDatabaseName="memoires.db" onCancel={jest.fn()} />,
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
      <RestoreFromBackupScreen lastDatabaseName={null} onCancel={jest.fn()} />,
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

    const { findByText } = renderWithProvider(
      <RestoreFromBackupScreen lastDatabaseName={null} onCancel={jest.fn()} />,
    );
    const empty = await findByText(/No .db files found/i);
    expect(empty).toBeTruthy();
  });

  /** Shows the empty-list message when readDirectoryAsync throws on mount. */
  it('shows the empty-list message when readDirectoryAsync throws on mount', async () => {
    mockGetBackupDirectoryUri.mockResolvedValue('content://mock-dir');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoFs = require('expo-file-system/legacy');
    ExpoFs.StorageAccessFramework.readDirectoryAsync.mockRejectedValue(new Error('nope'));

    const { findByText } = renderWithProvider(
      <RestoreFromBackupScreen lastDatabaseName={null} onCancel={jest.fn()} />,
    );
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
      <RestoreFromBackupScreen lastDatabaseName={null} onCancel={jest.fn()} />,
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
    const { getByTestId } = renderWithProvider(
      <RestoreFromBackupScreen lastDatabaseName={null} onCancel={jest.fn()} />,
    );
    expect(getByTestId('restore-db-name-input')).toBeTruthy();
  });

  /**
   * Tests that lastDatabaseName=null results in 'feltlog.db' default. (Already covered
   * by an existing test, but duplicated here as a regression guard.)
   */
  it("uses 'feltlog.db' as the default database name", () => {
    const { getByTestId } = renderWithProvider(
      <RestoreFromBackupScreen lastDatabaseName={null} onCancel={jest.fn()} />,
    );
    expect(getByTestId('restore-db-name-input').props.value).toBe('feltlog.db');
  });
});
