import React from 'react';
import { FlatList, RefreshControl, StyleSheet } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { JournalEntry } from '../../domain/entities/JournalEntry';
import { JournalEntryCard } from './JournalEntryCard';

interface JournalListProps {
  entries: JournalEntry[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onRefresh: () => void;
  onEntryPress?: (entry: JournalEntry) => void;
}

/**
 * Component for rendering a list of journal entries.
 *
 * @param props - Component props.
 * @param props.entries - The list of journal entries to display.
 * @param props.loading - Whether data is currently loading.
 * @param props.hasMore - Whether more entries are available for pagination.
 * @param props.onLoadMore - Callback to load more entries.
 * @param props.onRefresh - Callback to refresh the entire list.
 * @param props.onEntryPress - Optional callback when an entry is pressed.
 *
 * @returns The rendered list of journal entries.
 */
export const JournalList: React.FC<JournalListProps> = ({
  entries,
  loading,
  hasMore,
  onLoadMore,
  onRefresh,
  onEntryPress,
}) => {
  /**
   * Renders a single journal entry card.
   *
   * @param params - The item to render.
   * @param params.item - The journal entry.
   *
   * @returns The rendered entry card.
   */
  const renderEntry = ({ item }: { item: JournalEntry }) => (
    <JournalEntryCard entry={item} onPress={() => onEntryPress?.(item)} />
  );

  /**
   * Renders the footer component for the list.
   *
   * @returns The rendered footer or null.
   */
  const renderFooter = () => {
    if (!hasMore) return null;

    return <ActivityIndicator animating={loading} style={styles.loadingFooter} size="large" />;
  };

  /**
   * Renders the empty state component for the list.
   *
   * @returns The rendered empty state or null.
   */
  const renderEmpty = () => {
    if (loading) return null;

    return (
      <Text style={styles.emptyText}>No journal entries found. Create your first entry!</Text>
    );
  };

  return (
    <FlatList
      data={entries}
      renderItem={renderEntry}
      keyExtractor={item => item.id}
      refreshControl={
        <RefreshControl refreshing={loading && entries.length === 0} onRefresh={onRefresh} />
      }
      onEndReached={() => {
        // Avoid triggering pagination on empty lists which can cause
        // repeated calls and render loops on initial mount.
        if (hasMore && entries.length > 0) {
          onLoadMore();
        }
      }}
      onEndReachedThreshold={0.3}
      ListFooterComponent={renderFooter}
      ListEmptyComponent={renderEmpty}
      contentContainerStyle={entries.length === 0 ? styles.emptyContainer : undefined}
    />
  );
};

const styles = StyleSheet.create({
  loadingFooter: {
    margin: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    margin: 32,
  },
});
