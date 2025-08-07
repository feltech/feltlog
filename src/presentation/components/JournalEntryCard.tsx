import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Card, Title, Paragraph, Chip, Text } from 'react-native-paper';
import { JournalEntry } from '../../domain/entities/JournalEntry';

interface JournalEntryCardProps {
  entry: JournalEntry;
  onPress?: () => void;
}

export const JournalEntryCard: React.FC<JournalEntryCardProps> = ({ entry, onPress }) => {
  const formatDate = (date: Date) => {
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getPreviewContent = (content: string, maxLength: number = 150) => {
    if (content.length <= maxLength) {
      return content;
    }
    return content.substring(0, maxLength) + '...';
  };

  return (
    <Card style={styles.card} onPress={onPress}>
      <Card.Content>
        <Title style={styles.date}>{formatDate(entry.datetime)}</Title>
        <Paragraph style={styles.content}>
          {getPreviewContent(entry.content)}
        </Paragraph>
        
        {entry.location && (
          <View style={styles.locationContainer}>
            <Text style={styles.locationText}>
              📍 {entry.location.address || 
                `${entry.location.latitude.toFixed(4)}, ${entry.location.longitude.toFixed(4)}`}
            </Text>
          </View>
        )}

        {entry.tags.length > 0 && (
          <View style={styles.tagsContainer}>
            {entry.tags.map((tag, index) => (
              <Chip key={index} style={styles.tag} textStyle={styles.tagText}>
                {tag}
              </Chip>
            ))}
          </View>
        )}

        {entry.created_at !== entry.modified_at && (
          <Text style={styles.modifiedText}>
            Modified: {formatDate(entry.modified_at)}
          </Text>
        )}
      </Card.Content>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    margin: 8,
    elevation: 4,
  },
  date: {
    fontSize: 16,
    marginBottom: 8,
  },
  content: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  locationContainer: {
    marginBottom: 8,
  },
  locationText: {
    fontSize: 12,
    color: '#666',
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
    marginBottom: 4,
  },
  tag: {
    marginRight: 8,
    marginBottom: 4,
    height: 28,
  },
  tagText: {
    fontSize: 12,
  },
  modifiedText: {
    fontSize: 10,
    color: '#999',
    marginTop: 4,
  },
});