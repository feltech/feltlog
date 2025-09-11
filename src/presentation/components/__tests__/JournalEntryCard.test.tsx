import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { JournalEntryCard } from '../JournalEntryCard';
import { JournalEntry } from '@/src/domain/entities/JournalEntry';

/**
 * Basic render test for JournalEntryCard ensuring testID is present and
 * onPress handler is invoked.
 */

describe('JournalEntryCard', () => {
  const sampleEntry: JournalEntry = {
    id: '1',
    content: 'Sample content',
    datetime: new Date('2024-01-01T00:00:00Z'),
    created_at: new Date('2024-01-01T00:00:00Z'),
    modified_at: new Date('2024-01-01T00:00:00Z'),
    tags: ['tag1'],
  };

  it('renders with testID and responds to onPress', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<JournalEntryCard entry={sampleEntry} onPress={onPress} />);

    const card = getByTestId('journal-entry-card');
    expect(card).toBeTruthy();

    fireEvent.press(card);
    expect(onPress).toHaveBeenCalled();
  });
});
