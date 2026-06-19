import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, Chip, Text, useTheme } from 'react-native-paper';
import Markdown from 'react-native-markdown-renderer';
import { JournalEntry } from '../../domain/entities/JournalEntry';
import type { AppTheme } from '../theme/appTheme';

/** Props for the JournalEntryCard component. */
export interface JournalEntryCardProps {
  /** The journal entry to display. */
  entry: JournalEntry;
  /** Optional callback when the card is pressed. */
  onPress?: () => void;
}

/**
 * Creates markdown renderer styles derived from the current Paper theme.
 *
 * Keeping this as a plain object (instead of StyleSheet.create) makes the resulting
 * style tree easy to inspect in tests and guarantees that dynamic theme colors are
 * applied without flattening StyleSheet references.
 *
 * @param theme - The current app theme.
 *
 * @returns Markdown style object for react-native-markdown-renderer.
 */
function createMarkdownStyles(theme: AppTheme) {
  return {
    heading1: { fontSize: 24, fontWeight: 'bold' as const, marginBottom: 8 },
    heading2: { fontSize: 20, fontWeight: 'bold' as const, marginBottom: 6 },
    heading3: { fontSize: 18, fontWeight: 'bold' as const, marginBottom: 4 },
    paragraph: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
    strong: { fontWeight: 'bold' as const },
    em: { fontStyle: 'italic' as const },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.outline,
      paddingLeft: 8,
      marginVertical: 4,
    },
    code: {
      backgroundColor: theme.colors.surfaceVariant,
      paddingHorizontal: 4,
      fontFamily: 'monospace',
      fontSize: 12,
    },
    link: { color: theme.colors.primary },
    // The markdown renderer creates its own internal <Text> elements that do not
    // inherit the parent's color, so the base text color must be set explicitly
    // to remain readable in dark mode.
    text: { color: theme.colors.onSurface },
  };
}

/**
 * Component for rendering a single journal entry as a card.
 *
 * @param props - Component props.
 * @param props.entry - The journal entry to display.
 * @param props.onPress - Optional callback when the card is pressed.
 *
 * @returns The rendered journal entry card.
 */
export const JournalEntryCard: React.FC<JournalEntryCardProps> = ({ entry, onPress }) => {
  const theme = useTheme();
  const markdownStyles = useMemo(() => createMarkdownStyles(theme as AppTheme), [theme]);

  /**
   * Formats a date object into a localized string.
   *
   * @param date - The date to format.
   *
   * @returns The formatted date string.
   */
  const formatDate = (date: Date) => {
    return (
      date.toLocaleDateString() +
      ' ' +
      date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    );
  };

  /**
   * Generates a preview snippet of the entry content.
   *
   * @param content - The full content string.
   * @param maxLength - The maximum length of the preview snippet.
   *
   * @returns The preview snippet.
   */
  const getPreviewContent = (content: string, maxLength: number = 150) => {
    if (content.length <= maxLength) {
      return content;
    }
    return content.substring(0, maxLength) + '...';
  };

  return (
    <Card
      style={styles.card}
      onPress={onPress}
      testID="journal-entry-card"
      accessibilityLabel="Journal entry card"
    >
      <Card.Content>
        <Text variant="titleLarge" style={styles.date}>
          {formatDate(entry.datetime)}
        </Text>
        <Text variant="bodyMedium" style={styles.content}>
          <Markdown style={markdownStyles}>{getPreviewContent(entry.content)}</Markdown>
        </Text>

        {entry.location && (
          <View style={styles.locationContainer}>
            <Text style={[styles.locationText, { color: theme.colors.onSurfaceVariant }]}>
              📍{' '}
              {entry.location.address ||
                `${entry.location.latitude.toFixed(4)}, ${entry.location.longitude.toFixed(4)}`}
            </Text>
          </View>
        )}

        {entry.tags.length > 0 && (
          <View style={styles.tagsContainer}>
            {entry.tags.map((tag: string, index: number) => (
              <Chip key={index} style={styles.tag} textStyle={styles.tagText}>
                {tag}
              </Chip>
            ))}
          </View>
        )}

        {entry.created_at !== entry.modified_at && (
          <Text style={[styles.modifiedText, { color: theme.colors.onSurfaceVariant }]}>
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
    marginTop: 4,
  },
});
