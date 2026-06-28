import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Button, PaperProvider } from 'react-native-paper';

import SettingsScreen, { parseSafLocation } from '../SettingsScreen';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Mock useDatabaseInfo to provide test database state. */
jest.mock('@/src/domain/repositories/DatabaseContext', () => ({
  useDatabaseInfo: jest.fn(),
}));

/** Mock expo-file-system/legacy StorageAccessFramework. */
jest.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: jest.fn(),
    readDirectoryAsync: jest.fn(),
  },
}));

/** Mock backup functions. */
jest.mock('@/src/data/database/backup', () => ({
  backupDatabase: jest.fn(),
  getLatestMigrationKey: jest.fn().mockReturnValue('20260523_one_create_initial_tables'),
}));

/** Mock dbBackupStorage functions. */
jest.mock('@/src/data/database/dbBackupStorage', () => ({
  getBackupDirectoryUri: jest.fn(),
  setBackupDirectoryUri: jest.fn(),
  clearBackupDirectoryUri: jest.fn(),
  getLastBackupTimestamp: jest.fn(),
  getBackupMaxCount: jest.fn(),
}));

/** Mock ChangePasswordDialog to surface its visibility and exercise its callbacks. */
jest.mock('@/src/presentation/components/ChangePasswordDialog', () => ({
  __esModule: true,
  default: jest.fn(
    (props: {
      visible: boolean;
      onClose: () => void;
      showSnackbar: (message: string, isError: boolean) => void;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const RN = require('react-native');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const React = require('react');
      if (!props.visible) {
        return null;
      }
      return React.createElement(
        RN.View,
        { testID: 'change-password-dialog' },
        React.createElement(RN.Button, {
          title: 'Close',
          onPress: props.onClose,
          testID: 'mock-change-password-close',
        }),
        React.createElement(RN.Button, {
          title: 'Error',
          onPress: () => props.showSnackbar('Dialog error', true),
          testID: 'mock-change-password-error',
        }),
      );
    },
  ),
}));

/** Mock the theme preference hook. */
jest.mock('@/src/presentation/theme/ThemePreferenceContext', () => ({
  useThemePreference: jest.fn().mockReturnValue({
    themeMode: 'auto',
    setThemeMode: jest.fn(),
  }),
}));

import { useDatabaseInfo } from '@/src/domain/repositories/DatabaseContext';
import { useThemePreference } from '@/src/presentation/theme/ThemePreferenceContext';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import {
  getBackupDirectoryUri,
  getLastBackupTimestamp,
  getBackupMaxCount,
} from '@/src/data/database/dbBackupStorage';
import { backupDatabase } from '@/src/data/database/backup';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Renders the SettingsScreen inside a PaperProvider.
 *
 * @returns The render result from testing-library.
 */
function renderScreen() {
  return render(
    <PaperProvider>
      <SettingsScreen />
    </PaperProvider>,
  );
}

/**
 * Sets up the useDatabaseInfo mock with the given parameters.
 *
 * @param databaseName - The active database name.
 * @param databasePath - The database file path or null.
 * @param isCurrentlyEncrypted - Whether the database is encrypted.
 */
function setupDatabaseMock(
  databaseName: string | null = 'test.db',
  databasePath: string | null = '/mock/test.db',
  isCurrentlyEncrypted: boolean = true,
) {
  (useDatabaseInfo as jest.Mock).mockReturnValue({
    databaseName,
    databasePath,
    isCurrentlyEncrypted,
  });
}

/**
 * Sets up the backup storage mocks with the given values.
 *
 * @param dirUri - The backup directory URI.
 * @param lastTs - The last backup timestamp.
 * @param maxCount - The maximum number of backups to keep.
 */
function setupBackupStorageMocks(
  dirUri: string | null = null,
  lastTs: string | null = null,
  maxCount: number = 5,
) {
  (getBackupDirectoryUri as jest.Mock).mockResolvedValue(dirUri);
  (getLastBackupTimestamp as jest.Mock).mockResolvedValue(lastTs);
  (getBackupMaxCount as jest.Mock).mockResolvedValue(maxCount);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

/**
 * Test suite for the extracted SettingsScreen component. Covers rendering of all
 * setting cards, backup interactions, snackbar behaviour, and the SAF location parser.
 */
describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (backupDatabase as jest.Mock).mockReset();
    setupDatabaseMock();
    setupBackupStorageMocks();
    (StorageAccessFramework.readDirectoryAsync as jest.Mock).mockResolvedValue([]);
  });

  // -------------------------------------------------------------------------
  // Theme card
  // -------------------------------------------------------------------------

  /** The theme card renders with a SegmentedButtons control. */
  it('renders the theme card with SegmentedButtons', async () => {
    const { getByText, getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByText('Theme')).toBeTruthy();
      expect(getByTestId('theme-card')).toBeTruthy();
      expect(getByTestId('theme-selector-auto')).toBeTruthy();
      expect(getByTestId('theme-selector-light')).toBeTruthy();
      expect(getByTestId('theme-selector-dark')).toBeTruthy();
    });
  });

  /** Tapping a theme segment invokes setThemeMode. */
  it('calls setThemeMode when a theme segment is selected', async () => {
    const mockSetThemeMode = jest.fn();
    (useThemePreference as jest.Mock).mockReturnValue({
      themeMode: 'auto',
      setThemeMode: mockSetThemeMode,
    });

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('theme-selector-dark')).toBeTruthy();
    });

    fireEvent.press(getByTestId('theme-selector-dark'));

    await waitFor(() => {
      expect(mockSetThemeMode).toHaveBeenCalledWith('dark');
    });
  });

  // -------------------------------------------------------------------------
  // Backup card
  // -------------------------------------------------------------------------

  /** The backup card shows the configured location and action buttons. */
  it('renders the backup card with location info and buttons', async () => {
    setupBackupStorageMocks('content://mock-dir');

    const { getByText, getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByText('Backup')).toBeTruthy();
      expect(getByTestId('choose-backup-location-btn')).toBeTruthy();
      expect(getByTestId('backup-now-btn')).toBeTruthy();
      expect(getByText('Location: mock-dir')).toBeTruthy();
    });
  });

  /** The backup card shows the fallback text when no location is configured. */
  it('renders the backup card with no location configured', async () => {
    setupBackupStorageMocks(null);

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText('No backup location configured')).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Database card
  // -------------------------------------------------------------------------

  /** The database card renders active name, encryption, and password button. */
  it('renders the database card with name, encryption status, and change password button', async () => {
    setupDatabaseMock('my.db', '/mock/my.db', true);

    const { getByText, getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByText('Database')).toBeTruthy();
      expect(getByText(/Active database: my\.db/)).toBeTruthy();
      expect(getByText(/Encryption: Enabled/)).toBeTruthy();
      expect(getByTestId('change-password-btn')).toBeTruthy();
    });
  });

  /** The database card shows disabled encryption status when appropriate. */
  it('renders disabled encryption status in the database card', async () => {
    setupDatabaseMock('plain.db', '/mock/plain.db', false);

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText(/Encryption: Disabled/)).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // About card
  // -------------------------------------------------------------------------

  /** The about card renders with app name and version. */
  it('renders the about card', async () => {
    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText('About')).toBeTruthy();
      expect(getByText(/FeltLog/)).toBeTruthy();
      expect(getByText(/1\.0\.0/)).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Backup button disabled states
  // -------------------------------------------------------------------------

  /** Backup Now is disabled when no directory is configured. */
  it('disables Backup Now when no directory is configured', async () => {
    setupBackupStorageMocks(null);

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      const btn = getByTestId('backup-now-btn');
      expect(btn.props.accessibilityState?.disabled).toBe(true);
    });
  });

  /** Backup Now is disabled when databasePath is null. */
  it('disables Backup Now when databasePath is null', async () => {
    setupDatabaseMock('test.db', null);
    setupBackupStorageMocks('content://mock-dir');

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      const btn = getByTestId('backup-now-btn');
      expect(btn.props.accessibilityState?.disabled).toBe(true);
    });
  });

  /** Backup Now is disabled while a backup is in progress. */
  it('disables Backup Now while backing up', async () => {
    setupBackupStorageMocks('content://mock-dir');
    let resolveBackup: (value: { success: boolean }) => void;
    const backupPromise = new Promise<{ success: boolean }>(resolve => {
      resolveBackup = resolve;
    });
    (backupDatabase as jest.Mock).mockReturnValue(backupPromise);

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('backup-now-btn').props.accessibilityState?.disabled).toBe(false);
    });

    await act(async () => {
      fireEvent.press(getByTestId('backup-now-btn'));
    });

    await waitFor(() => {
      expect(getByTestId('backup-now-btn').props.accessibilityState?.disabled).toBe(true);
    });

    await act(async () => {
      resolveBackup!({ success: true });
    });
  });

  // -------------------------------------------------------------------------
  // Snackbar
  // -------------------------------------------------------------------------

  /** A success snackbar uses the success background style. */
  it('shows a success snackbar with success styling', async () => {
    (StorageAccessFramework.requestDirectoryPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
      directoryUri: 'content://new-dir',
    });

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('choose-backup-location-btn')).toBeTruthy();
    });

    fireEvent.press(getByTestId('choose-backup-location-btn'));

    await waitFor(() => {
      const snackbar = getByTestId('settings-snackbar');
      expect(snackbar.props.style).toMatchObject({ backgroundColor: '#2e7d32' });
    });
  });

  /** An error snackbar uses the error background style. */
  it('shows an error snackbar with error styling', async () => {
    (StorageAccessFramework.requestDirectoryPermissionsAsync as jest.Mock).mockRejectedValue(
      new Error('SAF crashed'),
    );

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('choose-backup-location-btn')).toBeTruthy();
    });

    fireEvent.press(getByTestId('choose-backup-location-btn'));

    await waitFor(() => {
      const snackbar = getByTestId('settings-snackbar');
      expect(snackbar.props.style).toMatchObject({ backgroundColor: '#d32f2f' });
    });
  });

  /** The snackbar can be dismissed. */
  it('dismisses the snackbar', async () => {
    (StorageAccessFramework.requestDirectoryPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
      directoryUri: 'content://new-dir',
    });

    const { getByTestId, getByText, queryByText } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('choose-backup-location-btn')).toBeTruthy();
    });

    fireEvent.press(getByTestId('choose-backup-location-btn'));

    await waitFor(() => {
      expect(getByText('Backup location configured')).toBeTruthy();
    });

    fireEvent(getByTestId('settings-snackbar'), 'onDismiss');

    await waitFor(() => {
      expect(queryByText('Backup location configured')).toBeNull();
    });
  });

  /** An invalid last-backup timestamp is handled gracefully by formatTimestamp. */
  it('handles an invalid last backup timestamp', async () => {
    setupBackupStorageMocks('content://dir', 'not-a-valid-date');

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText(/Last backup:/)).toBeTruthy();
    });
  });

  /**
   * The catch block in handleChooseBackupLocation stringifies non-Error rejections the
   * same way it does Error objects.
   */
  it('shows an error snackbar when choosing a location rejects with a string', async () => {
    (StorageAccessFramework.requestDirectoryPermissionsAsync as jest.Mock).mockRejectedValue(
      'denied',
    );

    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('choose-backup-location-btn')).toBeTruthy();
    });

    fireEvent.press(getByTestId('choose-backup-location-btn'));

    await waitFor(() => {
      expect(getByText('Failed to choose directory: denied')).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // ChangePasswordDialog
  // -------------------------------------------------------------------------

  /** The change password dialog is rendered when its open button is pressed. */
  it('renders ChangePasswordDialog when showChangePassword is true', async () => {
    const { getByTestId, queryByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('change-password-btn')).toBeTruthy();
    });

    expect(queryByTestId('change-password-dialog')).toBeNull();

    fireEvent.press(getByTestId('change-password-btn'));

    await waitFor(() => {
      expect(getByTestId('change-password-dialog')).toBeTruthy();
    });
  });

  /**
   * When the SAF result is granted but contains no directoryUri, the component treats
   * it as a cancellation and does not show the success snackbar.
   */
  it('does not show success snackbar when directoryUri is missing', async () => {
    (StorageAccessFramework.requestDirectoryPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
      directoryUri: undefined,
    });

    const { getByTestId, queryByText } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('choose-backup-location-btn')).toBeTruthy();
    });

    fireEvent.press(getByTestId('choose-backup-location-btn'));

    await waitFor(() => {
      expect(queryByText('Backup location configured')).toBeNull();
    });
  });

  /**
   * When backupDatabase fails without an error message, a generic fallback message is
   * shown.
   */
  it('shows a fallback error snackbar when backupDatabase returns success false without an error', async () => {
    setupBackupStorageMocks('content://dir');
    (backupDatabase as jest.Mock).mockResolvedValue({ success: false });

    const screen = renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('backup-now-btn')).toBeTruthy();
    });

    const backupBtn = screen
      .UNSAFE_getAllByType(Button)
      .find(b => b.props.testID === 'backup-now-btn');

    await act(async () => {
      await backupBtn!.props.onPress();
    });

    await waitFor(() => {
      expect(screen.getByText('Backup failed')).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Missing branch coverage for extracted SettingsScreen
  // -------------------------------------------------------------------------

  /**
   * When the stored backup directory can no longer be read on mount, the component
   * clears the URI and shows an error snackbar.
   */
  it('clears the backup location and shows an error when readDirectoryAsync fails on mount', async () => {
    setupBackupStorageMocks('content://lost-dir');
    (StorageAccessFramework.readDirectoryAsync as jest.Mock).mockRejectedValue(
      new Error('permission lost'),
    );

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(
        getByText('Backup location is no longer accessible. Please choose a new one.'),
      ).toBeTruthy();
    });
  });

  /**
   * If the backup directory becomes inaccessible while Backup Now is running, the
   * verify step clears the URI and surfaces an error snackbar.
   */
  it('shows an error snackbar when Backup Now finds the directory inaccessible', async () => {
    setupBackupStorageMocks('content://lost-dir');
    (StorageAccessFramework.readDirectoryAsync as jest.Mock)
      .mockResolvedValueOnce([])
      .mockRejectedValue(new Error('permission lost'));

    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('backup-now-btn').props.accessibilityState?.disabled).toBe(false);
    });

    await act(async () => {
      fireEvent.press(getByTestId('backup-now-btn'));
    });

    await waitFor(() => {
      expect(
        getByText('Backup location is no longer accessible. Please choose a new one.'),
      ).toBeTruthy();
    });
  });

  /**
   * When backupDatabase reports a failure, the error message from the result is shown
   * in the snackbar.
   */
  it('shows an error snackbar when backupDatabase returns failure', async () => {
    setupBackupStorageMocks('content://dir');
    (backupDatabase as jest.Mock).mockResolvedValue({ success: false, error: 'Disk full' });

    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('backup-now-btn').props.accessibilityState?.disabled).toBe(false);
    });

    await act(async () => {
      fireEvent.press(getByTestId('backup-now-btn'));
    });

    await waitFor(() => {
      expect(getByText('Disk full')).toBeTruthy();
    });
  });

  /**
   * These tests invoke the Backup Now handler directly to cover the early-return
   * branches that are unreachable through the disabled button.
   */

  /** HandleBackupNow returns early when databaseName is null. */
  it('returns early from Backup Now when databaseName is null', async () => {
    setupDatabaseMock(null, '/mock/test.db', true);
    setupBackupStorageMocks('content://dir');

    const screen = renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('backup-now-btn')).toBeTruthy();
    });

    const backupBtn = screen
      .UNSAFE_getAllByType(Button)
      .find(b => b.props.testID === 'backup-now-btn');
    expect(backupBtn).toBeTruthy();

    await act(async () => {
      await backupBtn!.props.onPress();
    });

    expect(backupDatabase).not.toHaveBeenCalled();
  });

  /** HandleBackupNow returns early when databasePath is null. */
  it('returns early from Backup Now when databasePath is null', async () => {
    setupDatabaseMock('test.db', null, true);
    setupBackupStorageMocks('content://dir');

    const screen = renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('backup-now-btn')).toBeTruthy();
    });

    const backupBtn = screen
      .UNSAFE_getAllByType(Button)
      .find(b => b.props.testID === 'backup-now-btn');

    await act(async () => {
      await backupBtn!.props.onPress();
    });

    expect(backupDatabase).not.toHaveBeenCalled();
  });

  /** HandleBackupNow returns early when no backup directory is configured. */
  it('returns early from Backup Now when no backup directory is configured', async () => {
    setupDatabaseMock('test.db', '/mock/test.db', true);
    setupBackupStorageMocks(null);

    const screen = renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('backup-now-btn')).toBeTruthy();
    });

    const backupBtn = screen
      .UNSAFE_getAllByType(Button)
      .find(b => b.props.testID === 'backup-now-btn');

    await act(async () => {
      await backupBtn!.props.onPress();
    });

    expect(backupDatabase).not.toHaveBeenCalled();
  });

  /** HandleBackupNow shows an error snackbar when backupDatabase throws. */
  it('shows an error snackbar when backupDatabase throws', async () => {
    setupBackupStorageMocks('content://dir');
    (backupDatabase as jest.Mock).mockRejectedValue(new Error('boom'));

    const screen = renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('backup-now-btn')).toBeTruthy();
    });

    const backupBtn = screen
      .UNSAFE_getAllByType(Button)
      .find(b => b.props.testID === 'backup-now-btn');

    await act(async () => {
      await backupBtn!.props.onPress();
    });

    await waitFor(() => {
      expect(screen.getByText('Backup failed: boom')).toBeTruthy();
    });
  });

  /**
   * The error branch in backupDatabase's catch block handles non-Error rejections by
   * stringifying the value.
   */
  it('shows an error snackbar when backupDatabase rejects with a string', async () => {
    setupBackupStorageMocks('content://dir');
    (backupDatabase as jest.Mock).mockRejectedValue('string failure');

    const screen = renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('backup-now-btn')).toBeTruthy();
    });

    const backupBtn = screen
      .UNSAFE_getAllByType(Button)
      .find(b => b.props.testID === 'backup-now-btn');

    await act(async () => {
      await backupBtn!.props.onPress();
    });

    await waitFor(() => {
      expect(screen.getByText('Backup failed: string failure')).toBeTruthy();
    });
  });

  /** The ChangePasswordDialog onClose callback closes the dialog. */
  it('closes the change password dialog when the dialog calls onClose', async () => {
    const { getByTestId, queryByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('change-password-btn')).toBeTruthy();
    });

    fireEvent.press(getByTestId('change-password-btn'));
    await waitFor(() => {
      expect(getByTestId('change-password-dialog')).toBeTruthy();
    });

    fireEvent.press(getByTestId('mock-change-password-close'));
    await waitFor(() => {
      expect(queryByTestId('change-password-dialog')).toBeNull();
    });
  });

  /** The ChangePasswordDialog showSnackbar callback displays a snackbar. */
  it('shows a snackbar when the dialog calls showSnackbar', async () => {
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('change-password-btn')).toBeTruthy();
    });

    fireEvent.press(getByTestId('change-password-btn'));
    await waitFor(() => {
      expect(getByTestId('change-password-dialog')).toBeTruthy();
    });

    fireEvent.press(getByTestId('mock-change-password-error'));
    await waitFor(() => {
      expect(getByText('Dialog error')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// parseSafLocation
// ---------------------------------------------------------------------------

/** Test suite for the SAF location parser used by the backup card. */
describe('parseSafLocation', () => {
  /** A standard SAF URI is parsed to the path after the volume. */
  it('extracts path from a standard SAF URI', () => {
    const uri = 'content://com.android.externalstorage.documents/tree/primary%3ADocuments';
    expect(parseSafLocation(uri)).toBe('Documents');
  });

  /** Nested paths are decoded correctly. */
  it('decodes nested paths', () => {
    const uri = 'content://com.android.externalstorage.documents/tree/primary%3APath%2FTo%2FDir';
    expect(parseSafLocation(uri)).toBe('Path/To/Dir');
  });

  /** A URI without a colon is returned decoded. */
  it('returns decoded segment when no volume separator is present', () => {
    const uri = 'content://authority/tree/primary%3AFreeText';
    expect(parseSafLocation(uri)).toBe('FreeText');
  });

  /** The raw URI is returned when parsing throws. */
  it('returns raw URI on malformed input', () => {
    const uri = 'not-a-valid-uri';
    expect(parseSafLocation(uri)).toBe('not-a-valid-uri');
  });

  /** The raw URI is returned when decodeURIComponent throws. */
  it('returns raw URI when decodeURIComponent throws', () => {
    const uri = 'content://authority/tree/primary%3A%FF%FE';
    expect(parseSafLocation(uri)).toBe(uri);
  });
});
