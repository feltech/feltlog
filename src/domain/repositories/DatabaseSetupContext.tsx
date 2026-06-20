import React, { createContext, useContext } from 'react';
import type { UseDatabaseApi } from '@/src/data/database/database';

/**
 * Information needed by pre-database route components (setup, restore-backup) to
 * initialize or restore a database.
 *
 * These values originate from the single `useDatabase()` call in `RootLayoutNav` and
 * are shared via context so route components do not re-invoke `useDatabase()` (which
 * would create an independent state instance).
 */
export interface DatabaseSetupInfo {
  /** Callback to initialize the database with a name and optional encryption key. */
  initialize: UseDatabaseApi['initialize'];

  /** The last used database name (cached in AsyncStorage), or null if none. */
  lastDatabaseName: string | null;

  /** Any error that occurred during the most recent initialization attempt. */
  error: unknown | null;
}

/**
 * Default initialize that throws if consumed outside a provider. In practice the
 * provider is always rendered in `_layout.tsx`, so this only fires on misuse.
 *
 * @returns A promise that rejects with a misuse error.
 */
const defaultInitialize = (): Promise<void> =>
  Promise.reject(new Error('DatabaseSetupProvider not mounted.'));

const DatabaseSetupContext = createContext<DatabaseSetupInfo>({
  initialize: defaultInitialize,
  lastDatabaseName: null,
  error: null,
});

export interface DatabaseSetupProviderProps {
  /** The database setup info to provide to descendants. */
  value: DatabaseSetupInfo;

  /** Child components. */
  children: React.ReactNode;
}

/**
 * Provider to supply database setup info to pre-database route descendants.
 *
 * @param props - The provider props.
 * @param props.value - The database setup info value.
 * @param props.children - The child components.
 *
 * @returns The rendered provider.
 */
export function DatabaseSetupProvider({ value, children }: DatabaseSetupProviderProps) {
  return <DatabaseSetupContext.Provider value={value}>{children}</DatabaseSetupContext.Provider>;
}

/**
 * Hook to access the shared database setup info from context.
 *
 * @returns The current {@link DatabaseSetupInfo}.
 */
export function useDatabaseSetup(): DatabaseSetupInfo {
  return useContext(DatabaseSetupContext);
}
