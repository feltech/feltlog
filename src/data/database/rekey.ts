import { CompiledQuery, Kysely } from 'kysely';
import { copyAsync, deleteAsync } from 'expo-file-system/legacy';
import { openKysely, closeSqlite } from './database';
import { ensureFileUri } from './backup';
import { Database } from './schema';
import { SQLCIPHER_WRONG_KEY_ERROR_RE } from './errors';

export interface RekeyResult {
  success: boolean;
  error?: string;
}

/**
 * Changes the encryption key of a SQLCipher database.
 *
 * For the simple case where both the current and new keys are non-empty, `PRAGMA rekey`
 * is sufficient and efficient.
 *
 * When transitioning between encrypted and plaintext (current key empty or new key
 * empty), SQLCipher's `PRAGMA rekey` does not support empty keys in this build. The
 * SQLCipher-recommended workaround is `sqlcipher_export()`:
 *
 * 1. Open the source database with the current key.
 * 2. Attach a new database file with the desired key.
 * 3. Run `SELECT sqlcipher_export('alias')` to copy all schema and data.
 * 4. Detach the new database and close the source connection.
 * 5. Replace the original file with the newly created one.
 *
 * **Security note:** SQLCipher does not support prepared-parameter binding for PRAGMA
 * or ATTACH statements, so keys are interpolated directly into the SQL string. Keys are
 * user-provided and never logged.
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
  let sourcePath: string | null = null;

  try {
    const result = await openKysely(currentKey, databaseName);
    db = result.db;
    sqliteDb = result.sqliteDb;
    sourcePath = sqliteDb.databasePath;

    // No-op: plaintext to plaintext.
    if (currentKey === '' && newKey === '') {
      return { success: true };
    }

    const needsExport = currentKey === '' || newKey === '';
    if (!needsExport) {
      // Simple key rotation: PRAGMA rekey is sufficient.
      await db.executeQuery(CompiledQuery.raw(`PRAGMA rekey='${newKey}'`));
      return { success: true };
    }

    // Transition between encrypted and plaintext requires sqlcipher_export.
    const tempPath = sourcePath + '.tmp';

    // Clean up any stale temp file from a previous aborted attempt.
    try {
      await deleteAsync(ensureFileUri(tempPath));
    } catch {
      // ignore — temp file may not exist
    }

    // Attach a new database at the temp path with the target key.
    const keyClause = newKey ? `KEY '${newKey}'` : `KEY ''`;
    await db.executeQuery(CompiledQuery.raw(`ATTACH DATABASE '${tempPath}' AS new ${keyClause}`));

    // Export all schema and data from the current database into the attached one.
    await db.executeQuery(CompiledQuery.raw(`SELECT sqlcipher_export('new')`));

    // Detach the temporary database.
    await db.executeQuery(CompiledQuery.raw(`DETACH DATABASE new`));

    // Close the source connection so the file is no longer locked.
    await closeSqlite(sqliteDb);
    sqliteDb = null;

    // Replace the original file with the exported one.
    // copyAsync + deleteAsync is safer than moveAsync because the original
    // remains intact if the copy fails.
    await copyAsync({
      from: ensureFileUri(tempPath),
      to: ensureFileUri(sourcePath),
    });
    try {
      await deleteAsync(ensureFileUri(tempPath));
    } catch {
      // Best-effort cleanup of the temp file.
    }

    return { success: true };
  } catch (error) {
    // Best-effort cleanup of the temp file on failure.
    if (sourcePath) {
      try {
        await deleteAsync(ensureFileUri(sourcePath + '.tmp'));
      } catch {
        // ignore cleanup errors
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    const isWrongKey = SQLCIPHER_WRONG_KEY_ERROR_RE.test(message);
    return {
      success: false,
      error: isWrongKey ? 'Current password is incorrect' : message,
    };
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
