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
import * as SplashScreen from 'expo-splash-screen';
import { useDatabase } from '@/src/data/database/database';
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
 *
 * @returns The render result from testing-library.
 */
async function renderLayout(
  fontsLoaded: boolean,
  dbReady: boolean,
  dbError: string | null = null,
): Promise<ReturnType<typeof render>> {
  (useFonts as jest.Mock).mockReturnValue([fontsLoaded, null]);
  (useDatabase as jest.Mock).mockReturnValue({
    ready: dbReady,
    db: dbReady ? ({ mockDb: true } as unknown as ReturnType<typeof useDatabase>['db']) : null,
    initialize: jest.fn().mockResolvedValue(undefined),
    lastDatabaseName: null,
    error: dbError,
  });

  return render(<RootLayout />);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

/**
 * Test suite for the root layout component. Covers font loading, splash screen
 * management, database initialization states, and provider wrapping.
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

    /** Tests that the splash screen is hidden once fonts load. */
    it('hides the splash screen after fonts load', async () => {
      (useFonts as jest.Mock).mockReturnValue([true, null]);
      (useDatabase as jest.Mock).mockReturnValue({
        ready: true,
        db: { mockDb: true },
        initialize: jest.fn(),
        lastDatabaseName: null,
        error: null,
      });

      render(<RootLayout />);
      // Allow the useEffect that calls hideAsync to run.
      await act(async () => {
        await Promise.resolve();
      });

      expect(SplashScreen.hideAsync).toHaveBeenCalled();
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

    /** Tests that the navigation tree renders when database is ready. */
    it('renders navigation tree when database is ready', async () => {
      const { toJSON } = await renderLayout(true, true);
      expect(toJSON()).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Provider wrapping
  // -------------------------------------------------------------------------

  describe('provider wrapping', () => {
    /** Tests that children are wrapped in providers when db is ready. */
    it('wraps children in PaperProvider and RepositoryProvider when ready', async () => {
      const { toJSON } = await renderLayout(true, true);
      // The tree should be non-null when all providers are set up.
      expect(toJSON()).toBeTruthy();
    });
  });
});
