import * as SplashScreen from 'expo-splash-screen';
import { en, registerTranslation } from 'react-native-paper-dates';

// Register the English translation for react-native-paper-dates before any
// date picker is rendered.
registerTranslation('en', en);

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

// Prevent the splash screen from auto-hiding before asset loading is complete.
// noinspection JSIgnoredPromiseFromCall
SplashScreen.preventAutoHideAsync();

/**
 * Re-export the root layout implementation from the presentation layer. The
 * module-level setup above must remain in this file because Expo Router reads the root
 * layout from `app/_layout.tsx`.
 */
export { default } from '@/src/presentation/components/RootLayoutProvider';
