import React from 'react';
import { act, render } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks — hoisted before any imports below.
// ---------------------------------------------------------------------------

/** Mock expo-font's useFonts to simulate font loading. */
jest.mock('expo-font', () => ({
  useFonts: jest.fn(),
}));

/** Mock expo-splash-screen to prevent auto-hide calls from crashing. */
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(),
  hideAsync: jest.fn().mockResolvedValue(undefined),
}));

/** Mock react-native-reanimated to avoid native module issues. */
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: () => null,
}));

/** Mock the database hook so we can control DB readiness. */
jest.mock('@/src/data/database/database', () => ({
  useDatabase: jest.fn(),
}));

/** Mock backup functions to avoid file system operations. */
jest.mock('@/src/data/database/backup', () => ({
  performLifecycleBackup: jest.fn().mockResolvedValue('skipped'),
  getLatestMigrationKey: jest.fn().mockReturnValue('20260523_one_create_initial_tables'),
}));

/** Mock backup storage to avoid AsyncStorage side effects. */
jest.mock('@/src/data/database/dbBackupStorage', () => ({
  getBackupDirectoryUri: jest.fn().mockResolvedValue(null),
}));

/** Mock SetupDatabaseScreen to simplify assertions. */
jest.mock('@/src/presentation/components/SetupDatabaseScreen', () => ({
  __esModule: true,
  default: jest.fn(({ error }: { error?: string }) => (
    <>{error ? `Setup Error: ${error}` : 'SetupDatabaseScreen'}</>
  )),
}));

/** Mock the color scheme hook to return 'light' by default. */
jest.mock('@/src/presentation/components/useColorScheme', () => ({
  useColorScheme: jest.fn().mockReturnValue('light'),
}));

/** Mock FontAwesome to avoid vector icon native issues. */
jest.mock('@expo/vector-icons/FontAwesome', () => ({
  __esModule: true,
  default: jest.fn(() => null),
  font: { fontFamily: 'FontAwesome' },
}));

/** Mock expo-router Stack and ErrorBoundary export. */
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');

  /**
   * Mock Stack navigator component.
   *
   * @param props - Component props.
   * @param props.children - Child components.
   *
   * @returns The rendered mock stack.
   */
  const MockStack = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  MockStack.displayName = 'Stack';
  MockStack.Screen = jest.fn(() => null);

  return {
    Stack: MockStack,
    ErrorBoundary: jest.fn(() => null),
  };
});

import { useFonts } from 'expo-font';
import { AppState } from 'react-native';
import { useDatabase } from '@/src/data/database/database';
import { performLifecycleBackup } from '@/src/data/database/backup';
import { getBackupDirectoryUri } from '@/src/data/database/dbBackupStorage';
import RootLayout from '../_layout';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Renders the RootLayout with the given font and database states.
 *
 * @param fontsLoaded - Whether fonts are loaded.
 * @param dbReady - Whether the database is ready.
 * @param dbError - Optional database error message.
 * @param backupDirUri - Optional backup directory URI for lifecycle backup tests.
 *
 * @returns The render result from testing-library.
 */
