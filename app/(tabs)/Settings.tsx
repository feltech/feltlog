/**
 * Settings screen route.
 *
 * Re-exports the shared SettingsScreen component so it can be navigated to as a tab
 * route via Expo Router's file-based routing.
 */
export { default } from '@/src/presentation/components/SettingsScreen';

/**
 * Re-export the SAF location parser for any consumers/tests that import it from the
 * route file.
 */
export { parseSafLocation } from '@/src/presentation/components/SettingsScreen';
