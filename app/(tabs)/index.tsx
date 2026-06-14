import React from 'react';
import { StyleSheet, View } from 'react-native';
import { FAB, Snackbar, useTheme } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';

import { JournalList } from '@/src/presentation/components/JournalList';
import { useJournalViewModel } from '@/src/presentation/viewmodels/JournalViewModel';
import type { JournalEntry } from '@/src/domain/entities/JournalEntry';

/**
 * Screen displaying the list of journal entries.
 *
 * @returns The rendered journal screen.
 */
export default function JournalScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { state, actions } = useJournalViewModel();

  // Refresh the list whenever this screen gains focus (e.g., after closing the modal).
  // This ensures we pick up entries created/updated from a different ViewModel
  // instance. Use a stable ref to avoid infinite loops: if we depend on `actions`,
  // React will recreate the callback on every state change which re-triggers
  // `useFocusEffect` while the screen remains focused. We want to refresh only
  // when the screen gains focus, not on every render.
  const refreshOnFocusRef = React.useRef(actions.refreshData);
  React.useEffect(() => {
    refreshOnFocusRef.current = actions.refreshData;
  }, [actions.refreshData]);
  useFocusEffect(
    React.useCallback(() => {
      void refreshOnFocusRef.current();
    }, []),
  );

  /** Navigates to the entry editor to create a new entry. */
  const handleCreateEntry = () => {
    router.push('/entry-editor');
  };

  /**
   * Navigates to the entry editor to edit an existing entry.
   *
   * @param entry - The journal entry to edit.
   */
  const handleEntryPress = (entry: JournalEntry) => {
    router.push(`/entry-editor?entryId=${entry.id}`);
  };

  /** Dismisses the current error message. */
  const handleDismissError = () => {
    actions.setError(null);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <JournalList
        entries={state.entries}
        loading={state.loading}
        hasMore={state.hasMore}
        onLoadMore={actions.loadMoreEntries}
        onRefresh={actions.refreshData}
        onEntryPress={handleEntryPress}
      />

      <FAB
        style={styles.fab}
        icon="plus"
        testID="create-entry-fab"
        accessibilityLabel="Create entry"
        onPress={handleCreateEntry}
      />

      <Snackbar
        visible={!!state.error}
        onDismiss={handleDismissError}
        duration={3000}
        action={{
          label: 'Dismiss',
          onPress: handleDismissError,
        }}
      >
        {state.error}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
  },
});
