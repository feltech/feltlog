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

/** Mock expo-status-bar so tests can assert the global style prop. */
jest.mock('expo-status-bar', () => ({
  StatusBar: jest.fn(() => null),
}));

/** Mock the database hook so we can control DB readiness. */
jest.mock('@/src/data/database/database', () => ({
  useDatabase: jest.fn(),
}));

/** Mock react-native-paper-dates so the layout test does not load its ESM deps. */
jest.mock('react-native-paper-dates', () => ({
  en: {},
  registerTranslation: jest.fn(),
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

/** Mock the JournalRepositoryImpl constructor so it does not touch a real db. */
jest.mock('@/src/data/repositories/JournalRepositoryImpl', () => ({
  JournalRepositoryImpl: jest.fn().mockImplementation((db: unknown) => ({ db })),
}));

/** Mock the color scheme hook to return 'light' by default. */
jest.mock('@/src/presentation/components/useColorScheme', () => ({
  useColorScheme: jest.fn().mockReturnValue('light'),
}));

/** Mock the theme preference hook to return 'auto' by default. */
jest.mock('@/src/presentation/theme/ThemePreferenceContext', () => ({
  useThemePreference: jest.fn().mockReturnValue({
    themeMode: 'auto',
    setThemeMode: jest.fn(),
  }),
  ThemePreferenceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

/** Mock FontAwesome to avoid vector icon native issues. */
jest.mock('@expo/vector-icons/FontAwesome', () => ({
  __esModule: true,
  default: jest.fn(() => null),
  font: { fontFamily: 'FontAwesome' },
}));

/** Mock DatabaseSetupProvider as a pass-through that renders a marker text. */
jest.mock('@/src/domain/repositories/DatabaseSetupContext', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native');
  return {
    DatabaseSetupProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        RN.View,
        { testID: 'database-setup-provider' },
        React.createElement(RN.Text, null, 'DatabaseSetupProvider'),
        children,
      ),
  };
});

/** Mock DatabaseInfoProvider and RepositoryProvider as pass-throughs with markers. */
jest.mock('@/src/domain/repositories/DatabaseContext', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native');
  return {
    DatabaseInfoProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        RN.View,
        { testID: 'database-info-provider' },
        React.createElement(RN.Text, null, 'DatabaseInfoProvider'),
        children,
      ),
  };
});
jest.mock('@/src/domain/repositories/RepositoryContext', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native');
  return {
    RepositoryProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        RN.View,
        { testID: 'repository-provider' },
        React.createElement(RN.Text, null, 'RepositoryProvider'),
        children,
      ),
  };
});

// Module-level variable to capture the last theme value passed to ThemeProvider.
let capturedThemeValue: unknown = null;

// Mock expo-router's ThemeProvider to capture the theme value.
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native');

  /**
   * Mock Stack navigator component.
   *
   * @param props - Component props.
   * @param props.children - Child components.
   *
   * @returns The rendered children.
   */
  const MockStack = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  MockStack.displayName = 'Stack';
  // Stack.Screen renders a marker text so tests can assert which routes are
  // registered. The `name` prop identifies the route.
  MockStack.Screen = jest.fn(({ name }: { name?: string }) =>
    name ? <RN.Text>{`Stack.Screen:${name}`}</RN.Text> : null,
  );
  // Stack.Protected renders a marker text recording its guard value so tests
  // can assert which routes are protected in each phase. Its children are
  // rendered regardless (the real component blocks navigation, not rendering).
  MockStack.Protected = jest.fn(
    ({ guard, children }: { guard: boolean; children: React.ReactNode }) => (
      <>
        <RN.Text>{`Stack.Protected:${guard ? 'blocked' : 'open'}`}</RN.Text>
        {children}
      </>
    ),
  );

  /**
   * Mock ThemeProvider that captures the theme value passed to it.
   *
   * @param props - Component props.
   * @param props.value - The theme value to capture.
   * @param props.children - Child components.
   *
   * @returns The rendered children.
   */
  const MockThemeProvider = ({
    value,
    children,
  }: {
    value: unknown;
    children: React.ReactNode;
  }) => {
    capturedThemeValue = value;
    return <>{children}</>;
  };
  MockThemeProvider.displayName = 'ThemeProvider';

  return {
    Stack: MockStack,
    ErrorBoundary: jest.fn(() => null),
    ThemeProvider: MockThemeProvider,
  };
});

