import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Text, Title, useTheme } from 'react-native-paper';

import { useDatabaseInfo } from '@/src/domain/repositories/DatabaseContext';

/**
 * Lock screen that closes the SQLite connection and resets the database state.
 *
 * Tapping the lock button closes the SQLCipher connection (best-effort) and calls
 * {@link DatabaseInfo.resetDatabase}. This sets `ready: false` in the root database
 * hook, which causes the `Stack.Protected` guard in `app/_layout.tsx` to redirect to
 * the setup screen. The encryption key lives only in the SQLCipher connection, so
 * closing it effectively forgets the key.
 *
 * @returns The rendered lock screen.
 */
export default function LockScreen() {
  const theme = useTheme();
  const { sqliteDb, resetDatabase } = useDatabaseInfo();
  const [isLocking, setIsLocking] = useState(false);

  /**
   * Closes the SQLite connection and resets the app database state.
   *
   * The close operation is best-effort: if it throws, the reset still runs so the user
   * is never left on a screen that requires an active database. The loading state is
   * cleared before resetting so the setter does not run after the component unmounts.
   */
  async function handleLock() {
    setIsLocking(true);
    try {
      await sqliteDb?.closeAsync();
    } catch {
      // Best-effort close; proceed to reset state regardless.
    } finally {
      setIsLocking(false);
      resetDatabase();
    }
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      testID="lock-screen"
    >
      <View style={styles.content}>
        <Card style={styles.card}>
          <Card.Content>
            <Title>Lock Journal</Title>
            <Text style={styles.description}>
              Tap below to lock the journal and return to the login screen.
            </Text>
            <Button
              mode="contained"
              icon="lock"
              onPress={handleLock}
              loading={isLocking}
              disabled={isLocking}
              testID="lock-journal-button"
              accessibilityLabel="Lock journal"
            >
              Lock Journal
            </Button>
          </Card.Content>
        </Card>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
  },
  description: {
    fontSize: 14,
    marginBottom: 16,
  },
});
