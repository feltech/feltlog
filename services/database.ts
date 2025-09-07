import { useState, useEffect } from 'react';
import type { Kysely } from 'kysely';
import type { Database } from '@/src/data/database/schema';
import { openKysely } from '@/src/data/database/database';
import { up } from '@/src/data/database/migrations';
import { getLastDatabaseName, setLastDatabaseName } from './dbLocationStorage';

export interface UseDatabaseState {
  ready: boolean;
  db: Kysely<Database> | null;
  error: unknown | null;
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
  const [state, setState] = useState<UseDatabaseState>({ ready: false, db: null, error: null });

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

  const initialize = async ({ encryptionKey, databaseName }: { encryptionKey: string; databaseName: string }) => {
    try {
      const { db } = await openKysely(encryptionKey || undefined, databaseName || undefined);
      await up(db);
      setState({ ready: true, db, error: null });
      try {
        if (databaseName) await setLastDatabaseName(databaseName);
        setLastDatabaseNameState(databaseName || null);
      } catch {
        // ignore storage errors
      }
    } catch (error) {
      setState({ ready: false, db: null, error });
    }
  };

  return { ...state, initialize, lastDatabaseName };
};
