import { openDatabaseAsync } from 'expo-sqlite';
import { readAsStringAsync, writeAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import { ensureFileUri } from './backup';

export interface RestoreResult {
  success: boolean;
  error?: string;
}

/**
 * Restores a database by overwriting the target SQLite file with the contents of a
 * SAF-backed backup file.
 *
 * This function performs the file-level copy only. It does NOT reopen the database with
 * `openKysely` — the caller is responsible for re-initialising the connection after a
 * successful restore so that migrations and the Kysely dialect are set up correctly.
 *
 * The file-path discovery strategy mirrors `backupDatabase` and `database.ts`:
 * `backupDatabase` receives `sourcePath` from an already-open database, and
 * `database.ts:176` reads `sqliteDb.databasePath` from the live handle. Because no
 * database is open here, we open a transient SQLite handle, read its `databasePath`,
 * and immediately close it. The target file is then overwritten with the backup
 * contents.
 *
 * Base64 encoding is used for the read/write so that binary SQLite data is preserved
 * across the JavaScript bridge and the SAF content provider boundary.
 *
 * @param targetDbName - The name of the database file to overwrite.
 * @param targetKey - The encryption key for the target database. Present for API
 *   symmetry with the caller's subsequent `useDatabase().initialize()` call; this
 *   function does not use the key itself.
 * @param sourceFileUri - The SAF file URI of the backup to restore from.
 *
 * @returns A RestoreResult indicating success or failure.
 */
export async function restoreDatabase(
  targetDbName: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  targetKey: string,
  sourceFileUri: string,
): Promise<RestoreResult> {
  try {
    // Discover the target file path by opening a transient database handle.
    const sqliteDb = await openDatabaseAsync(targetDbName);
    const targetPath = sqliteDb.databasePath;
    await sqliteDb.closeAsync();

    // Resolve the target file URI so the write has a well-defined destination.
    const targetUri = ensureFileUri(targetPath);

    // Read the backup file as base64 via SAF.
    const base64Content = await readAsStringAsync(sourceFileUri, {
      encoding: EncodingType.Base64,
    });

    // Overwrite the target SQLite file with the backup contents.
    await writeAsStringAsync(targetUri, base64Content, {
      encoding: EncodingType.Base64,
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