async function renderLayout(
  fontsLoaded: boolean,
  dbReady: boolean,
  dbError: string | null = null,
  backupDirUri: string | null = null,
): Promise<ReturnType<typeof render>> {
  (useFonts as jest.Mock).mockReturnValue([fontsLoaded, null]);
  (useDatabase as jest.Mock).mockReturnValue({
    ready: dbReady,
    db: dbReady ? ({ mockDb: true } as unknown as ReturnType<typeof useDatabase>['db']) : null,
    initialize: jest.fn().mockResolvedValue(undefined),
    lastDatabaseName: null,
    error: dbError,
    databaseName: dbReady ? 'test.db' : null,
    databasePath: dbReady ? '/mock/test.db' : null,
  });
  (getBackupDirectoryUri as jest.Mock).mockResolvedValue(backupDirUri);

  return render(<RootLayout />);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

/**
 * Test suite for the root layout component. Covers font loading, database
 * initialization states, and lifecycle backup behavior.
 */
describe('RootLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Font loading
  // -------------------------------------------------------------------------

  describe('font loading', () => {
    /** Tests that null is returned while fonts are still loading. */
    it('returns null while fonts are loading', async () => {
      (useFonts as jest.Mock).mockReturnValue([false, null]);
      (useDatabase as jest.Mock).mockReturnValue({
        ready: false,
        db: null,
        initialize: jest.fn(),
        lastDatabaseName: null,
        error: null,
      });

      const { toJSON } = render(<RootLayout />);
      expect(toJSON()).toBeNull();
    });

    /** Tests that a font loading error is thrown into the error boundary. */
    it('throws font loading error into error boundary', async () => {
      const fontError = new Error('Font load failed');
      (useFonts as jest.Mock).mockReturnValue([false, fontError]);
      (useDatabase as jest.Mock).mockReturnValue({
        ready: false,
        db: null,
        initialize: jest.fn(),
        lastDatabaseName: null,
        error: null,
      });

      // The useEffect that checks for error should throw.
      expect(() => {
        render(<RootLayout />);
      }).toThrow('Font load failed');
    });
  });

  // -------------------------------------------------------------------------
  // Database initialization
  // -------------------------------------------------------------------------

  describe('database initialization', () => {
    /** Tests that the setup screen is shown when the database is not ready. */
    it('shows setup screen when database is not ready', async () => {
      const { toJSON } = await renderLayout(true, false);
      const json = JSON.stringify(toJSON());
      expect(json).toContain('SetupDatabaseScreen');
    });

    /** Tests that the setup screen shows an error when db init fails. */
    it('shows setup screen with error when database has an error', async () => {
      const { toJSON } = await renderLayout(true, false, 'DB error');
      const json = JSON.stringify(toJSON());
      expect(json).toContain('Setup Error: DB error');
    });
  });

  // -------------------------------------------------------------------------
  // Lifecycle backup
  // -------------------------------------------------------------------------

  describe('lifecycle backup', () => {
    /** Tests that performLifecycleBackup is called on mount when DB is ready. */
    it('calls performLifecycleBackup on mount when DB is ready', async () => {
      await renderLayout(true, true, null, 'content://mock-dir');

      await act(async () => {
        await Promise.resolve();
      });

      expect(performLifecycleBackup).toHaveBeenCalledWith(
        '/mock/test.db',
        'content://mock-dir',
        '20260523_one_create_initial_tables',
        'test.db',
      );
    });

    /** Tests that snackbar shows "Backup saved" when lifecycle backup returns saved. */
    it('shows Backup saved snackbar when lifecycle backup returns saved', async () => {
      (performLifecycleBackup as jest.Mock).mockResolvedValue('saved');
      const { getByText } = await renderLayout(true, true, null, 'content://mock-dir');

      await act(async () => {
        await Promise.resolve();
      });

      expect(getByText('Backup saved')).toBeTruthy();
    });

    /** Tests that lifecycle backup is skipped when no backup directory is set. */
    it('skips lifecycle backup when no backup directory is configured', async () => {
      await renderLayout(true, true, null, null);

      await act(async () => {
        await Promise.resolve();
      });

      expect(performLifecycleBackup).not.toHaveBeenCalled();
    });

    /** Tests that lifecycle backup is skipped when DB is not ready. */
    it('skips lifecycle backup when DB is not ready', async () => {
      await renderLayout(true, false, null, 'content://mock-dir');

      await act(async () => {
        await Promise.resolve();
      });

      expect(performLifecycleBackup).not.toHaveBeenCalled();
    });

    /** Tests that performLifecycleBackup is called when app goes to background. */
    it('calls performLifecycleBackup when app goes to background', async () => {
      const listeners: Array<(state: string) => void> = [];
      (AppState.addEventListener as jest.Mock).mockImplementation(
        (_event: string, handler: (state: string) => void) => {
          listeners.push(handler);
          return { remove: jest.fn() };
        },
      );

      await renderLayout(true, true, null, 'content://mock-dir');

      await act(async () => {
        await Promise.resolve();
      });

      // Clear the mount call so we can isolate the background call.
      (performLifecycleBackup as jest.Mock).mockClear();

      // Simulate app going to background.
      await act(async () => {
        listeners.forEach(handler => handler('background'));
        await Promise.resolve();
      });

      expect(performLifecycleBackup).toHaveBeenCalledWith(
        '/mock/test.db',
        'content://mock-dir',
        '20260523_one_create_initial_tables',
        'test.db',
      );
    });
  });
});
