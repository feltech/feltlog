import React from 'react';
import { FlatList, StyleSheet, RefreshControl } from 'react-native';
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

export const JournalList: React.FC<JournalListProps> = ({
  entries,
  loading,
  hasMore,
  onLoadMore,
  onRefresh,
  onEntryPress,
}) => {
  const renderEntry = ({ item }: { item: JournalEntry }) => (
    <JournalEntryCard
      entry={item}
      onPress={() => onEntryPress?.(item)}
    />
  );

  const renderFooter = () => {
    if (!hasMore) return null;
    
    return (
      <ActivityIndicator 
        animating={loading} 
        style={styles.loadingFooter}
        size="large"
      />
    );
  };

  const renderEmpty = () => {
    if (loading) return null;
    
    return (
      <Text style={styles.emptyText}>
        No journal entries found. Create your first entry!
      </Text>
    );
  };

  return (
    <FlatList
      data={entries}
      renderItem={renderEntry}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl
          refreshing={loading && entries.length === 0}
          onRefresh={onRefresh}
        />
      }
      onEndReached={onLoadMore}
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