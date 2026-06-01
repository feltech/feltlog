import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Card, Button, Text, Snackbar, ActivityIndicator, Title } from 'react-native-paper';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { useDatabaseInfo } from '@/src/domain/repositories/DatabaseContext';
import {
  getBackupDirectoryUri,
  setBackupDirectoryUri,
  clearBackupDirectoryUri,
  getLastBackupTimestamp,
  getBackupMaxCount,
} from '@/src/data/database/dbBackupStorage';
import { backupDatabase, getLatestMigrationKey } from '@/src/data/database/backup';

/**
 * Extracts a human-readable directory path from a SAF content URI.
 *
 * SAF URIs have the form "content://authority/tree/primary%3APath%2FTo%2FDir". We
 * decode the URI-encoded last segment and return the path portion after the volume
 * name.
 *
 * @param uri - The SAF content URI.
 *
 * @returns A human-readable path, or the raw URI if parsing fails.
 */
export function parseSafLocation(uri: string): string {
  try {
    const segments = uri.split('/');
    const encoded = segments[segments.length - 1];
    const decoded = decodeURIComponent(encoded);
    // Format: "primary:Documents" or "primary:Path/To/Dir"
    const colonIdx = decoded.indexOf(':');
    if (colonIdx >= 0) {
      return decoded.slice(colonIdx + 1);
    }
    return decoded;
  } catch {
    return uri;
  }
}

/**
 * Settings screen for FeltLog.
 *
 * Displays backup configuration, database information, and app version. Allows the user
 * to choose a backup directory and trigger manual backups.
 *
 * @returns The rendered settings screen.
 */
