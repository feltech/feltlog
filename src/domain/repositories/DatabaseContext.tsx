import React, { createContext, useContext } from 'react';
import { SQLiteDatabase } from 'expo-sqlite';

/** Information about the currently active database, shared across the app tree. */
export interface DatabaseInfo {
  /** The user-provided database filename, or null if not yet initialized. */
  databaseName: string | null;

  /** Filesystem path to the SQLite database, or null if not initialized. */
  databasePath: string | null;

  /** Whether the database is currently encrypted. */
  isCurrentlyEncrypted: boolean;

  /** The underlying SQLite database handle, or null if not initialized. */
  sqliteDb: SQLiteDatabase | null;
}

const DatabaseInfoContext = createContext<DatabaseInfo>({
  databaseName: null,
  databasePath: null,
  isCurrentlyEncrypted: true,
  sqliteDb: null,
});

export interface DatabaseInfoProviderProps {
  /** The current database info to provide to descendants. */
  value: DatabaseInfo;

  /** Child components. */
  children: React.ReactNode;
}

/**
 * Provider to supply database metadata to descendants.
 *
 * @param props - The provider props.
 * @param props.value - The database info value.
 * @param props.children - The child components.
 *
 * @returns The rendered provider.
 */
export function DatabaseInfoProvider({ value, children }: DatabaseInfoProviderProps) {
  return <DatabaseInfoContext.Provider value={value}>{children}</DatabaseInfoContext.Provider>;
}

/**
 * Hook to access the shared database info from context.
 *
 * @returns The current {@link DatabaseInfo}.
 */
export function useDatabaseInfo(): DatabaseInfo {
  return useContext(DatabaseInfoContext);
}
