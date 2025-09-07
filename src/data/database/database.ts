import * as SQLite from 'expo-sqlite';
import { Kysely } from 'kysely';
import { Database } from './schema';
import { ExpoSQLiteDialect } from './ExpoSQLiteDialect';

export interface OpenDatabaseResult {
  db: Kysely<Database>;
  sqliteDb: SQLite.SQLiteDatabase;
}

/**
 * Open a new Kysely database backed by Expo SQLite.
 *
 * This function is stateless and does not use singletons. Callers are
 * responsible for holding onto the returned handle and closing the
 * underlying SQLite database when finished.
 *
 * @param encryptionKey Optional SQLCipher key to use for encryption.
 * @param databaseName Optional database name (filename). Defaults to 'feltlog.db'.
 * @returns An object containing both the Kysely instance and the underlying SQLite database.
 */
export async function openKysely(
  encryptionKey?: string,
  databaseName?: string
): Promise<OpenDatabaseResult> {
  const dbName = databaseName || 'feltlog.db';
  const sqliteDb = await SQLite.openDatabaseAsync(dbName);

  // Apply encryption key if provided. We do not attempt to validate here,
  // callers should handle errors thrown by SQLite when the key is wrong.
  if (encryptionKey) {
    await sqliteDb.execAsync(`PRAGMA key='${encryptionKey}'`);
  }

  const db = new Kysely<Database>({
    dialect: new ExpoSQLiteDialect({
      database: sqliteDb,
    }),
  });

  return { db, sqliteDb };
}

/**
 * Close the given Expo SQLite database. This does not explicitly dispose the
 * Kysely instance; once the underlying connection is closed, the Kysely
 * instance becomes unusable.
 *
 * @param sqliteDb The SQLite database to close.
 */
export async function closeSqlite(sqliteDb: SQLite.SQLiteDatabase): Promise<void> {
  await sqliteDb.closeAsync();
}
