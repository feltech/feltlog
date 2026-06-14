import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  getThemeMode,
  setThemeMode as persistThemeMode,
  type ThemeMode,
} from '@/src/data/database/dbThemeStorage';

/** Context value for theme preference. */
interface ThemePreferenceContextValue {
  /** The current theme mode preference. */
  themeMode: ThemeMode;
  /** Updates the theme mode preference and persists it. */
  setThemeMode: (mode: ThemeMode) => void;
}

/**
 * React context for providing theme preference across the app.
 *
 * The context is initialized with 'auto' and loads the persisted value from
 * AsyncStorage on mount. Changes are persisted immediately.
 */
const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(null);

export interface ThemePreferenceProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component that supplies the theme preference to descendants.
 *
 * On mount, reads the persisted theme mode from AsyncStorage. The default is 'auto'.
 * The setThemeMode function updates both local state and AsyncStorage.
 *
 * @param props - The provider props.
 * @param props.children - The child components.
 *
 * @returns The rendered provider.
 */
export function ThemePreferenceProvider({ children }: ThemePreferenceProviderProps) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('auto');
  const [loaded, setLoaded] = useState(false);

  // Load persisted theme mode on mount.
  useEffect(() => {
    let mounted = true;

    (async () => {
      const mode = await getThemeMode();
      if (mounted) {
        setThemeModeState(mode);
        setLoaded(true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  /**
   * Updates the theme mode and persists it to AsyncStorage.
   *
   * @param mode - The new theme mode ('auto' | 'light' | 'dark').
   */
  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
    persistThemeMode(mode);
  };

  // Don't render children until the theme mode is loaded to avoid a flash
  // of the wrong theme.
  if (!loaded) {
    return null;
  }

  return (
    <ThemePreferenceContext.Provider value={{ themeMode, setThemeMode }}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}

/**
 * Hook to access the theme preference from context.
 *
 * Throws a clear error if no ThemePreferenceProvider is in the ancestor tree.
 *
 * @returns The theme preference context value.
 */
export function useThemePreference(): ThemePreferenceContextValue {
  const context = useContext(ThemePreferenceContext);
  if (!context) {
    throw new Error(
      'useThemePreference must be used within a ThemePreferenceProvider. ' +
        'Wrap your app in ThemePreferenceProvider.',
    );
  }
  return context;
}
