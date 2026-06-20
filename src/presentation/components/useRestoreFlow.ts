import { useCallback, useMemo, useState } from 'react';
import { StorageAccessFramework, getInfoAsync } from 'expo-file-system/legacy';
import { defaultDatabaseDirectory, openDatabaseAsync } from 'expo-sqlite';
import { getBackupDirectoryUri, setBackupDirectoryUri } from '@/src/data/database/dbBackupStorage';
import {
  backupDatabase,
  extractFileName,
  getLatestMigrationKey,
} from '@/src/data/database/backup';
import { restoreDatabase } from '@/src/data/database/restore';

/**
 * Input state owned by the presentation component. The hook reads these values but does
 * not manage them.
 */
export interface UseRestoreFlowInput {
  /** The current target database name (from the form). */
  databaseName: string;
  /** The currently selected backup file URI (from the radio group). */
  selectedFileUri: string | null;
  /** The configured SAF backup directory URI, or null if not yet configured. */
  backupDirUri: string | null;
}

/**
 * All async dependencies injected into the hook. Production callers supply defaults
 * wired to the data layer; tests supply synchronous fakes.
 */
export interface UseRestoreFlowDeps {
  /** Resolves the configured backup directory URI from storage. */
  getBackupDirectoryUri: () => Promise<string | null>;
  /** Persists a new backup directory URI to storage. */
  setBackupDirectoryUri: (uri: string) => Promise<void>;
  /** Requests SAF directory permissions from the user. */
  requestDirectoryPermissions: () => Promise<{
    granted: boolean;
    directoryUri?: string;
  }>;
  /** Lists files in a SAF directory. */
  readDirectory: (uri: string) => Promise<string[]>;
  /** Checks whether a database file exists at a path. */
  fileExists: (path: string) => Promise<boolean>;
  /** Performs the file-level restore. */
  restoreDatabase: (
    targetDbName: string,
    sourceFileUri: string,
  ) => Promise<{ success: boolean; error?: string }>;
  /** Performs a safety backup of an existing database. */
  backupDatabase: (
    targetPath: string,
    directoryUri: string,
    migrationKey: string,
    dbName: string,
    tag?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  /** Called after a successful restore so the UI returns to the setup screen. */
  onSuccess: () => Promise<void>;
  /** Returns the current migration key for the database schema. */
  getLatestMigrationKey: () => string;
  /** Opens a database handle (used to discover its file path). */
  openDatabase: (name: string) => Promise<{
    databasePath: string;
    closeAsync: () => Promise<void>;
  }>;
}

/** The public API returned by {@link useRestoreFlow}. */
export interface UseRestoreFlowResult {
  /** Whether the form is ready to submit. */
  canSubmit: boolean;
  /** Whether an async operation is in progress. */
  submitting: boolean;
  /** Whether the confirm dialog is visible. */
  showConfirmDialog: boolean;
  /** Snackbar state. */
  snackbar: { visible: boolean; message: string; isError: boolean };
  /** Opens the SAF directory picker. Returns the new URI or null. */
  chooseBackupDirectory: () => Promise<string | null>;
  /** Selects a backup file from the list (no-op — state lives in the component). */
  selectFile: (uri: string) => void;
  /**
   * Lists .db files from the configured directory. An optional override URI can be
   * passed when the component has just obtained a new directory but hasn't re-rendered
   * yet.
   */
  refreshFileList: (overrideDirUri?: string) => Promise<string[]>;
  /** Initiates the restore flow. */
  handleRestore: () => Promise<void>;
  /** Confirms the safety-backup dialog and proceeds with restore. */
  confirmRestore: () => Promise<void>;
  /** Dismisses the confirm dialog without proceeding. */
  cancelRestore: () => void;
  /** Dismisses the snackbar. */
  dismissSnackbar: () => void;
}

/**
 * Custom hook that encapsulates the entire restore-from-backup flow.
 *
 * All imperative async logic, error handling, and flow state (submitting, dialog
 * visibility, snackbar) lives here. The calling component remains a thin presentation
 * layer.
 *
 * @param input - Current form and selection state owned by the component.
 * @param deps - Injected async dependencies (data-layer operations).
 *
 * @returns The flow state and callbacks for the component to bind to UI.
 */
export function useRestoreFlow(
  input: UseRestoreFlowInput,
  deps: UseRestoreFlowDeps,
): UseRestoreFlowResult {
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [safetyBackupRequired, setSafetyBackupRequired] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    visible: boolean;
    message: string;
    isError: boolean;
  }>({ visible: false, message: '', isError: false });

