import { useCallback, useEffect, useState } from 'react';
import { useImmer } from 'use-immer';
import { Database } from '@/src/data/database/schema';
import { up } from '@/src/data/database/migrations';
import { getLastDatabaseName, setLastDatabaseName } from './dbLocationStorage';
import { getPendingMigrationCount, backupDatabase, getLatestMigrationKey } from './backup';
import { getBackupDirectoryUri } from './dbBackupStorage';
import { CompiledQuery, Kysely } from 'kysely';
import { openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';
import { ExpoDialect } from 'kysely-expo';
import { SQLCIPHER_WRONG_KEY_ERROR_RE } from './errors';

export interface UseDatabaseState {
  ready: boolean;
  db: Kysely<Database> | null;
  error: unknown | null;
  databaseName: string | null;
  sqliteDb: SQLiteDatabase | null;
  databasePath: string | null;
  isCurrentlyEncrypted: boolean;
}

export interface OpenDatabaseResult {
  db: Kysely<Database>;
  sqliteDb: SQLiteDatabase;
}

/**
 * Open a new Kysely database backed by Expo SQLite.
 *
 * This function is stateless and does not use singletons. Callers are responsible for
 * holding onto the returned handle and closing the underlying SQLite database when
 * finished.
 *
 * @param encryptionKey - Optional SQLCipher key to use for encryption.
 * @param databaseName - Optional database name (filename). Defaults to 'feltlog.db'.
 *
 * @returns An object containing both the Kysely instance and the underlying SQLite
 *   database.
 */
export async function openKysely(
  encryptionKey?: string,
  databaseName?: string,
): Promise<OpenDatabaseResult> {
  const dbName = databaseName || 'feltlog.db';
  const sqliteDb = await openDatabaseAsync(dbName);

  const db = new Kysely<Database>({
    dialect: new ExpoDialect({ database: sqliteDb }),
  });

  // Apply encryption key if provided. An empty string is treated as "no
  // encryption" (SQLCipher is bypassed). We do not attempt to validate here,
  // callers should handle errors thrown by SQLite when the key is wrong.
  if (encryptionKey) {
    await db.executeQuery(CompiledQuery.raw(`PRAGMA key='${encryptionKey}'`));
  }
  return { db, sqliteDb };
}

/**
 * Close the given Expo SQLite database. This does not explicitly dispose the Kysely
 * instance; once the underlying connection is closed, the Kysely instance becomes
 * unusable.
 *
 * @param sqliteDb - The SQLite database to close.
 *
 * @returns A promise that resolves when the database is closed.
 */
export async function closeSqlite(sqliteDb: SQLiteDatabase): Promise<void> {
  await sqliteDb.closeAsync();
}

/**
 * Hook that opens and migrates the database once and returns its state.
 *
 * This avoids any singleton patterns by keeping the db handle in React state at the app
 * root (or test) level.
 */
export interface UseDatabaseApi extends UseDatabaseState {
  initialize: (params: { encryptionKey: string; databaseName: string }) => Promise<void>;
  /**
   * Resets the hook state back to the initial uninitialized values.
   *
   * Used after a destructive operation (e.g. encryption key change) to force the app
   * back to the setup screen, so the user re-enters the new password and
   * {@link initialize} re-opens the database on the primary hook instance.
   */
  reset: () => void;
  lastDatabaseName: string | null;
}

/**
 * Hook that opens and migrates the database once and returns its state.
 *
 * This avoids any singleton patterns by keeping the db handle in React state at the app
 * root (or test) level.
 *
 * @returns The database state and initialize function.
 */
export const useDatabase = (): UseDatabaseApi => {
  const [state, setState] = useImmer<UseDatabaseState>({
    ready: false,
    db: null,
    error: null,
    databaseName: null,
    sqliteDb: null,
    databasePath: null,
    isCurrentlyEncrypted: true,
  });

  const [lastDatabaseName, setLastDatabaseNameState] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Load last database name from storage for autofill purposes.
    (async () => {
      try {
        const name = await getLastDatabaseName();
        if (!cancelled) setLastDatabaseNameState(name);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Initializes the database with the given encryption key and name.
   *
   * @param params - The initialization parameters.
   * @param params.encryptionKey - The encryption key to use.
   * @param params.databaseName - The name of the database file.
   */
  const initialize = async ({
    encryptionKey,
    databaseName,
  }: {
    encryptionKey: string;
    databaseName: string;
  }) => {
    let sqliteDb: SQLiteDatabase | null = null;

    // Close any previously opened database to prevent resource leaks.
    if (state.sqliteDb) {
      try {
        await state.sqliteDb.closeAsync();
      } catch {
        // ignore close errors
      }
    }

    try {
      const { db, sqliteDb: newSqliteDb } = await openKysely(encryptionKey, databaseName);
      sqliteDb = newSqliteDb;

      // Check for pending migrations before running them.
      try {
        const pendingCount = await getPendingMigrationCount(db);
        if (pendingCount > 0) {
          const backupDirUri = await getBackupDirectoryUri();
          if (backupDirUri) {
            // Best-effort: don't block migration on backup failure.
            try {
              await backupDatabase(
                sqliteDb.databasePath,
                backupDirUri,
                getLatestMigrationKey(),
                databaseName,
              );
            } catch (backupError) {
              // Silently continue — backup is best-effort.
              console.warn('Pre-migration backup failed:', backupError);
            }
          }
        }
      } catch (migrationCheckError) {
        // If checking pending migrations fails, proceed anyway.
        console.warn('Could not check pending migrations:', migrationCheckError);
      }

      await up(db);
      setState({
        ready: true,
        db,
        error: null,
        databaseName: databaseName || 'feltlog.db',
        sqliteDb,
        databasePath: sqliteDb.databasePath,
        isCurrentlyEncrypted: encryptionKey.trim().length > 0,
      });
      try {
        if (databaseName) await setLastDatabaseName(databaseName);
        setLastDatabaseNameState(databaseName);
      } catch {
        // ignore storage errors
      }
    } catch (error) {
      if (sqliteDb) {
        try {
          await sqliteDb.closeAsync();
        } catch {
          // ignore close errors during error handling
        }
      }
      // Transform misleading SQLCipher errors (caused by wrong encryption key
      // or corrupted database) into user-friendly messages. The raw messages
      // like "out of memory" or "file is not a database" are SQLCipher quirks
      // that result from key derivation producing a valid-looking but wrong
      // key. The user should not see "out of memory" when they typed the
      // wrong password.
      const message = error instanceof Error ? error.message : String(error);
      const isWrongKey = SQLCIPHER_WRONG_KEY_ERROR_RE.test(message);
      const friendlyError = isWrongKey ? 'Current password is incorrect' : message;
      setState({
        ready: false,
        db: null,
        error: friendlyError,
        databaseName: null,
        sqliteDb: null,
        databasePath: null,
        isCurrentlyEncrypted: true,
      });
    }
  };

  /**
   * Resets the hook state to the initial uninitialized values without closing the
   * existing connection (the caller is responsible for closing it before resetting,
   * e.g. via the change-password flow's closeCurrentConnection).
   *
   * This forces the app back to the setup screen so the user re-enters the password and
   * {@link initialize} re-opens the database on this — the primary — hook instance.
   */
  const reset = useCallback(() => {
    setState({
      ready: false,
      db: null,
      error: null,
      databaseName: null,
      sqliteDb: null,
      databasePath: null,
      isCurrentlyEncrypted: true,
    });
  }, [setState]);

  return {
    ...state,
    initialize,
    reset,
    lastDatabaseName,
    databaseName: state.databaseName ?? null,
    sqliteDb: state.sqliteDb ?? null,
  };
};
