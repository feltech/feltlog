import { Kysely } from 'kysely';
import { CompiledQuery } from 'kysely';
import { openKysely, closeSqlite } from './database';
import { Database } from './schema';

export interface RekeyResult {
  success: boolean;
  error?: string;
}

/**
 * Changes the encryption key of a SQLCipher database using `PRAGMA rekey`.
 *
 * SQLCipher supports three scenarios via `PRAGMA rekey`:
 *
 * 1. **Add encryption** — open the DB with an empty key (no `PRAGMA key`), then issue
 *    `PRAGMA rekey='<newKey>'`. The database becomes encrypted.
 * 2. **Change encryption** — open the DB with the current key, then issue `PRAGMA
 *    rekey='<newKey>'`. The database is re-encrypted with the new key.
 * 3. **Remove encryption** — open the DB with the current key, then issue `PRAGMA
 *    rekey=''` (empty string). The database becomes unencrypted.
 *
 * This helper performs the sequence: close any open connection, open with the current
 * key, issue `PRAGMA rekey`, and close the connection. The caller is responsible for
 * re-opening the database with the new key afterwards (via `useDatabase().initialize({
 * encryptionKey: newKey, databaseName })`).
 *
 * **Security note:** SQLCipher does not support prepared-parameter binding for PRAGMA
 * statements, so the new key is interpolated directly into the SQL string: `PRAGMA
 * rekey='<newKey>'`. The key is entered by the user in a controlled TextInput and is
 * never logged. No key material is included in error messages or console output.
 *
 * @param currentKey - The current encryption key (empty string if the DB is
 *   unencrypted).
 * @param newKey - The desired encryption key (empty string to remove encryption).
 * @param databaseName - The database filename to operate on.
 *
 * @returns A {@link RekeyResult} indicating success or failure.
 */
export async function changeDatabaseEncryptionKey(
  currentKey: string,
  newKey: string,
  databaseName: string,
): Promise<RekeyResult> {
  let db: Kysely<Database> | null = null;
  let sqliteDb: import('expo-sqlite').SQLiteDatabase | null = null;

  try {
    const result = await openKysely(currentKey, databaseName);
    db = result.db;
    sqliteDb = result.sqliteDb;

    // Issue PRAGMA rekey. The key is interpolated because SQLCipher does not
    // support parameter binding for PRAGMA statements. The key is user-provided
    // from a controlled input and is never logged.
    await db.executeQuery(CompiledQuery.raw(`PRAGMA rekey='${newKey}'`));

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  } finally {
    if (sqliteDb) {
      try {
        await closeSqlite(sqliteDb);
      } catch {
        // Ignore close errors — the rekey result has already been determined.
      }
    }
  }
}