  const showSnackbar = useCallback((message: string, isError: boolean) => {
    setSnackbar({ visible: true, message, isError });
  }, []);

  const dismissSnackbar = useCallback(() => {
    setSnackbar(prev => ({ ...prev, visible: false }));
  }, []);

  const canSubmit = useMemo(
    () => input.databaseName.trim().length > 0 && input.selectedFileUri !== null && !submitting,
    [input.databaseName, input.selectedFileUri, submitting],
  );

  /**
   * Opens the SAF directory picker and persists the chosen URI.
   *
   * @returns The newly chosen directory URI, or null if the user denied permission or
   *   an error occurred.
   */
  const chooseBackupDirectory = useCallback(async (): Promise<string | null> => {
    try {
      const result = await deps.requestDirectoryPermissions();
      if (result.granted && result.directoryUri) {
        await deps.setBackupDirectoryUri(result.directoryUri);
        return result.directoryUri;
      }
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showSnackbar(`Failed to choose directory: ${message}`, true);
      return null;
    }
  }, [deps, showSnackbar]);

  /**
   * No-op: the component owns selectedFileUri via RadioButton.Group.
   *
   * @param _uri - The selected file URI.
   */
  const selectFile = useCallback((_uri: string) => {
    // Intentionally empty — component manages this state.
  }, []);

  /**
   * Reads the configured backup directory and filters to .db files.
   *
   * @param overrideDirUri - Optional directory URI to use instead of the one in input.
   *
   * @returns The list of .db file URIs, or an empty array on error.
   */
  const refreshFileList = useCallback(
    async (overrideDirUri?: string): Promise<string[]> => {
      const dir = overrideDirUri ?? input.backupDirUri;
      if (!dir) return [];
      try {
        const files = await deps.readDirectory(dir);
        // Sort newest-first: backup filenames embed timestamps, so descending
        // filename order matches reverse chronological order. Compare on the
        // decoded filename rather than the raw URI, because SAF content:// URIs
        // percent-encode path separators in the last segment — mirroring the
        // rotation sort in src/data/database/backup.ts (rotateBackups).
        return files
          .filter(f => f.endsWith('.db'))
          .sort((a, b) => extractFileName(b).localeCompare(extractFileName(a)));
      } catch {
        return [];
      }
    },
    [input.backupDirUri, deps],
  );

