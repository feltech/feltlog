import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import type { UseDatabaseApi } from '@/src/data/database/database';

/**
 * Simple setup screen that asks the user to choose a database filename/location
 * and to enter the encryption key. The location is cached for next time via
 * AsyncStorage; the key is never saved.
 */
export interface SetupDatabaseScreenProps {
  initialize: UseDatabaseApi['initialize'];
  lastDatabaseName: string | null;
  error: unknown | null;
}

export default function SetupDatabaseScreen({ initialize, lastDatabaseName, error }: SetupDatabaseScreenProps) {
  const [databaseName, setDatabaseName] = useState(lastDatabaseName ?? 'feltlog.db');
  const [key, setKey] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = useMemo(() => databaseName.trim().length > 0 && key.length > 0, [databaseName, key]);

  const onSubmit = async () => {
    setSubmitting(true);
    await initialize({ encryptionKey: key, databaseName });
    setSubmitting(false);
  };

  return (
    <View style={{ flex: 1, padding: 16, justifyContent: 'center' }}>
      <Text variant="headlineMedium" style={{ marginBottom: 16 }}>Set up database</Text>

      <TextInput
        testID="db-name-input"
        accessibilityLabel="Database file name input"
        label="Database file name"
        value={databaseName}
        onChangeText={setDatabaseName}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ marginBottom: 12 }}
      />

      <TextInput
        testID="db-key-input"
        accessibilityLabel="Encryption key input"
        label="Encryption key"
        value={key}
        onChangeText={setKey}
        secureTextEntry
        style={{ marginBottom: 8 }}
      />
      <HelperText type="info">The location will be remembered. The key is required on every startup.</HelperText>

      {error ? (
        <HelperText type="error" testID="db-error-text" accessibilityLabel="Database error message">{String(error)}</HelperText>
      ) : null}

      <Button
        mode="contained"
        testID="db-open-btn"
        accessibilityLabel="Open or create database"
        disabled={!canSubmit || submitting}
        loading={submitting}
        onPress={onSubmit}
      >
        Open or create database
      </Button>
    </View>
  );
}