import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { AppState } from 'react-native';
import { useDatabase } from '@/src/data/database/database';
import { performLifecycleBackup } from '@/src/data/database/backup';
import { getBackupDirectoryUri } from '@/src/data/database/dbBackupStorage';
import { useThemePreference } from '@/src/presentation/theme/ThemePreferenceContext';
import { lightTheme, darkTheme } from '@/src/presentation/theme/appTheme';
import { Stack } from 'expo-router';
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
    /**
     * Tests that all four routes are registered in a single Stack regardless of DB
     * readiness — Expo Router discovers routes from the file system, so Stack.Protected
     * (not branch omission) controls reachability.
     */
    it('registers all routes in a single Stack when DB is not ready', async () => {
      await renderLayout(true, false);
      const screenNames = (Stack.Screen as unknown as jest.Mock).mock.calls.map(
        ([props]: [{ name: string }]) => props.name,
      );
      expect(screenNames).toContain('setup');
      expect(screenNames).toContain('restore-backup');
      expect(screenNames).toContain('(tabs)');
      expect(screenNames).toContain('entry-editor');
    });

    /**
     * Tests that all four routes are registered in a single Stack when the DB is ready
     * — the same set of Stack.Screen declarations as the pre-DB phase.
     */
    it('registers all routes in a single Stack when DB is ready', async () => {
      await renderLayout(true, true);
      const screenNames = (Stack.Screen as unknown as jest.Mock).mock.calls.map(
        ([props]: [{ name: string }]) => props.name,
      );
      expect(screenNames).toContain('setup');
      expect(screenNames).toContain('restore-backup');
      expect(screenNames).toContain('(tabs)');
      expect(screenNames).toContain('entry-editor');
    });

    /**
     * Tests that when the DB is not ready, the pre-DB guard is `!ready` (true) and the
     * post-DB guard is `!!ready` (false). Per the spec, guard=true means the route is
     * accessible; guard=false means it is blocked.
     */
    it('passes guard=true for pre-DB and guard=false for post-DB when DB is not ready', async () => {
      await renderLayout(true, false);
      const protectedCalls = (Stack.Protected as unknown as jest.Mock).mock.calls;
      expect(protectedCalls[0][0].guard).toBe(true); // !ready = true
      expect(protectedCalls[1][0].guard).toBe(false); // !!ready = false
    });

    /**
     * Tests that when the DB is ready, the pre-DB guard is `!ready` (false) and the
     * post-DB guard is `!!ready` (true).
     */
    it('passes guard=false for pre-DB and guard=true for post-DB when DB is ready', async () => {
      await renderLayout(true, true);
      const protectedCalls = (Stack.Protected as unknown as jest.Mock).mock.calls;
      expect(protectedCalls[0][0].guard).toBe(false); // !ready = false
      expect(protectedCalls[1][0].guard).toBe(true); // !!ready = true
    });

    /**
     * Tests that the post-database routes ((tabs), entry-editor) are NOT wrapped in
     * DatabaseInfoProvider/RepositoryProvider when the database is not ready — the
     * post-DB providers are only mounted in the ready branch.
     */
    it('does not mount DatabaseInfoProvider/RepositoryProvider when DB is not ready', async () => {
      const { queryByText } = await renderLayout(true, false);
      expect(queryByText('DatabaseInfoProvider')).toBeNull();
      expect(queryByText('RepositoryProvider')).toBeNull();
    });

    /**
     * Tests that DatabaseInfoProvider and RepositoryProvider wrap the Stack when the
     * database is ready.
     */
    it('wraps the Stack with DatabaseInfoProvider and RepositoryProvider when DB is ready', async () => {
      const { getByText } = await renderLayout(true, true);
      expect(getByText('DatabaseInfoProvider')).toBeTruthy();
      expect(getByText('RepositoryProvider')).toBeTruthy();
    });

    /**
     * Tests that DatabaseSetupProvider is mounted only in the pre-DB phase — the
     * post-DB branch uses DatabaseInfoProvider/RepositoryProvider instead.
     */
    it('mounts DatabaseSetupProvider in pre-DB but not in post-DB', async () => {
      const preDb = await renderLayout(true, false);
      expect(preDb.getByText('DatabaseSetupProvider')).toBeTruthy();

      const postDb = await renderLayout(true, true);
      expect(postDb.queryByText('DatabaseSetupProvider')).toBeNull();
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

  // -------------------------------------------------------------------------
  // Theme provider
  // -------------------------------------------------------------------------

  describe('theme provider', () => {
    beforeEach(() => {
      capturedThemeValue = null;
      (StatusBar as unknown as jest.Mock).mockClear();
    });

    /**
     * Tests that ThemeProvider receives lightTheme when themeMode is 'auto' and
     * colorScheme is 'light'.
     */
    it('passes lightTheme to ThemeProvider when themeMode is auto and colorScheme is light', async () => {
      (useThemePreference as jest.Mock).mockReturnValue({
        themeMode: 'auto',
        setThemeMode: jest.fn(),
      });

      await renderLayout(true, true);

      // The mocked ThemeProvider captures the last value passed to it.
      expect(capturedThemeValue).toBeDefined();
      expect(capturedThemeValue).toBe(lightTheme);
    });

    /** Tests that ThemeProvider receives darkTheme when themeMode is 'dark'. */
    it('passes darkTheme to ThemeProvider when themeMode is dark', async () => {
      (useThemePreference as jest.Mock).mockReturnValue({
        themeMode: 'dark',
        setThemeMode: jest.fn(),
      });

      await renderLayout(true, true);

      expect(capturedThemeValue).toBeDefined();
      // Should be darkTheme when themeMode is explicitly 'dark'.
      expect(capturedThemeValue).toBe(darkTheme);
    });

    /** Tests that ThemeProvider receives lightTheme when themeMode is 'light'. */
    it('passes lightTheme to ThemeProvider when themeMode is light', async () => {
      (useThemePreference as jest.Mock).mockReturnValue({
        themeMode: 'light',
        setThemeMode: jest.fn(),
      });

      await renderLayout(true, true);

      expect(capturedThemeValue).toBeDefined();
      // Should be lightTheme when themeMode is explicitly 'light'.
      expect(capturedThemeValue).toBe(lightTheme);
    });

    /** Tests that the global StatusBar uses a dark style in light mode. */
    it('renders StatusBar with dark style in light mode', async () => {
      (useThemePreference as jest.Mock).mockReturnValue({
        themeMode: 'light',
        setThemeMode: jest.fn(),
      });

      await renderLayout(true, true);

      expect(StatusBar as unknown as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({ style: 'dark' }),
        undefined,
      );
    });

    /** Tests that the global StatusBar uses a light style in dark mode. */
    it('renders StatusBar with light style in dark mode', async () => {
      (useThemePreference as jest.Mock).mockReturnValue({
        themeMode: 'dark',
        setThemeMode: jest.fn(),
      });

      await renderLayout(true, true);

      expect(StatusBar as unknown as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({ style: 'light' }),
        undefined,
      );
    });
  });
});
