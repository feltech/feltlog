import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { JournalEntryCard } from '../JournalEntryCard';
import { JournalEntry } from '@/src/domain/entities/JournalEntry';

/**
 * Test suite for the JournalEntryCard component. Covers rendering, markdown content,
 * long content truncation, location display, tags display, and modified indicator.
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

  /** Tests that the card renders with testID and responds to press events. */
  it('renders with testID and responds to onPress', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<JournalEntryCard entry={sampleEntry} onPress={onPress} />);

    const card = getByTestId('journal-entry-card');
    expect(card).toBeTruthy();

    fireEvent.press(card);
    expect(onPress).toHaveBeenCalled();
  });

  /** Tests that markdown content is rendered. */
  it('renders markdown content', () => {
    const markdownEntry: JournalEntry = {
      ...sampleEntry,
      content: '# Heading\n\nThis is **bold** and *italic* text.',
    };
    const { getByText } = render(<JournalEntryCard entry={markdownEntry} />);
    expect(getByText(/# Heading/)).toBeTruthy();
  });

  /**
   * Tests that long content is truncated with ellipsis. Covers the false branch of `if
   * (content.length <= maxLength)` at line 77.
   */
  it('truncates content longer than 150 characters', () => {
    const longContent = 'A'.repeat(200);
    const longEntry: JournalEntry = {
      ...sampleEntry,
      content: longContent,
    };
    const { getByText } = render(<JournalEntryCard entry={longEntry} />);
    // The truncated content should end with '...'
    const rendered = getByText(/A{150}\.\.\./);
    expect(rendered).toBeTruthy();
  });

  /** Tests that short content is not truncated. */
  it('does not truncate short content', () => {
    const shortEntry: JournalEntry = {
      ...sampleEntry,
      content: 'Short content',
    };
    const { getByText } = render(<JournalEntryCard entry={shortEntry} />);
    expect(getByText(/Short content/)).toBeTruthy();
  });

  /** Tests that location is displayed when present on the entry. */
  it('displays location address when entry has location', () => {
    const entryWithLocation: JournalEntry = {
      ...sampleEntry,
      location: {
        latitude: 40.7128,
        longitude: -74.006,
        elevation: 10,
        address: 'New York, NY',
      },
    };
    const { getByText } = render(<JournalEntryCard entry={entryWithLocation} />);
    expect(getByText(/New York, NY/)).toBeTruthy();
  });

  /** Tests that coordinates are displayed when location has no address. */
  it('displays coordinates when entry has location without address', () => {
    const entryWithCoords: JournalEntry = {
      ...sampleEntry,
      location: {
        latitude: 40.7128,
        longitude: -74.006,
        elevation: 10,
      },
    };
    const { getByText } = render(<JournalEntryCard entry={entryWithCoords} />);
    // Should show lat/lon coordinates.
    expect(getByText(/40\.7128/)).toBeTruthy();
  });

  /** Tests that the modified indicator is shown when created_at !== modified_at. */
  it('shows modified indicator when entry was modified', () => {
    const modifiedEntry: JournalEntry = {
      ...sampleEntry,
      created_at: new Date('2024-01-01T00:00:00Z'),
      modified_at: new Date('2024-01-02T00:00:00Z'),
    };
    const { getByText } = render(<JournalEntryCard entry={modifiedEntry} />);
    expect(getByText(/Modified:/)).toBeTruthy();
  });

  /**
   * Tests that the modified indicator is NOT shown when created_at === modified_at.
   * Note: the component uses !== which is reference equality, so we must use the same
   * Date instance for both fields.
   */
  it('does not show modified indicator when entry was not modified', () => {
    const sameDate = new Date('2024-01-01T00:00:00Z');
    const unmodifiedEntry: JournalEntry = {
      ...sampleEntry,
      created_at: sameDate,
      modified_at: sameDate,
    };
    const { queryByText } = render(<JournalEntryCard entry={unmodifiedEntry} />);
    expect(queryByText(/Modified:/)).toBeNull();
  });

  /** Tests that the card renders without an onPress callback. */
  it('renders without onPress callback', () => {
    const { toJSON } = render(<JournalEntryCard entry={sampleEntry} />);
    expect(toJSON()).toBeTruthy();
  });
});