export default function SettingsScreen() {
  const { databaseName, databasePath } = useDatabaseInfo();

  const [backupDirUri, setBackupDirUriState] = useState<string | null>(null);
  const [lastBackupTime, setLastBackupTime] = useState<string | null>(null);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [maxBackups, setMaxBackups] = useState<number>(5);
  const [snackbar, setSnackbar] = useState<{
    visible: boolean;
    message: string;
    isError: boolean;
  }>({ visible: false, message: '', isError: false });

  // Load persisted backup settings on mount.
  useEffect(() => {
    (async () => {
      const uri = await getBackupDirectoryUri();
      setBackupDirUriState(uri);
      const ts = await getLastBackupTimestamp();
      setLastBackupTime(ts);
      const count = await getBackupMaxCount();
      setMaxBackups(count);

      // If a URI is stored, verify it is still accessible.
      if (uri) {
        try {
          await StorageAccessFramework.readDirectoryAsync(uri);
        } catch {
          // Any readDirectoryAsync failure means we cannot reliably use this
          // directory — listing is required for backup rotation. Clear the URI.
          setBackupDirUriState(null);
          await clearBackupDirectoryUri();
          setSnackbar({
            visible: true,
            message: 'Backup location is no longer accessible. Please choose a new one.',
            isError: true,
          });
        }
      }
    })();
  }, []);

  /**
   * Formats an ISO timestamp into a human-readable string.
   *
   * @param ts - The ISO 8601 timestamp string.
   *
   * @returns A formatted date/time string, or null if the input is invalid.
   */
  function formatTimestamp(ts: string | null): string | null {
    if (!ts) return null;
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString();
  }

  /** Handles choosing a new backup directory via the Storage Access Framework. */
  async function handleChooseBackupLocation() {
    try {
      const result = await StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (result.granted && result.directoryUri) {
        await setBackupDirectoryUri(result.directoryUri);
        setBackupDirUriState(result.directoryUri);
        setSnackbar({
          visible: true,
          message: 'Backup location configured',
          isError: false,
        });
      } else {
        setSnackbar({
          visible: true,
          message: 'Permission denied',
          isError: true,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSnackbar({
        visible: true,
        message: `Failed to choose directory: ${message}`,
        isError: true,
      });
    }
  }

  /**
   * Verifies the backup directory is still accessible.
   *
   * If the directory is inaccessible, clears the stored URI and shows an error snackbar
   * — the name makes this side effect explicit.
   *
   * @returns True if the directory is accessible, false otherwise.
   */
  async function verifyAndClearIfInaccessible(): Promise<boolean> {
    if (!backupDirUri) return false;
    try {
      await StorageAccessFramework.readDirectoryAsync(backupDirUri);
      return true;
    } catch {
      // Any readDirectoryAsync failure means we cannot reliably use this
      // directory — listing is required for backup rotation. Clear the URI.
      setBackupDirUriState(null);
      await clearBackupDirectoryUri();
      setSnackbar({
        visible: true,
        message: 'Backup location is no longer accessible. Please choose a new one.',
        isError: true,
      });
      return false;
    }
  }

  /** Triggers a manual backup of the current database. */
  async function handleBackupNow() {
    if (isBackingUp || !backupDirUri || !databasePath || !databaseName) {
      return;
    }

    const accessible = await verifyAndClearIfInaccessible();
    if (!accessible) return;

    setIsBackingUp(true);

    try {
      const migrationKey = getLatestMigrationKey();
      const result = await backupDatabase(databasePath, backupDirUri, migrationKey, databaseName);

      if (result.success) {
        const now = new Date().toISOString();
        setLastBackupTime(now);
        setSnackbar({
          visible: true,
          message: 'Backup saved',
          isError: false,
        });
      } else {
        setSnackbar({
          visible: true,
          message: result.error || 'Backup failed',
          isError: true,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSnackbar({
        visible: true,
        message: `Backup failed: ${message}`,
        isError: true,
      });
    } finally {
      setIsBackingUp(false);
    }
  }

  const backupNowDisabled = isBackingUp || !backupDirUri || !databasePath || !databaseName;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Backup Section */}
        <Card style={styles.card}>
          <Card.Content>
            <Title>Backup</Title>

            {backupDirUri ? (
              <>
                <Text style={styles.statusText}>Location: {parseSafLocation(backupDirUri)}</Text>
                {lastBackupTime && (
                  <Text style={styles.subText}>
                    Last backup: {formatTimestamp(lastBackupTime)}
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.statusText}>No backup location configured</Text>
            )}

            <Button
              mode="outlined"
              onPress={handleChooseBackupLocation}
              style={styles.button}
              testID="choose-backup-location-btn"
            >
              Choose Backup Location
            </Button>

            <Button
              mode="contained"
              onPress={handleBackupNow}
              disabled={backupNowDisabled}
              style={styles.button}
              testID="backup-now-btn"
            >
              {isBackingUp ? (
                <ActivityIndicator animating={true} size="small" color="#fff" />
              ) : (
                'Backup Now'
              )}
            </Button>
          </Card.Content>
        </Card>

        {/* Database Section */}
        <Card style={styles.card}>
          <Card.Content>
            <Title>Database</Title>
            <Text style={styles.row}>
              <Text style={styles.label}>Active database: </Text>
              {databaseName ?? '—'}
            </Text>
            <Text style={styles.row}>
              <Text style={styles.label}>Encryption: </Text>
              Enabled
            </Text>
            <Text style={styles.row}>
              <Text style={styles.label}>Rolling backups kept: </Text>
              {maxBackups}
            </Text>
          </Card.Content>
        </Card>

        {/* About Section */}
        <Card style={styles.card}>
          <Card.Content>
            <Title>About</Title>
            <Text style={styles.row}>
              <Text style={styles.label}>App name: </Text>FeltLog
            </Text>
            <Text style={styles.row}>
              <Text style={styles.label}>Version: </Text>1.0.0
            </Text>
          </Card.Content>
        </Card>
      </ScrollView>

      <Snackbar
        visible={snackbar.visible}
        onDismiss={() => setSnackbar(prev => ({ ...prev, visible: false }))}
        duration={3000}
        style={snackbar.isError ? styles.snackbarError : styles.snackbarSuccess}
        testID="settings-snackbar"
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
  card: {
    marginBottom: 16,
  },
  button: {
    marginTop: 12,
  },
  statusText: {
    fontSize: 14,
    marginTop: 4,
  },
  subText: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  row: {
    fontSize: 14,
    marginTop: 4,
  },
  label: {
    fontWeight: '600',
  },
  snackbarError: {
    backgroundColor: '#d32f2f',
  },
  snackbarSuccess: {
    backgroundColor: '#2e7d32',
  },
});
