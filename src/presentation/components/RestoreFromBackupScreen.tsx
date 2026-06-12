import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Dialog,
  HelperText,
  Portal,
  RadioButton,
  Snackbar,
  Text,
  TextInput,
  Title,
} from 'react-native-paper';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { getBackupDirectoryUri, setBackupDirectoryUri } from '@/src/data/database/dbBackupStorage';
import {
  backupDatabase,
  extractFileName,
  getLatestMigrationKey,
} from '@/src/data/database/backup';
import { restoreDatabase } from '@/src/data/database/restore';
import { useDatabase } from '@/src/data/database/database';

/**
 * Screen that lets the user restore a database from a SAF-backed backup file.
 *
 * Flow:
 *
 * 1. Collect target database name and encryption key.
 * 2. Show a "Select backup file" button that lists `.db` files from the configured SAF
 *    backup directory. 3. If a DB already exists at the target name, show a
 *    confirmation dialog: a safety backup of the current database will be saved before
 *    overwriting.
 * 3. Call `restoreDatabase` to overwrite the target file, then re-open the DB via
 *    `useDatabase().initialize()` so the app transitions to the tabs layout.
 * 4. Errors are surfaced through a snackbar matching the Settings pattern.
 *
 * Because the setup screen is rendered outside the Stack navigator, this screen is
 * intended to be rendered as a sibling of `SetupDatabaseScreen` via a parent state
 * toggle. The `onCancel` prop returns the user to the setup screen.
 */
export interface RestoreFromBackupScreenProps {
  /** The last used database name, if any. */
  lastDatabaseName: string | null;
  /** Callback to return to the setup screen. */
  onCancel: () => void;
}

/**
 * Component that renders the "Restore from backup" UI.
 *
 * @param props - The component props.
 * @param props.lastDatabaseName - The last used database name.
 * @param props.onCancel - Callback invoked when the user taps "Cancel".
 *
 * @returns The rendered restore screen.
 */
