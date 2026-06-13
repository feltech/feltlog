import { useCallback, useState } from 'react';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { changeDatabaseEncryptionKey } from '@/src/data/database/rekey';
import { backupDatabase, getLatestMigrationKey } from '@/src/data/database/backup';
import { getBackupDirectoryUri, setBackupDirectoryUri } from '@/src/data/database/dbBackupStorage';
import { useDatabase } from '@/src/data/database/database';
import { useDatabaseInfo } from '@/src/domain/repositories/DatabaseContext';

/**
 * Input state owned by the presentation component. The hook reads these values but does
 * not manage them.
 */
export interface UseChangePasswordInput {
  /** The currently active database name. */
  databaseName: string;
  /** Whether the DB is currently encrypted (false if unencrypted). */
  isCurrentlyEncrypted: boolean;
}

/**
 * All async dependencies injected into the hook. Production callers supply defaults
 * wired to the data layer; tests supply synchronous fakes.
 */
export interface UseChangePasswordDeps {
  /** Closes any open connection to the target DB. */
  closeCurrentConnection: () => Promise<void>;
  /**
   * Changes the database encryption key using PRAGMA rekey.
   *
   * @param currentKey - The current encryption key.
   * @param newKey - The desired new encryption key.
   * @param databaseName - The database filename.
   *
   * @returns A result object indicating success or failure.
   */
  changeDatabaseEncryptionKey: (
    currentKey: string,
    newKey: string,
    databaseName: string,
  ) => Promise<{ success: boolean; error?: string }>;
  /** Reopens the DB via useDatabase.initialize. */
  initialize: (params: { encryptionKey: string; databaseName: string }) => Promise<void>;
  /** Performs a safety backup. */
  backupDatabase: (
    targetPath: string,
    directoryUri: string,
    migrationKey: string,
    dbName: string,
    tag?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  /** Returns the configured backup directory URI. */
  getBackupDirectoryUri: () => Promise<string | null>;
  /** Persists a new backup directory URI. */
  setBackupDirectoryUri: (uri: string) => Promise<void>;
  /** Resolves the database file path. */
  getDatabasePath: () => Promise<string>;
  /** Returns the current migration key. */
  getLatestMigrationKey: () => string;
  /** Requests SAF directory permissions. */
  requestDirectoryPermissions: () => Promise<{ granted: boolean; directoryUri?: string }>;
  /** Show a snackbar via the Settings screen. */
  showSnackbar: (message: string, isError: boolean) => void;
}

/** The public API returned by {@link useChangePassword}. */
export interface UseChangePasswordResult {
  /** Whether the change-password dialog is open. */
  isOpen: boolean;
  /** Whether the safety-backup confirmation dialog is open. */
  showConfirmDialog: boolean;
  /** Whether an async operation is in progress. */
  submitting: boolean;
  /** Form state. */
  currentKey: string;
  newKey: string;
  confirmKey: string;
  /** Form setters. */
  setCurrentKey: (v: string) => void;
  setNewKey: (v: string) => void;
  setConfirmKey: (v: string) => void;
  /** Open/close the change-password dialog. */
  open: () => void;
  close: () => void;
  /** Submit the form. Validates inputs, then opens the safety-backup dialog. */
  submit: () => void;
  /** Confirm the safety backup and proceed with rekey. */
  confirmProceed: () => Promise<void>;
  /** Cancel the safety backup. */
  cancelProceed: () => void;
}

/**
 * Custom hook that encapsulates the entire change-password flow.
 *
 * All imperative async logic, error handling, and flow state (submitting, dialog
 * visibility, snackbar) lives here. The calling component remains a thin presentation
 * layer.
 *
 * @param input - Current database state owned by the component.
 * @param deps - Injected async dependencies (data-layer operations).
 *
 * @returns The flow state and callbacks for the component to bind to UI.
 */
export function useChangePassword(
  input: UseChangePasswordInput,
  deps: UseChangePasswordDeps,
): UseChangePasswordResult {
  const [isOpen, setIsOpen] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [currentKey, setCurrentKeyState] = useState('');
  const [newKey, setNewKeyState] = useState('');
  const [confirmKey, setConfirmKeyState] = useState('');

  const resetForm = useCallback(() => {
    setCurrentKeyState('');
    setNewKeyState('');
    setConfirmKeyState('');
  }, []);

  const open = useCallback(() => {
    resetForm();
    setIsOpen(true);
  }, [resetForm]);

  const close = useCallback(() => {
    setIsOpen(false);
    resetForm();
  }, [resetForm]);

  const submit = useCallback(() => {
    if (newKey !== confirmKey) {
      deps.showSnackbar('New key and confirmation do not match', true);
      return;
    }

    if (input.isCurrentlyEncrypted && newKey === currentKey && newKey.length > 0) {
      deps.showSnackbar('New key must be different from the current key', true);
      return;
    }

    if (!input.isCurrentlyEncrypted && newKey.length === 0) {
      deps.showSnackbar('Provide a new key to add encryption', true);
      return;
    }

    setShowConfirmDialog(true);
  }, [newKey, confirmKey, currentKey, input.isCurrentlyEncrypted, deps]);

  const confirmProceed = useCallback(async () => {
    setShowConfirmDialog(false);
    setSubmitting(true);

    try {
      // Ensure a backup directory is configured.
      let dirUri = await deps.getBackupDirectoryUri();
      if (!dirUri) {
        const perm = await deps.requestDirectoryPermissions();
        if (perm.granted && perm.directoryUri) {
          dirUri = perm.directoryUri;
          await deps.setBackupDirectoryUri(dirUri);
        } else {
          deps.showSnackbar('Choose a backup location first', true);
          setSubmitting(false);
          return;
        }
      }

      // Perform safety backup.
      const dbPath = await deps.getDatabasePath();
      const migrationKey = deps.getLatestMigrationKey();
      const safetyResult = await deps.backupDatabase(
        dbPath,
        dirUri,
        migrationKey,
        input.databaseName,
        'before_key_change',
      );
      if (!safetyResult.success) {
        deps.showSnackbar(`Safety backup failed: ${safetyResult.error}`, true);
        setSubmitting(false);
        return;
      }

      // Close current connection and perform rekey.
      await deps.closeCurrentConnection();
      const rekeyResult = await deps.changeDatabaseEncryptionKey(
        currentKey,
        newKey,
        input.databaseName,
      );
      if (!rekeyResult.success) {
        deps.showSnackbar(`Failed to change password: ${rekeyResult.error}`, true);
        setSubmitting(false);
        return;
      }

      // Re-initialize with the new key.
      await deps.initialize({
        encryptionKey: newKey,
        databaseName: input.databaseName,
      });

      setIsOpen(false);
      resetForm();
      deps.showSnackbar('Encryption updated', false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.showSnackbar(`Failed to change password: ${message}`, true);
    } finally {
      setSubmitting(false);
    }
  }, [input.databaseName, currentKey, newKey, deps, resetForm]);

  const cancelProceed = useCallback(() => {
    setShowConfirmDialog(false);
  }, []);

  return {
    isOpen,
    showConfirmDialog,
    submitting,
    currentKey,
    newKey,
    confirmKey,
    setCurrentKey: setCurrentKeyState,
    setNewKey: setNewKeyState,
    setConfirmKey: setConfirmKeyState,
    open,
    close,
    submit,
    confirmProceed,
    cancelProceed,
  };
}

/**
 * Factory that returns a {@link UseChangePasswordDeps} object wired to production
 * data-layer implementations. The component calls this once and passes the result into
 * {@link useChangePassword}.
 *
 * @param showSnackbar - Callback to show snackbar messages from the Settings screen.
 *
 * @returns Production dependencies for the change-password flow hook.
 */
export function useChangePasswordDeps(
  showSnackbar: (message: string, isError: boolean) => void,
): UseChangePasswordDeps {
  // Read from DatabaseInfoProvider context, NOT from useDatabase(). Only
  // RootLayoutNav owns the initialized useDatabase state; calling useDatabase
  // here would create a fresh uninitialized state.
  const { databasePath, sqliteDb } = useDatabaseInfo();
  // For `initialize`, we still need to call the useDatabase hook because that
  // is the only place that mutates the ready/db state. But we read the path
  // from context.
  const { initialize } = useDatabase();

  return {
    closeCurrentConnection: async () => {
      if (sqliteDb) {
        try {
          await sqliteDb.closeAsync();
        } catch {
          // ignore
        }
      }
    },
    changeDatabaseEncryptionKey,
    initialize,
    backupDatabase,
    getBackupDirectoryUri,
    setBackupDirectoryUri,
    getDatabasePath: async () => {
      if (!databasePath) {
        throw new Error('Database not initialized; cannot resolve path');
      }
      return databasePath;
    },
    getLatestMigrationKey,
    requestDirectoryPermissions: () => StorageAccessFramework.requestDirectoryPermissionsAsync(),
    showSnackbar,
  };
}
