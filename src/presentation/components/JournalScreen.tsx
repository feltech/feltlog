import React from 'react';
import { StyleSheet } from 'react-native';
import { Appbar, FAB, Snackbar, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { JournalList } from '@/src/presentation/components/JournalList';
import { JournalFilterPanel } from '@/src/presentation/components/JournalFilterPanel';
import { useJournalViewModel } from '@/src/presentation/viewmodels/JournalViewModel';
import type { JournalEntry } from '@/src/domain/entities/JournalEntry';

/**
 * Screen displaying the list of journal entries with a custom header and filter panel.
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
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={['top']}
    >
      {/* Custom Appbar.Header rendered in the screen content so Maestro can
          interact with the filter and create-entry actions. The native Stack
          header wraps headerRight in an opaque ViewGroup that strips testIDs.
          SafeAreaView with the top edge offsets the header below the Android
          status bar so the system status bar no longer intercepts touches on
          the header action buttons. statusBarHeight={0} avoids double padding. */}
      <Appbar.Header statusBarHeight={0} testID="appbar-header">
        <Appbar.Content title="Journal" />
        <Appbar.Action
          icon="filter-variant"
          testID="filter-button"
          accessibilityLabel="Toggle filter panel"
          onPress={actions.toggleFilterPanel}
        />
        <Appbar.Action
          icon="plus"
          testID="create-entry-header-button"
          accessibilityLabel="Create entry"
          onPress={handleCreateEntry}
        />
      </Appbar.Header>

      {state.filterPanelOpen && (
        <JournalFilterPanel
          draft={state.filterDraft}
          onUpdateDraft={actions.updateFilterDraft}
          onClear={actions.clearFilterDraft}
          onApply={actions.applyFilter}
        />
      )}

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
    </SafeAreaView>
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