export default function RestoreFromBackupScreen({
  lastDatabaseName,
  onCancel,
}: RestoreFromBackupScreenProps) {
  const { initialize } = useDatabase();
  const [databaseName, setDatabaseName] = useState(lastDatabaseName ?? 'feltlog.db');
  const [key, setKey] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [backupDirUri, setBackupDirUriState] = useState<string | null>(null);
  const [backupFiles, setBackupFiles] = useState<string[]>([]);
  const [selectedFileUri, setSelectedFileUri] = useState<string | null>(null);

  const [snackbar, setSnackbar] = useState<{
    visible: boolean;
    message: string;
    isError: boolean;
  }>({ visible: false, message: '', isError: false });

  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [safetyBackupRequired, setSafetyBackupRequired] = useState(false);

  // Load the configured backup directory on mount.
  useEffect(() => {
    (async () => {
      const uri = await getBackupDirectoryUri();
      if (uri) {
        setBackupDirUriState(uri);
        try {
          const files = await StorageAccessFramework.readDirectoryAsync(uri);
          // Filter to likely database backup files.
          const dbFiles = files.filter(f => f.endsWith('.db'));
          setBackupFiles(dbFiles);
        } catch {
          // If listing fails, leave the list empty.
        }
      }
    })();
  }, []);

  const canSubmit = useMemo(
    () => databaseName.trim().length > 0 && selectedFileUri !== null && !submitting,
    [databaseName, selectedFileUri, submitting],
  );

  /**
   * Shows a snackbar message.
   *
   * @param message - The message text to display.
   * @param isError - When true, the snackbar is styled as an error.
   */
  const showSnackbar = (message: string, isError: boolean) => {
    setSnackbar({ visible: true, message, isError });
  };

  /**
   * Requests a SAF backup directory if none is configured.
   *
   * @returns The configured (or newly chosen) backup directory URI, or null if the user
   *   declined the SAF picker or it failed.
   */
  async function ensureBackupDir(): Promise<string | null> {
    if (backupDirUri) return backupDirUri;

    try {
      const result = await StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (result.granted && result.directoryUri) {
        await setBackupDirectoryUri(result.directoryUri);
        setBackupDirUriState(result.directoryUri);
        return result.directoryUri;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showSnackbar(`Failed to choose directory: ${message}`, true);
    }
    return null;
  }

  /**
   * Checks whether the target database file already exists.
   *
   * Opens a transient database handle to discover the file path, then queries its
   * existence via `getInfoAsync`. Returns `true` if a safety backup is needed.
   *
   * @param targetName - The target database file name.
   *
   * @returns True if a database file exists at the target path; false otherwise.
   */
  async function checkTargetExists(targetName: string): Promise<boolean> {
    const { openDatabaseAsync } = await import('expo-sqlite');
    const sqliteDb = await openDatabaseAsync(targetName);
    const targetPath = sqliteDb.databasePath;
    await sqliteDb.closeAsync();

    const { getInfoAsync } = await import('expo-file-system/legacy');
    const info = await getInfoAsync(`file://${targetPath}`);
    return info.exists;
  }

  /** Initiates the restore process. */
  const handleRestore = async () => {
    if (!selectedFileUri) return;

    setSubmitting(true);

    const dirUri = await ensureBackupDir();
    if (!dirUri) {
      showSnackbar('Choose a backup location first', true);
      setSubmitting(false);
      return;
    }

    const trimmedKey = key.trim();
    const targetName = databaseName.trim();

    // Refresh file list if the directory changed.
    try {
      const files = await StorageAccessFramework.readDirectoryAsync(dirUri);
      const dbFiles = files.filter(f => f.endsWith('.db'));
      setBackupFiles(dbFiles);
    } catch {
      // ignore
    }

    // Check if a safety backup is needed.
    try {
      const exists = await checkTargetExists(targetName);
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
    await performRestore(targetName, trimmedKey, selectedFileUri);
    setSubmitting(false);
  };

  /**
   * Performs the actual restore after any confirmation dialogs have been acknowledged.
   *
   * @param targetName - The target database name.
   * @param targetKey - The encryption key for the target database.
   * @param sourceUri - The SAF URI of the backup file to restore from.
   */
  async function performRestore(
    targetName: string,
    targetKey: string,
    sourceUri: string,
  ): Promise<void> {
    // If a safety backup was required, perform it before overwriting.
    if (safetyBackupRequired) {
      const dirUri = backupDirUri ?? (await ensureBackupDir());
      if (!dirUri) {
        showSnackbar('Choose a backup location first', true);
        return;
      }

      try {
        const { openDatabaseAsync } = await import('expo-sqlite');
        const sqliteDb = await openDatabaseAsync(targetName);
        const targetPath = sqliteDb.databasePath;
        await sqliteDb.closeAsync();

        const migrationKey = getLatestMigrationKey();
        const safetyResult = await backupDatabase(targetPath, dirUri, migrationKey, targetName);
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

    const result = await restoreDatabase(targetName, targetKey, sourceUri);
    if (!result.success) {
      showSnackbar(`Restore failed: ${result.error}`, true);
      return;
    }

    // Reopen the database so the app proceeds to the tabs layout.
    try {
      await initialize({ encryptionKey: targetKey, databaseName: targetName });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showSnackbar(`Failed to open restored database: ${message}`, true);
    }
  }

  /** Handles confirmation from the safety-backup dialog. */
  const onConfirmRestore = async () => {
    setShowConfirmDialog(false);
    setSubmitting(true);
    const trimmedKey = key.trim();
    const targetName = databaseName.trim();
    if (selectedFileUri) {
      await performRestore(targetName, trimmedKey, selectedFileUri);
    }
    setSubmitting(false);
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Title style={styles.title}>Restore from backup</Title>

        <TextInput
          testID="restore-db-name-input"
          accessibilityLabel="Database file name input"
          label="Database file name"
          value={databaseName}
          onChangeText={setDatabaseName}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />

        <TextInput
          testID="restore-db-key-input"
          accessibilityLabel="Encryption key input"
          label="Encryption key (leave empty for unencrypted)"
          value={key}
          onChangeText={setKey}
          secureTextEntry
          style={styles.input}
        />
        <HelperText type="info">
          The location will be remembered. Leave empty for an unencrypted database.
        </HelperText>

        {!backupDirUri && (
          <HelperText type="error" testID="restore-error-text">
            No backup location configured. Tap &quot;Choose Backup Location&quot; below.
          </HelperText>
        )}

        <Button
          mode="outlined"
          onPress={async () => {
            try {
              const result = await StorageAccessFramework.requestDirectoryPermissionsAsync();
              if (result.granted && result.directoryUri) {
                await setBackupDirectoryUri(result.directoryUri);
                setBackupDirUriState(result.directoryUri);
                const files = await StorageAccessFramework.readDirectoryAsync(result.directoryUri);
                setBackupFiles(files.filter(f => f.endsWith('.db')));
              } else {
                showSnackbar('Permission denied', true);
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              showSnackbar(`Failed to choose directory: ${message}`, true);
            }
          }}
          style={styles.button}
          testID="restore-choose-backup-location-btn"
        >
          Choose Backup Location
        </Button>

        <Text style={styles.sectionLabel}>Backup files</Text>

        <RadioButton.Group
          onValueChange={value => setSelectedFileUri(value)}
          value={selectedFileUri ?? ''}
        >
          <View testID="restore-source-list">
            {backupFiles.length === 0 && (
              <HelperText type="info">No .db files found in the backup location.</HelperText>
            )}
            {backupFiles.map(uri => {
              const fileName = extractFileName(uri);
              return (
                <View key={uri} style={styles.radioItem}>
                  <RadioButton value={uri} />
                  <Text style={styles.radioLabel} testID={`restore-source-item-${fileName}`}>
                    {fileName}
                  </Text>
                </View>
              );
            })}
          </View>
        </RadioButton.Group>

        <View style={styles.buttonRow}>
          <Button
            mode="contained"
            testID="restore-confirm-btn"
            accessibilityLabel="Restore database"
            disabled={!canSubmit}
            loading={submitting}
            onPress={handleRestore}
            style={styles.confirmButton}
          >
            Restore
          </Button>

          <Button
            mode="outlined"
            testID="restore-cancel-btn"
            accessibilityLabel="Cancel restore"
            disabled={submitting}
            onPress={onCancel}
            style={styles.cancelButton}
          >
            Cancel
          </Button>
        </View>
      </ScrollView>

      <Portal>
        <Dialog
          visible={showConfirmDialog}
          onDismiss={() => setShowConfirmDialog(false)}
          testID="restore-confirm-dialog"
        >
          <Dialog.Title>Confirm restore</Dialog.Title>
          <Dialog.Content>
            <Text>
              A safety backup of the current database will be saved to the configured backup
              location before restoring. Continue?
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setShowConfirmDialog(false)} testID="restore-dialog-cancel">
              Cancel
            </Button>
            <Button onPress={onConfirmRestore} testID="restore-dialog-confirm">
              Restore
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar
        visible={snackbar.visible}
        onDismiss={() => setSnackbar(prev => ({ ...prev, visible: false }))}
        duration={3000}
        style={snackbar.isError ? styles.snackbarError : styles.snackbarSuccess}
        testID="restore-snackbar"
      >
        {snackbar.message}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  title: {
    marginBottom: 16,
  },
  input: {
    marginBottom: 12,
  },
  sectionLabel: {
    marginTop: 16,
    marginBottom: 8,
    fontSize: 14,
    fontWeight: '600',
  },
  radioItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  radioLabel: {
    flex: 1,
  },
  button: {
    marginTop: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: 24,
    gap: 12,
  },
  confirmButton: {
    flex: 1,
  },
  cancelButton: {
    flex: 1,
  },
  snackbarError: {
    backgroundColor: '#d32f2f',
  },
  snackbarSuccess: {
    backgroundColor: '#2e7d32',
  },
});