  /**
   * Performs the actual restore after any confirmation dialogs have been acknowledged.
   *
   * This is a pure file copy: the caller is returned to the setup/login screen after
   * success, where they can open the restored database with the appropriate encryption
   * key (if any). We intentionally do not rekey or initialize the database here.
   *
   * @param targetName - The target database name.
   * @param sourceUri - The SAF URI of the backup file to restore from.
   */
  const performRestore = useCallback(
    async (targetName: string, sourceUri: string): Promise<void> => {
      // If a safety backup was required, perform it before overwriting.
      if (safetyBackupRequired) {
        const dirUri = input.backupDirUri ?? (await chooseBackupDirectory());
        if (!dirUri) {
          showSnackbar('Choose a backup location first', true);
          return;
        }

        try {
          const sqliteDb = await deps.openDatabase(targetName);
          const targetPath = sqliteDb.databasePath;
          await sqliteDb.closeAsync();

          const migrationKey = deps.getLatestMigrationKey();
          const safetyResult = await deps.backupDatabase(
            targetPath,
            dirUri,
            migrationKey,
            targetName,
            'before_restore_backup',
          );
          if (!safetyResult.success) {
            showSnackbar(`Safety backup failed: ${safetyResult.error}`, true);
            return;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          showSnackbar(`Safety backup failed: ${message}`, true);
          return;
        }
      }

      const result = await deps.restoreDatabase(targetName, sourceUri);
      if (!result.success) {
        showSnackbar(`Restore failed: ${result.error}`, true);
        return;
      }

      try {
        await deps.onSuccess();
      } catch {
        // The success callback is best-effort UI cleanup; the restore has already
        // succeeded at this point.
      }
    },
    [safetyBackupRequired, input.backupDirUri, deps, showSnackbar, chooseBackupDirectory],
  );

  /** Initiates the restore process. */
  const handleRestore = useCallback(async () => {
    if (!input.selectedFileUri) return;

    setSubmitting(true);

    const dirUri = input.backupDirUri ?? (await chooseBackupDirectory());
    if (!dirUri) {
      showSnackbar('Choose a backup location first', true);
      setSubmitting(false);
      return;
    }

    const targetName = input.databaseName.trim();

    // Refresh file list if the directory changed (best-effort).
    try {
      await deps.readDirectory(dirUri);
    } catch {
      // Swallow — listing is not critical for the restore decision.
    }

    // Check if a safety backup is needed.
    try {
      const exists = await deps.fileExists(targetName);
      if (exists) {
        setSafetyBackupRequired(true);
        setShowConfirmDialog(true);
        setSubmitting(false);
        return;
      }
    } catch {
      // If the check itself fails, assume we need confirmation.
      setSafetyBackupRequired(true);
      setShowConfirmDialog(true);
      setSubmitting(false);
      return;
    }

    // No existing DB — proceed directly.
    await performRestore(targetName, input.selectedFileUri);
    setSubmitting(false);
  }, [
    input.selectedFileUri,
    input.backupDirUri,
    input.databaseName,
    deps,
    showSnackbar,
    chooseBackupDirectory,
    performRestore,
  ]);

  /** Handles confirmation from the safety-backup dialog. */
  const confirmRestore = useCallback(async () => {
    setShowConfirmDialog(false);
    setSubmitting(true);
    const targetName = input.databaseName.trim();
    if (input.selectedFileUri) {
      await performRestore(targetName, input.selectedFileUri);
    }
    setSubmitting(false);
  }, [input.databaseName, input.selectedFileUri, performRestore]);

  /** Dismisses the confirm dialog without restoring. */
  const cancelRestore = useCallback(() => {
    setShowConfirmDialog(false);
    setSafetyBackupRequired(false);
  }, []);

  return {
    canSubmit,
    submitting,
    showConfirmDialog,
    snackbar,
    chooseBackupDirectory,
    selectFile,
    refreshFileList,
    handleRestore,
    confirmRestore,
    cancelRestore,
    dismissSnackbar,
  };
}

/**
 * Factory that returns a {@link UseRestoreFlowDeps} object wired to production
 * data-layer implementations. The component calls this once and passes the result into
 * {@link useRestoreFlow}.
 *
 * @param onSuccess - Callback invoked after a successful restore.
 *
 * @returns Production dependencies for the restore flow hook.
 */
export function useRestoreFlowDeps(onSuccess: () => Promise<void>): UseRestoreFlowDeps {
  return {
    getBackupDirectoryUri,
    setBackupDirectoryUri,
    requestDirectoryPermissions: () => StorageAccessFramework.requestDirectoryPermissionsAsync(),
    readDirectory: uri => StorageAccessFramework.readDirectoryAsync(uri),
    fileExists: async name => {
      try {
        // Construct the path synchronously using defaultDatabaseDirectory to
        // avoid creating the file by calling openDatabaseAsync. The default
        // directory is the app's internal databases directory on Android/iOS.
        const dbPath = `${defaultDatabaseDirectory.replace(/\/*$/, '')}/${name.replace(/^\/+/, '')}`;
        const uri = dbPath.startsWith('file://') ? dbPath : `file://${dbPath}`;
        const info = await getInfoAsync(uri);
        return info.exists;
      } catch {
        return false;
      }
    },
    restoreDatabase,
    backupDatabase,
    onSuccess,
    getLatestMigrationKey,
    openDatabase: openDatabaseAsync,
  };
}
