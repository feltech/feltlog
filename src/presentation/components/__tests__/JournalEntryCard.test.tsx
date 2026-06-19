import React from 'react';
import { Text as RNText } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import Markdown from 'react-native-markdown-renderer';
import { Text as PaperText } from 'react-native-paper';
import { JournalEntryCard } from '../JournalEntryCard';
import { JournalEntry } from '@/src/domain/entities/JournalEntry';
import { darkTheme, lightTheme } from '@/src/presentation/theme/appTheme';

let mockCapturedMarkdownStyle: Record<string, unknown> | undefined;

jest.mock('react-native-paper', () => {
  const actual = jest.requireActual('react-native-paper');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { lightTheme } = require('@/src/presentation/theme/appTheme');
  return {
    ...actual,
    useTheme: jest.fn(() => lightTheme),
  };
});

jest.mock('react-native-markdown-renderer', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    __esModule: true,
    default: jest.fn(
      ({ children, style }: { children: React.ReactNode; style?: Record<string, unknown> }) => {
        mockCapturedMarkdownStyle = style;
        return React.createElement(RN.Text, null, children);
      },
    ),
  };
});

import { useTheme } from 'react-native-paper';

/**
 * Test suite for the JournalEntryCard component. Covers rendering, markdown content,
 * long content truncation, location display, tags display, modified indicator, and
 * theme-aware colors.
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockCapturedMarkdownStyle = undefined;
    (useTheme as jest.Mock).mockReturnValue(lightTheme);
    (Markdown as jest.Mock).mockImplementation(
      ({ children, style }: { children: React.ReactNode; style?: Record<string, unknown> }) => {
        mockCapturedMarkdownStyle = style;
        return <RNText>{children}</RNText>;
      },
    );
  });

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

  // ---------------------------------------------------------------------------
  // Theme-aware colors
  // ---------------------------------------------------------------------------

  describe('theme colors', () => {
    /** Tests that markdown colors use the light Paper theme. */
    it('uses light theme colors for markdown styles', () => {
      render(<JournalEntryCard entry={sampleEntry} />);

      expect(mockCapturedMarkdownStyle).toBeDefined();
      expect(
        (mockCapturedMarkdownStyle?.blockquote as Record<string, string>)?.borderLeftColor,
      ).toBe(lightTheme.colors.outline);
      expect((mockCapturedMarkdownStyle?.code as Record<string, string>)?.backgroundColor).toBe(
        lightTheme.colors.surfaceVariant,
      );
      expect((mockCapturedMarkdownStyle?.link as Record<string, string>)?.color).toBe(
        lightTheme.colors.primary,
      );
      // The base text color must be set so the markdown renderer's internal
      // <Text> elements stay readable in dark mode.
      expect((mockCapturedMarkdownStyle?.text as Record<string, string>)?.color).toBe(
        lightTheme.colors.onSurface,
      );
    });

    /** Tests that markdown colors use the dark Paper theme. */
    it('uses dark theme colors for markdown styles', () => {
      (useTheme as jest.Mock).mockReturnValue(darkTheme);
      render(<JournalEntryCard entry={sampleEntry} />);

      expect(mockCapturedMarkdownStyle).toBeDefined();
      expect(
        (mockCapturedMarkdownStyle?.blockquote as Record<string, string>)?.borderLeftColor,
      ).toBe(darkTheme.colors.outline);
      expect((mockCapturedMarkdownStyle?.code as Record<string, string>)?.backgroundColor).toBe(
        darkTheme.colors.surfaceVariant,
      );
      expect((mockCapturedMarkdownStyle?.link as Record<string, string>)?.color).toBe(
        darkTheme.colors.primary,
      );
      expect((mockCapturedMarkdownStyle?.text as Record<string, string>)?.color).toBe(
        darkTheme.colors.onSurface,
      );
    });

    /** Tests that location text uses a lower-emphasis theme color. */
    it('uses onSurfaceVariant for location text', () => {
      const entryWithLocation: JournalEntry = {
        ...sampleEntry,
        location: {
          latitude: 40.7128,
          longitude: -74.006,
          elevation: 10,
          address: 'New York, NY',
        },
      };
      const { getByText, UNSAFE_root } = render(<JournalEntryCard entry={entryWithLocation} />);
      expect(getByText(/New York, NY/)).toBeTruthy();

      const textNodes = UNSAFE_root.findAllByType(PaperText);
      const locationNode = textNodes.find(node =>
        String(node.props.children).includes('New York, NY'),
      );
      const flatStyle = Array.isArray(locationNode?.props.style)
        ? Object.assign({}, ...locationNode.props.style.filter(Boolean))
        : locationNode?.props.style;
      expect(flatStyle?.color).toBe(lightTheme.colors.onSurfaceVariant);
    });

    /** Tests that modified text uses a lower-emphasis theme color. */
    it('uses onSurfaceVariant for modified text', () => {
      const modifiedEntry: JournalEntry = {
        ...sampleEntry,
        created_at: new Date('2024-01-01T00:00:00Z'),
        modified_at: new Date('2024-01-02T00:00:00Z'),
      };
      const { getByText, UNSAFE_root } = render(<JournalEntryCard entry={modifiedEntry} />);
      expect(getByText(/Modified:/)).toBeTruthy();

      const textNodes = UNSAFE_root.findAllByType(PaperText);
      const modifiedNode = textNodes.find(node =>
        String(node.props.children).includes('Modified:'),
      );
      const flatStyle = Array.isArray(modifiedNode?.props.style)
        ? Object.assign({}, ...modifiedNode.props.style.filter(Boolean))
        : modifiedNode?.props.style;
      expect(flatStyle?.color).toBe(lightTheme.colors.onSurfaceVariant);
    });
  });
});
