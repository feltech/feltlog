import FontAwesome from '@expo/vector-icons/FontAwesome';
import {DarkTheme, DefaultTheme, ThemeProvider} from '@react-navigation/native';
import {useFonts} from 'expo-font';
import {Stack} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import {useEffect} from 'react';
import 'react-native-reanimated';
import { PaperProvider } from 'react-native-paper';
import { RepositoryProvider } from '@/src/domain/repositories/RepositoryContext';
import { JournalRepositoryImpl } from '@/src/data/repositories/JournalRepositoryImpl';
import { useDatabase } from '@/services/database';
import SetupDatabaseScreen from '@/components/SetupDatabaseScreen';

import {useColorScheme} from '@/components/useColorScheme';

export {
    // Catch any errors thrown by the Layout component.
    ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
    // Ensure that reloading on `/modal` keeps a back button present.
    initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
// noinspection JSIgnoredPromiseFromCall
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
    const [loaded, error] = useFonts({
        SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
        ...FontAwesome.font,
    });

    // Expo Router uses Error Boundaries to catch errors in the navigation tree.
    useEffect(() => {
        if (error) throw error;
    }, [error]);

    useEffect(() => {
        // Hide splash once fonts are loaded; database readiness is handled in RootLayoutNav.
        if (loaded) {
            // noinspection JSIgnoredPromiseFromCall
            SplashScreen.hideAsync();
        }
    }, [loaded]);

    if (!loaded) {
        return null;
    }

    return <RootLayoutNav/>;
}

function RootLayoutNav() {
    const { ready, db, initialize, lastDatabaseName, error } = useDatabase();
    const colorScheme = useColorScheme();

    if (!ready || !db) {
        return (
            <PaperProvider>
                <SetupDatabaseScreen initialize={initialize} lastDatabaseName={lastDatabaseName} error={error} />
            </PaperProvider>
        );
    }

    const repository = new JournalRepositoryImpl(db);

    return (
        <PaperProvider>
            <RepositoryProvider repository={repository}>
                <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
                    <Stack>
                        <Stack.Screen name="(tabs)" options={{headerShown: false}}/>
                        <Stack.Screen name="modal" options={{presentation: 'modal'}}/>
                    </Stack>
                </ThemeProvider>
            </RepositoryProvider>
        </PaperProvider>
    );
}
