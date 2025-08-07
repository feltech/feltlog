import React from 'react';
import { StyleSheet, View } from 'react-native';
import { FAB, Snackbar } from 'react-native-paper';
import { useRouter } from 'expo-router';

import { JournalList } from '@/src/presentation/components/JournalList';
import { useJournalViewModel } from '@/src/presentation/viewmodels/JournalViewModel';

export default function JournalScreen() {
  const router = useRouter();
  const { state, actions } = useJournalViewModel();

  const handleCreateEntry = () => {
    router.push('/modal');
  };

  const handleEntryPress = (entry: any) => {
    router.push(`/modal?entryId=${entry.id}`);
  };

  const handleDismissError = () => {
    actions.setError(null);
  };

  return (
    <View style={styles.container}>
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
    backgroundColor: '#f5f5f5',
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
  },
});
