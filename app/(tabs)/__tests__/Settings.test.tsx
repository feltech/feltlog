import React from 'react';
import { fireEvent, render, waitFor, act } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import SettingsScreen, { parseSafLocation } from '../Settings';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Mock useDatabaseInfo to provide test database state. */
jest.mock('@/src/domain/repositories/DatabaseContext', () => ({
  useDatabaseInfo: jest.fn(),
}));

/** Mock expo-file-system StorageAccessFramework. */
jest.mock('expo-file-system', () => ({
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

import { useDatabaseInfo } from '@/src/domain/repositories/DatabaseContext';
import { StorageAccessFramework } from 'expo-file-system';
import {
  getBackupDirectoryUri,
  setBackupDirectoryUri,
  clearBackupDirectoryUri,
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
 * Sets up the useDatabase mock with the given parameters.
 *
 * @param databaseName - The active database name.
 * @param databasePath - The database file path or null.
 */
function setupDatabaseMock(
  databaseName: string | null = 'test.db',
  databasePath: string | null = '/mock/test.db',
) {
  (useDatabaseInfo as jest.Mock).mockReturnValue({
    databaseName,
    databasePath,
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
 * Test suite for the Settings screen. Covers rendering, backup configuration, manual
 * backup triggering, permission revocation, and database info display.
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
  // Rendering
  // -------------------------------------------------------------------------

  /** Tests that all three sections are rendered. */
  it('renders all three sections', async () => {
    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText('Backup')).toBeTruthy();
      expect(getByText('Database')).toBeTruthy();
      expect(getByText('About')).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Backup location
  // -------------------------------------------------------------------------

  /** Tests that "No backup location configured" is shown when no URI is stored. */
  it('shows no backup location configured when URI is null', async () => {
    setupBackupStorageMocks(null);
    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText('No backup location configured')).toBeTruthy();
    });
  });

  /** Tests that choosing a backup location persists the URI. */
  it('chooses and persists a backup location', async () => {
    (StorageAccessFramework.requestDirectoryPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
      directoryUri: 'content://new-dir',
    });

    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('choose-backup-location-btn')).toBeTruthy();
    });

    fireEvent.press(getByTestId('choose-backup-location-btn'));

    await waitFor(() => {
      expect(setBackupDirectoryUri).toHaveBeenCalledWith('content://new-dir');
      expect(getByText('Backup location configured')).toBeTruthy();
    });
  });

  /** Tests that choosing a backup location shows an error when denied. */
  it('shows error when backup location permission is denied', async () => {
    (StorageAccessFramework.requestDirectoryPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: false,
      directoryUri: null,
    });

    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('choose-backup-location-btn')).toBeTruthy();
    });

    fireEvent.press(getByTestId('choose-backup-location-btn'));

    await waitFor(() => {
      expect(getByText('Permission denied')).toBeTruthy();
    });
  });

  /** Tests that an exception during directory permission request is handled. */
  it('shows error when choosing backup location throws', async () => {
    (StorageAccessFramework.requestDirectoryPermissionsAsync as jest.Mock).mockRejectedValue(
      new Error('SAF crashed'),
    );

    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('choose-backup-location-btn')).toBeTruthy();
    });

    fireEvent.press(getByTestId('choose-backup-location-btn'));

    await waitFor(() => {
      expect(getByText('Failed to choose directory: SAF crashed')).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Backup Now
  // -------------------------------------------------------------------------

  /** Tests that the Backup Now button is disabled when no directory is configured. */
  it('disables Backup Now when no directory is configured', async () => {
    setupBackupStorageMocks(null);
    const { getByTestId } = renderScreen();

    await waitFor(() => {
      const btn = getByTestId('backup-now-btn');
      expect(btn.props.accessibilityState?.disabled).toBe(true);
    });
  });

  /** Tests that Backup Now triggers a backup and shows success. */
  it('triggers backup and shows success message', async () => {
    setupBackupStorageMocks('content://mock-dir');
    (backupDatabase as jest.Mock).mockResolvedValue({ success: true, fileName: 'backup.db' });

    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => {
      const btn = getByTestId('backup-now-btn');
      expect(btn).toBeTruthy();
      expect(btn.props.accessibilityState?.disabled).toBe(false);
    });

    fireEvent.press(getByTestId('backup-now-btn'));

    await waitFor(() => {
      expect(backupDatabase).toHaveBeenCalledWith(
        '/mock/test.db',
        'content://mock-dir',
        '20260523_one_create_initial_tables',
        'test.db',
      );
      expect(getByText('Backup saved')).toBeTruthy();
    });
  });

  /** Tests that Backup Now shows an error when the backup fails. */
  it('shows error when backup fails', async () => {
    setupBackupStorageMocks('content://mock-dir');
    (backupDatabase as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Disk full',
    });

    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => {
      const btn = getByTestId('backup-now-btn');
      expect(btn).toBeTruthy();
      expect(btn.props.accessibilityState?.disabled).toBe(false);
    });

    await act(async () => {
      fireEvent.press(getByTestId('backup-now-btn'));
    });

    await waitFor(() => {
      expect(getByText('Disk full')).toBeTruthy();
    });
  });

  /** Tests that Backup Now handles an unexpected exception. */
  it('shows error when backup throws an exception', async () => {
    setupBackupStorageMocks('content://mock-dir');
    (backupDatabase as jest.Mock).mockRejectedValue(new Error('Network error'));

    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('backup-now-btn')).toBeTruthy();
      expect(getByTestId('backup-now-btn').props.accessibilityState?.disabled).toBe(false);
    });

    fireEvent.press(getByTestId('backup-now-btn'));

    await waitFor(() => {
      expect(getByText('Backup failed: Network error')).toBeTruthy();
    });
  });

  /** Tests that the Backup Now button is disabled when there is no database. */
  it('disables Backup Now when databasePath is null', async () => {
    setupDatabaseMock('test.db', null);
    setupBackupStorageMocks('content://mock-dir');

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      const btn = getByTestId('backup-now-btn');
      expect(btn.props.accessibilityState?.disabled).toBe(true);
    });
  });

  /** Tests that the snackbar can be dismissed. */
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

    const snackbar = getByTestId('settings-snackbar');
    fireEvent(snackbar, 'onDismiss');

    await waitFor(() => {
      expect(queryByText('Backup location configured')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Permission revocation
  // -------------------------------------------------------------------------

  /** Tests that a revoked permission is detected on mount. */
  it('detects revoked permission on mount', async () => {
    setupBackupStorageMocks('content://mock-dir');
    (StorageAccessFramework.readDirectoryAsync as jest.Mock).mockRejectedValue(
      new Error('Permission denied'),
    );

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(clearBackupDirectoryUri).toHaveBeenCalled();
      expect(
        getByText('Backup location is no longer accessible. Please choose a new one.'),
      ).toBeTruthy();
    });
  });

  /** Tests that a revoked permission is detected before Backup Now. */
  it('detects revoked permission before Backup Now', async () => {
    setupBackupStorageMocks('content://mock-dir');
    let callCount = 0;
    (StorageAccessFramework.readDirectoryAsync as jest.Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve([]); // mount check passes
      }
      return Promise.reject(new Error('Permission denied')); // pre-backup check fails
    });

    const { getByTestId, getByText } = renderScreen();

    // Wait until the mount effect finishes and the backup now button is enabled.
    await waitFor(() => {
      const btn = getByTestId('backup-now-btn');
      expect(btn).toBeTruthy();
      expect(btn.props.accessibilityState?.disabled).toBe(false);
    });

    fireEvent.press(getByTestId('backup-now-btn'));

    await waitFor(() => {
      expect(clearBackupDirectoryUri).toHaveBeenCalled();
      expect(
        getByText('Backup location is no longer accessible. Please choose a new one.'),
      ).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// parseSafLocation
// ---------------------------------------------------------------------------

describe('parseSafLocation', () => {
  /** Tests that a standard SAF URI is parsed to the path after the volume. */
  it('extracts path from a standard SAF URI', () => {
    const uri = 'content://com.android.externalstorage.documents/tree/primary%3ADocuments';
    expect(parseSafLocation(uri)).toBe('Documents');
  });

  /** Tests that nested paths are decoded correctly. */
  it('decodes nested paths', () => {
    const uri = 'content://com.android.externalstorage.documents/tree/primary%3APath%2FTo%2FDir';
    expect(parseSafLocation(uri)).toBe('Path/To/Dir');
  });

  /** Tests that the raw URI is returned when parsing throws. */
  it('returns raw URI on malformed input', () => {
    const uri = 'not-a-valid-uri';
    expect(parseSafLocation(uri)).toBe('not-a-valid-uri');
  });

  /** Tests that the raw URI is returned when decodeURIComponent throws. */
  it('returns raw URI when decodeURIComponent throws', () => {
    const uri = 'content://authority/tree/primary%3A%FF%FE';
    expect(parseSafLocation(uri)).toBe(uri);
  });
});
