import {useEffect, useState} from 'react';
import {Database} from '@/src/data/database/schema';
import {up} from '@/src/data/database/migrations';
import {getLastDatabaseName, setLastDatabaseName} from './dbLocationStorage';
import {CompiledQuery, Kysely} from "kysely";
import {SQLiteDatabase, openDatabaseAsync} from "expo-sqlite";
import {ExpoDialect} from "kysely-expo";

export interface UseDatabaseState {
    ready: boolean;
    db: Kysely<Database> | null;
    error: unknown | null;
}

export interface OpenDatabaseResult {
    db: Kysely<Database>;
    sqliteDb: SQLiteDatabase;
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
    const sqliteDb = await openDatabaseAsync(dbName);

    const db = new Kysely<Database>({
        dialect: new ExpoDialect({database: sqliteDb})
    });

    // Apply encryption key if provided. We do not attempt to validate here,
    // callers should handle errors thrown by SQLite when the key is wrong.
    if (encryptionKey) {
        await db.executeQuery(CompiledQuery.raw(`PRAGMA key='${encryptionKey}'`));
    }
    return {db, sqliteDb};
}

/**
 * Close the given Expo SQLite database. This does not explicitly dispose the
 * Kysely instance; once the underlying connection is closed, the Kysely
 * instance becomes unusable.
 *
 * @param sqliteDb The SQLite database to close.
 */
export async function closeSqlite(sqliteDb: SQLiteDatabase): Promise<void> {
    await sqliteDb.closeAsync();
}

/**
 * Hook that opens and migrates the database once and returns its state.
 *
 * This avoids any singleton patterns by keeping the db handle in React
 * state at the app root (or test) level.
 */
export interface UseDatabaseApi extends UseDatabaseState {
    initialize: (params: { encryptionKey: string; databaseName: string }) => Promise<void>;
    lastDatabaseName: string | null;
}

export const useDatabase = (): UseDatabaseApi => {
    const [state, setState] = useState<UseDatabaseState>({ready: false, db: null, error: null});

    const [lastDatabaseName, setLastDatabaseNameState] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        // Load last database name from storage for autofill purposes.
        (async () => {
            try {
                const name = await getLastDatabaseName();
                if (!cancelled) setLastDatabaseNameState(name);
            } catch (e) {
                // ignore
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const initialize = async ({encryptionKey, databaseName}: { encryptionKey: string; databaseName: string }) => {
        try {
            const {db} = await openKysely(encryptionKey || undefined, databaseName || undefined);
            await up(db);
            setState({ready: true, db, error: null});
            try {
                if (databaseName) await setLastDatabaseName(databaseName);
                setLastDatabaseNameState(databaseName || null);
            } catch {
                // ignore storage errors
            }
        } catch (error) {
            setState({ready: false, db: null, error});
        }
    };

    return {...state, initialize, lastDatabaseName};
};
