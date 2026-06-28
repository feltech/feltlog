import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Stack, ThemeProvider } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import 'react-native-reanimated';
import { PaperProvider, Snackbar } from 'react-native-paper';
import { RepositoryProvider } from '@/src/domain/repositories/RepositoryContext';
import { DatabaseInfoProvider } from '@/src/domain/repositories/DatabaseContext';
import { DatabaseSetupProvider } from '@/src/domain/repositories/DatabaseSetupContext';
import { JournalRepositoryImpl } from '@/src/data/repositories/JournalRepositoryImpl';
import { useDatabase } from '@/src/data/database/database';
import { performLifecycleBackup, getLatestMigrationKey } from '@/src/data/database/backup';
import { getBackupDirectoryUri } from '@/src/data/database/dbBackupStorage';
import { useColorScheme } from '@/src/presentation/components/useColorScheme';
import {
  ThemePreferenceProvider,
  useThemePreference,
} from '@/src/presentation/theme/ThemePreferenceContext';
import { getAppTheme } from '@/src/presentation/theme/appTheme';
import SpaceMono from '@/assets/fonts/SpaceMono-Regular.ttf';

/** Navigation theme type inferred from expo-router's ThemeProvider. */
type NavigationTheme = NonNullable<React.ComponentProps<typeof ThemeProvider>['value']>;

/**
 * Root layout component that handles asset loading and navigation.
 *
 * @returns The rendered root layout or null if fonts are not loaded.
 */
export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono,
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    // Hide splash once fonts are loaded; database readiness is handled in
    // RootLayoutNav.
    if (loaded) {
      (async () => {
        await SplashScreen.hideAsync();
      })();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <ThemePreferenceProvider>
      <RootLayoutNav />
    </ThemePreferenceProvider>
  );
}

/**
 * Navigation component for the root layout. Handles database initialization and
 * providing the repository context.
 *
 * @returns The rendered navigation tree or the setup database screen.
 */
function RootLayoutNav() {
  const {
    ready,
    db,
    initialize,
    reset,
    lastDatabaseName,
    error,
    databaseName,
    databasePath,
    isCurrentlyEncrypted,
    sqliteDb,
  } = useDatabase();
  const colorScheme = useColorScheme();
  const { themeMode } = useThemePreference();
  const [showBackupSnackbar, setShowBackupSnackbar] = useState(false);

  // Resolve effective scheme: 'auto' follows system, else explicit.
  const effectiveScheme = themeMode === 'auto' ? colorScheme : themeMode;
  const appTheme = getAppTheme(effectiveScheme);

  // Lifecycle-triggered backup: attempt on background, confirm/retry on resume.
  useEffect(() => {
    if (!ready || !db || !databaseName || !databasePath) return;

    /**
     * Attempts a lifecycle backup if a backup directory has been configured.
     *
     * @returns 'saved' if a new backup was created, 'failed' on error, or 'skipped' if
     *   no backup directory is set.
     */
    async function tryLifecycleBackup(): Promise<'saved' | 'failed' | 'skipped'> {
      const dirUri = await getBackupDirectoryUri();
      if (!dirUri) return 'skipped';

      const version = getLatestMigrationKey();
      // databasePath and databaseName are narrowed by the early return above; the
      // non-null assertions are safe because the effect skips when either is null.
      return performLifecycleBackup(databasePath!, dirUri, version, databaseName!);
    }

    /**
     * Checks if a background backup was attempted and performs a lifecycle backup if
     * the database is stale.
     */
    const checkResume = async () => {
      const result = await tryLifecycleBackup();
      if (result === 'saved') {
        setShowBackupSnackbar(true);
      }
    };

    /**
     * Handles app state changes to trigger background backups.
     *
     * @param nextState - The next application state.
     */
    const handleAppStateChange = async (nextState: AppStateStatus) => {
      if (nextState !== 'background') return;

      // Best-effort — may be killed mid-operation.
      await tryLifecycleBackup();
    };

    // Run resume check on mount.
    checkResume();

    // Subscribe to app state changes.
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [ready, db, databaseName, databasePath]);

  // All routes live in a single <Stack>. Expo Router discovers routes from the
  // file system regardless of which <Stack.Screen> entries are declared, so a
  // two-branch approach (one Stack for pre-DB, another for post-DB) does not
  // prevent the un-declared routes from rendering — it crashes because their
  // providers aren't mounted. Stack.Protected is the mechanism that makes a
  // route inaccessible: when its `guard` is true, the route is blocked and Expo
  // Router redirects away from it. The two guards below are symmetric, so both
  // phase transitions are handled:
  //   - ready: false → true: pre-DB routes become inaccessible, redirect to
  //     (tabs).
  //   - ready: true → false (reset): post-DB routes become inaccessible,
  //     redirect to setup.
  const stackElement = (
    <Stack>
      <Stack.Protected guard={!ready}>
        <Stack.Screen name="setup" options={{ headerShown: false }} />
        <Stack.Screen name="restore-backup" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!ready}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="entry-editor"
          options={{ presentation: 'modal', headerShown: false }}
        />
      </Stack.Protected>
    </Stack>
  );

  // Pre-database: only setup/restore-backup are reachable (Stack.Protected
  // guard={!!ready} is false, making (tabs)/entry-editor inaccessible). The
  // DatabaseSetupProvider supplies the initialize callback and last-database-name
  // hint to the setup screen.
  if (!ready || !db) {
    return (
      <PaperProvider theme={appTheme}>
        <StatusBar style={appTheme.dark ? 'light' : 'dark'} />
        <ThemeProvider value={appTheme as unknown as NavigationTheme}>
          <DatabaseSetupProvider value={{ initialize, lastDatabaseName, error }}>
            {stackElement}
          </DatabaseSetupProvider>
        </ThemeProvider>
      </PaperProvider>
    );
  }

  // Post-database: all routes reachable, wrapped with the providers they need.
  // `db` is narrowed to non-null by the early return above.
  const repository = new JournalRepositoryImpl(db);

  return (
    <PaperProvider theme={appTheme}>
      <StatusBar style={appTheme.dark ? 'light' : 'dark'} />
      <ThemeProvider value={appTheme as unknown as NavigationTheme}>
        <DatabaseInfoProvider
          value={{
            databaseName,
            databasePath,
            isCurrentlyEncrypted,
            sqliteDb,
            resetDatabase: reset,
          }}
        >
          <RepositoryProvider repository={repository}>
            {stackElement}
            <Snackbar
              visible={showBackupSnackbar}
              onDismiss={() => setShowBackupSnackbar(false)}
              duration={3000}
            >
              Backup saved
            </Snackbar>
          </RepositoryProvider>
        </DatabaseInfoProvider>
      </ThemeProvider>
    </PaperProvider>
  );
}
