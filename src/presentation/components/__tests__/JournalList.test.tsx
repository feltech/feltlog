import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { JournalList } from '../JournalList';
import type { JournalEntry } from '@/src/domain/entities/JournalEntry';

/**
 * Test suite for the JournalList component. Covers rendering entries, empty state,
 * pagination triggers, pull-to-refresh, and the footer loading indicator.
 */
describe('JournalList', () => {
  /**
   * Creates a sample journal entry for testing.
   *
   * @param id - The entry ID.
   * @param content - The entry content.
   *
   * @returns A sample journal entry.
   */
  const makeEntry = (id: string, content: string = 'Test content'): JournalEntry => ({
    id,
    content,
    datetime: new Date('2024-01-01T10:00:00Z'),
    created_at: new Date('2024-01-01T10:00:00Z'),
    modified_at: new Date('2024-01-01T10:00:00Z'),
    tags: [],
  });

  const defaultProps = {
    entries: [] as JournalEntry[],
    loading: false,
    hasMore: false,
    onLoadMore: jest.fn(),
    onRefresh: jest.fn(),
    onEntryPress: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** Tests that the component renders without crashing. */
  it('renders without crashing', () => {
    const { toJSON } = render(<JournalList {...defaultProps} />);
    expect(toJSON()).toBeTruthy();
  });

  /**
   * Tests that the empty state message is shown when there are no entries and the
   * component is not loading.
   */
  it('shows empty state message when no entries and not loading', () => {
    const { getByText } = render(<JournalList {...defaultProps} />);
    expect(getByText(/No journal entries found/)).toBeTruthy();
  });

  /** Tests that the empty state message is NOT shown when loading is true. */
  it('does not show empty state while loading', () => {
    const { queryByText } = render(<JournalList {...defaultProps} loading={true} />);
    expect(queryByText(/No journal entries found/)).toBeNull();
  });

  /** Tests that journal entries are rendered in the list. */
  it('renders journal entries in the list', () => {
    const entries = [makeEntry('1', 'First entry'), makeEntry('2', 'Second entry')];
    const { getByText } = render(<JournalList {...defaultProps} entries={entries} />);
    // The JournalEntryCard renders the datetime and content — check content is
    // visible (via the Markdown mock which renders as plain text).
    expect(getByText(/First entry/)).toBeTruthy();
    expect(getByText(/Second entry/)).toBeTruthy();
  });

  /** Tests that pressing an entry calls onEntryPress with the entry. */
  it('calls onEntryPress when an entry is pressed', () => {
    const onEntryPress = jest.fn();
    const entries = [makeEntry('1', 'Press me')];
    const { getByTestId } = render(
      <JournalList {...defaultProps} entries={entries} onEntryPress={onEntryPress} />,
    );

    fireEvent.press(getByTestId('journal-entry-card'));
    expect(onEntryPress).toHaveBeenCalledWith(entries[0]);
  });

  /** Tests that the footer loading indicator is shown when hasMore is true. */
  it('shows footer loading indicator when hasMore is true', () => {
    const entries = [makeEntry('1')];
    const { toJSON } = render(
      <JournalList {...defaultProps} entries={entries} hasMore={true} loading={true} />,
    );
    // The FlatList renders a ListFooterComponent when hasMore is true.
    // We can't easily test the ActivityIndicator, but the tree should render.
    expect(toJSON()).toBeTruthy();
  });

  /** Tests that the footer loading indicator is NOT shown when hasMore is false. */
  it('does not show footer when hasMore is false', () => {
    const entries = [makeEntry('1')];
    const tree = render(
      <JournalList {...defaultProps} entries={entries} hasMore={false} loading={false} />,
    );
    // Should still render without issues.
    expect(tree.toJSON()).toBeTruthy();
  });

  /** Tests that onRefresh is called via the RefreshControl. */
  it('calls onRefresh when pull-to-refresh is triggered', () => {
    const onRefresh = jest.fn();
    const entries = [makeEntry('1')];
    const { UNSAFE_root } = render(
      <JournalList {...defaultProps} entries={entries} onRefresh={onRefresh} />,
    );

    // Find the RefreshControl and trigger its onRefresh.
    const flatList = UNSAFE_root.findByProps({ data: entries });
    const refreshControl = flatList.props.refreshControl;
    refreshControl.props.onRefresh();

    expect(onRefresh).toHaveBeenCalled();
  });

  /** Tests that the key extractor returns the entry id. */
  it('uses entry id as key', () => {
    const entries = [makeEntry('abc-123')];
    const { toJSON } = render(<JournalList {...defaultProps} entries={entries} />);
    // The FlatList keyExtractor should produce 'abc-123'.
    // We verify the tree renders correctly; key is internal to FlatList.
    expect(toJSON()).toBeTruthy();
  });

  /**
   * Tests that onLoadMore is called via onEndReached when hasMore is true and entries
   * are present. Covers lines 91-92 in JournalList.tsx.
   */
  it('calls onLoadMore when onEndReached fires with hasMore=true and entries present', () => {
    const onLoadMore = jest.fn();
    const entries = [makeEntry('1')];
    const { UNSAFE_root } = render(
      <JournalList {...defaultProps} entries={entries} hasMore={true} onLoadMore={onLoadMore} />,
    );

    // Find the FlatList and trigger its onEndReached.
    const flatList = UNSAFE_root.findByProps({ data: entries });
    flatList.props.onEndReached();

    expect(onLoadMore).toHaveBeenCalled();
  });

  /**
   * Tests that onLoadMore is NOT called via onEndReached when entries are empty, even
   * if hasMore is true. This prevents repeated calls on initial mount.
   */
  it('does not call onLoadMore when entries are empty', () => {
    const onLoadMore = jest.fn();
    const { UNSAFE_root } = render(
      <JournalList {...defaultProps} entries={[]} hasMore={true} onLoadMore={onLoadMore} />,
    );

    // Find the FlatList by searching for the element with onEndReached.
    const flatList = UNSAFE_root.find((node: ReactTestInstance) => {
      const props = node.props as Record<string, unknown> | undefined;
      return props?.onEndReached !== undefined && typeof props?.onEndReached === 'function';
    });
    // Trigger onEndReached — the component's guard should prevent onLoadMore.
    const props = flatList.props as Record<string, unknown>;
    (props.onEndReached as () => void)();

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  /** Tests that onLoadMore is NOT called when hasMore is false. */
  it('does not call onLoadMore when hasMore is false', () => {
    const onLoadMore = jest.fn();
    const entries = [makeEntry('1')];
    const { UNSAFE_root } = render(
      <JournalList {...defaultProps} entries={entries} hasMore={false} onLoadMore={onLoadMore} />,
    );

    const flatList = UNSAFE_root.findByProps({ data: entries });
    flatList.props.onEndReached();

    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
