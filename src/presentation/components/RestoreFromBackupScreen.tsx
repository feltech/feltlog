import React, { useEffect, useState } from 'react';
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
import { extractFileName } from '@/src/data/database/backup';
import { useRestoreFlow, useRestoreFlowDeps } from './useRestoreFlow';

/**
 * Screen that lets the user restore a database from a SAF-backed backup file.
 *
 * Flow:
 *
 * 1. Collect target database name and encryption key.
 * 2. Show a "Select backup file" button that lists `.db` files from the configured SAF
 *    backup directory.
 * 3. If a DB already exists at the target name, show a confirmation dialog: a safety
 *    backup of the current database will be saved before overwriting.
 * 4. Call `restoreDatabase` to overwrite the target file, then re-open the DB via
 *    `useDatabase().initialize()` so the app transitions to the tabs layout.
 * 5. Errors are surfaced through a snackbar matching the Settings pattern.
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
  const [databaseName, setDatabaseName] = useState(lastDatabaseName ?? 'feltlog.db');
  const [key, setKey] = useState('');
  const [backupDirUri, setBackupDirUri] = useState<string | null>(null);
  const [backupFiles, setBackupFiles] = useState<string[]>([]);
  const [selectedFileUri, setSelectedFileUri] = useState<string | null>(null);

  const deps = useRestoreFlowDeps();
  const flow = useRestoreFlow({ databaseName, key, selectedFileUri, backupDirUri }, deps);

  // Load the configured backup directory on mount.
  useEffect(() => {
    (async () => {
      const uri = await deps.getBackupDirectoryUri();
      if (uri) {
        setBackupDirUri(uri);
        const files = await flow.refreshFileList(uri);
        setBackupFiles(files);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <HelperText
            type="error"
            testID="restore-error-text"
            accessibilityLabel={`backup-dir-uri-${backupDirUri ?? 'null'}`}
          >
            No backup location configured. Tap &quot;Choose Backup Location&quot; below.
          </HelperText>
        )}

        <Button
          mode="outlined"
          onPress={async () => {
            const newUri = await flow.chooseBackupDirectory();
            if (newUri) {
              setBackupDirUri(newUri);
              const files = await flow.refreshFileList(newUri);
              setBackupFiles(files);
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
                <RadioButton.Item
                  key={uri}
                  value={uri}
                  label={fileName}
                  testID={`restore-source-item-${fileName}`}
                  position="leading"
                  style={styles.radioItem}
                />
              );
            })}
          </View>
        </RadioButton.Group>

        <View style={styles.buttonRow}>
          <Button
            mode="contained"
            testID="restore-confirm-btn"
            accessibilityLabel="Restore database"
            disabled={!flow.canSubmit}
            loading={flow.submitting}
            onPress={flow.handleRestore}
            style={styles.confirmButton}
          >
            Restore
          </Button>

          <Button
            mode="outlined"
            testID="restore-cancel-btn"
            accessibilityLabel="Cancel restore"
            disabled={flow.submitting}
            onPress={onCancel}
            style={styles.cancelButton}
          >
            Cancel
          </Button>
        </View>
      </ScrollView>

      <Portal>
        <Dialog
          visible={flow.showConfirmDialog}
          onDismiss={flow.cancelRestore}
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
            <Button onPress={flow.cancelRestore} testID="restore-dialog-cancel">
              Cancel
            </Button>
            <Button onPress={flow.confirmRestore} testID="restore-dialog-confirm">
              Restore
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar
        visible={flow.snackbar.visible}
        onDismiss={flow.dismissSnackbar}
        duration={3000}
        style={flow.snackbar.isError ? styles.snackbarError : styles.snackbarSuccess}
        testID="restore-snackbar"
      >
        {flow.snackbar.message}
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
    marginVertical: 4,
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
