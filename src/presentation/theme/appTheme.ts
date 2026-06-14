import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from 'react-native-paper';
import type { ThemeMode } from '@/src/data/database/dbThemeStorage';

export type { ThemeMode };

/**
 * Unified theme type used by both React Native Paper and Expo Router's navigation
 * ThemeProvider.
 *
 * Extends MD3Theme with the navigation theme keys expected by React Navigation so a
 * single theme object can be passed to PaperProvider and ThemeProvider.
 */
export type AppTheme = MD3Theme & {
  dark: boolean;
  fonts: MD3Theme['fonts'] & {
    regular: { fontFamily: string; fontWeight: '400' };
    medium: { fontFamily: string; fontWeight: '500' };
    bold: { fontFamily: string; fontWeight: '700' };
    heavy: { fontFamily: string; fontWeight: '900' };
  };
  colors: MD3Theme['colors'] & {
    primary: string;
    background: string;
    card: string;
    text: string;
    border: string;
    notification: string;
  };
};

/**
 * Light app theme.
 *
 * Maps React Navigation's color names onto the Material Design 3 light palette so the
 * navigation chrome and Paper components share the same colors.
 */
export const lightTheme: AppTheme = {
  ...MD3LightTheme,
  dark: false,
  colors: {
    ...MD3LightTheme.colors,
    primary: MD3LightTheme.colors.primary,
    background: MD3LightTheme.colors.background,
    card: MD3LightTheme.colors.surface,
    text: MD3LightTheme.colors.onBackground,
    border: MD3LightTheme.colors.outline,
    notification: MD3LightTheme.colors.error,
  },
  fonts: {
    ...MD3LightTheme.fonts,
    regular: { fontFamily: 'Roboto', fontWeight: '400' as const },
    medium: { fontFamily: 'Roboto', fontWeight: '500' as const },
    bold: { fontFamily: 'Roboto', fontWeight: '700' as const },
    heavy: { fontFamily: 'Roboto', fontWeight: '900' as const },
  },
};

/**
 * Dark app theme.
 *
 * Maps React Navigation's color names onto the Material Design 3 dark palette.
 */
export const darkTheme: AppTheme = {
  ...MD3DarkTheme,
  dark: true,
  colors: {
    ...MD3DarkTheme.colors,
    primary: MD3DarkTheme.colors.primary,
    background: MD3DarkTheme.colors.background,
    card: MD3DarkTheme.colors.surface,
    text: MD3DarkTheme.colors.onBackground,
    border: MD3DarkTheme.colors.outline,
    notification: MD3DarkTheme.colors.error,
  },
  fonts: {
    ...MD3DarkTheme.fonts,
    regular: { fontFamily: 'Roboto', fontWeight: '400' as const },
    medium: { fontFamily: 'Roboto', fontWeight: '500' as const },
    bold: { fontFamily: 'Roboto', fontWeight: '700' as const },
    heavy: { fontFamily: 'Roboto', fontWeight: '900' as const },
  },
};

/**
 * Returns the app theme for the given color scheme.
 *
 * @param scheme - The resolved color scheme, either 'light', 'dark', null, or
 *   'unspecified'. A null or unspecified value defaults to the light theme so callers
 *   do not need to handle it as a special case.
 *
 * @returns The matching app theme.
 */
export function getAppTheme(scheme: 'light' | 'dark' | 'unspecified' | null): AppTheme {
  return scheme === 'dark' ? darkTheme : lightTheme;
}
