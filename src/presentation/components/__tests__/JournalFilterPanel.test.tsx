import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { JournalFilterPanel, resolvePickerDate } from '../JournalFilterPanel';
import type { JournalFilterDraft } from '@/src/presentation/viewmodels/JournalViewModel';

/**
 * Mock react-native-paper-dates to avoid the transitive `color` ESM dependency that
 * Jest cannot transform.
 */
jest.mock('react-native-paper-dates', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View, Pressable, Text } = require('react-native');

  return {
    en: {},
    registerTranslation: jest.fn(),
    DatePickerModal: ({
      visible,
      onDismiss,
      onConfirm,
      testID,
    }: {
      visible: boolean;
      onDismiss: () => void;
      onConfirm: (params: { date?: Date }) => void;
      testID?: string;
    }) => {
      if (!visible) return null;
      return React.createElement(
        View,
        { testID },
        React.createElement(
          Pressable,
          {
            testID: 'date-picker-save',
            // Use a date with non-zero hours/minutes to verify the panel
            // normalises to start/end-of-day rather than passing values
            // through unchanged.
            onPress: () => onConfirm({ date: new Date(2026, 5, 17, 13, 37, 45, 250) }),
          },
          React.createElement(Text, null, 'Save'),
        ),
        React.createElement(
          Pressable,
          {
            testID: 'date-picker-save-undefined',
            onPress: () => onConfirm({ date: undefined }),
          },
          React.createElement(Text, null, 'Save undefined'),
        ),
        React.createElement(
          Pressable,
          {
            testID: 'date-picker-dismiss',
            onPress: onDismiss,
          },
          React.createElement(Text, null, 'Cancel'),
        ),
      );
    },
    TimePickerModal: () => null,
  };
});

jest.mock('react-native-paper', () => {
  const actual = jest.requireActual('react-native-paper');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { lightTheme } = require('@/src/presentation/theme/appTheme');
  return {
    ...actual,
    useTheme: jest.fn(() => lightTheme),
  };
});

/** Default draft for tests. */
const DEFAULT_DRAFT: JournalFilterDraft = { phrase: '' };

/**
 * Test suite for the JournalFilterPanel component. Covers rendering, date picker
 * triggers, clear buttons, phrase input, and OK/clear actions.
 */
describe('JournalFilterPanel', () => {
  /** Default props for tests. */
  const defaultProps = {
    draft: { ...DEFAULT_DRAFT },
    onUpdateDraft: jest.fn(),
    onClear: jest.fn(),
    onApply: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** Tests that the panel renders without crashing. */
  it('renders without crashing', () => {
    const { toJSON } = render(<JournalFilterPanel {...defaultProps} />);
    expect(toJSON()).toBeTruthy();
  });

  /** Tests that the panel renders all expected controls. */
  it('renders the start-date, end-date, phrase, clear, and OK controls', () => {
    const { getByTestId } = render(<JournalFilterPanel {...defaultProps} />);

    expect(getByTestId('filter-start-date-button')).toBeTruthy();
    expect(getByTestId('filter-end-date-button')).toBeTruthy();
    expect(getByTestId('filter-phrase-input')).toBeTruthy();
    expect(getByTestId('filter-clear-button')).toBeTruthy();
    expect(getByTestId('filter-ok-button')).toBeTruthy();
  });

  /** Tests that pressing the OK button calls onApply. */
  it('calls onApply when the OK button is pressed', () => {
    const onApply = jest.fn();
    const { getByTestId } = render(<JournalFilterPanel {...defaultProps} onApply={onApply} />);
    fireEvent.press(getByTestId('filter-ok-button'));
    expect(onApply).toHaveBeenCalled();
  });

  /** Tests that pressing the clear button calls onClear. */
  it('calls onClear when the clear button is pressed', () => {
    const onClear = jest.fn();
    const { getByTestId } = render(<JournalFilterPanel {...defaultProps} onClear={onClear} />);
    fireEvent.press(getByTestId('filter-clear-button'));
    expect(onClear).toHaveBeenCalled();
  });

  /** Tests that typing into the phrase input calls onUpdateDraft. */
  it('calls onUpdateDraft with the phrase when the input changes', () => {
    const onUpdateDraft = jest.fn();
    const { getByTestId } = render(
      <JournalFilterPanel {...defaultProps} onUpdateDraft={onUpdateDraft} />,
    );
    fireEvent.changeText(getByTestId('filter-phrase-input'), 'search term');
    expect(onUpdateDraft).toHaveBeenCalledWith({ phrase: 'search term' });
  });

  /** Tests that pressing the start-date button opens the date picker modal. */
  it('opens the date picker modal when the start-date button is pressed', () => {
    const { getByTestId, queryByTestId } = render(<JournalFilterPanel {...defaultProps} />);

    expect(queryByTestId('filter-date-picker-modal')).toBeNull();
    fireEvent.press(getByTestId('filter-start-date-button'));
    expect(getByTestId('filter-date-picker-modal')).toBeTruthy();
  });

  /** Tests that pressing the end-date button opens the date picker modal. */
  it('opens the date picker modal when the end-date button is pressed', () => {
    const { getByTestId, queryByTestId } = render(<JournalFilterPanel {...defaultProps} />);

    expect(queryByTestId('filter-date-picker-modal')).toBeNull();
    fireEvent.press(getByTestId('filter-end-date-button'));
    expect(getByTestId('filter-date-picker-modal')).toBeTruthy();
  });

  /**
   * Tests that confirming a date in the start-date picker calls onUpdateDraft with a
   * start-of-day normalised date.
   */
  it('calls onUpdateDraft with a start-of-day date when the start picker confirms', () => {
    const onUpdateDraft = jest.fn();
    const { getByTestId } = render(
      <JournalFilterPanel {...defaultProps} onUpdateDraft={onUpdateDraft} />,
    );
    fireEvent.press(getByTestId('filter-start-date-button'));
    fireEvent.press(getByTestId('date-picker-save'));

    expect(onUpdateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: expect.any(Date),
      }),
    );
    const arg = onUpdateDraft.mock.calls[0][0] as { startDate: Date };
    expect(arg.startDate.getHours()).toBe(0);
    expect(arg.startDate.getMinutes()).toBe(0);
    expect(arg.startDate.getSeconds()).toBe(0);
    expect(arg.startDate.getMilliseconds()).toBe(0);
  });

  /**
   * Tests that confirming a date in the end-date picker calls onUpdateDraft with an
   * end-of-day normalised date.
   */
  it('calls onUpdateDraft with an end-of-day date when the end picker confirms', () => {
    const onUpdateDraft = jest.fn();
    const { getByTestId } = render(
      <JournalFilterPanel {...defaultProps} onUpdateDraft={onUpdateDraft} />,
    );
    fireEvent.press(getByTestId('filter-end-date-button'));
    fireEvent.press(getByTestId('date-picker-save'));

    expect(onUpdateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        endDate: expect.any(Date),
      }),
    );
    const arg = onUpdateDraft.mock.calls[0][0] as { endDate: Date };
    expect(arg.endDate.getHours()).toBe(23);
    expect(arg.endDate.getMinutes()).toBe(59);
    expect(arg.endDate.getSeconds()).toBe(59);
    expect(arg.endDate.getMilliseconds()).toBe(999);
  });

  /**
   * Tests that dismissing the date picker without selecting a date does not call
   * onUpdateDraft.
   */
  it('does not call onUpdateDraft when the date picker is dismissed', () => {
    const onUpdateDraft = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <JournalFilterPanel {...defaultProps} onUpdateDraft={onUpdateDraft} />,
    );
    fireEvent.press(getByTestId('filter-start-date-button'));
    fireEvent.press(getByTestId('date-picker-dismiss'));

    expect(queryByTestId('filter-date-picker-modal')).toBeNull();
    expect(onUpdateDraft).not.toHaveBeenCalled();
  });

  /**
   * Tests that confirming a date with undefined (dismiss mid-selection) does not call
   * onUpdateDraft.
   */
  it('does not call onUpdateDraft when the date picker confirms with undefined', () => {
    const onUpdateDraft = jest.fn();
    const { getByTestId } = render(
      <JournalFilterPanel {...defaultProps} onUpdateDraft={onUpdateDraft} />,
    );
    fireEvent.press(getByTestId('filter-start-date-button'));
    fireEvent.press(getByTestId('date-picker-save-undefined'));

    expect(onUpdateDraft).not.toHaveBeenCalled();
  });

  /** Tests that the start-date clear button calls onUpdateDraft with undefined. */
  it('clears the start date via the start-date clear button', () => {
    const onUpdateDraft = jest.fn();
    const draft: JournalFilterDraft = {
      phrase: '',
      startDate: new Date('2024-01-01T00:00:00.000Z'),
    };
    const { getByTestId } = render(
      <JournalFilterPanel {...defaultProps} draft={draft} onUpdateDraft={onUpdateDraft} />,
    );
    fireEvent.press(getByTestId('filter-start-date-clear'));
    expect(onUpdateDraft).toHaveBeenCalledWith({ startDate: undefined });
  });

  /** Tests that the end-date clear button calls onUpdateDraft with undefined. */
  it('clears the end date via the end-date clear button', () => {
    const onUpdateDraft = jest.fn();
    const draft: JournalFilterDraft = {
      phrase: '',
      endDate: new Date('2024-03-20T00:00:00.000Z'),
    };
    const { getByTestId } = render(
      <JournalFilterPanel {...defaultProps} draft={draft} onUpdateDraft={onUpdateDraft} />,
    );
    fireEvent.press(getByTestId('filter-end-date-clear'));
    expect(onUpdateDraft).toHaveBeenCalledWith({ endDate: undefined });
  });

  /** Tests that the start-date clear button is not rendered when no start date set. */
  it('does not render the start-date clear button when no start date is set', () => {
    const { queryByTestId } = render(<JournalFilterPanel {...defaultProps} />);
    expect(queryByTestId('filter-start-date-clear')).toBeNull();
  });

  /** Tests that the end-date clear button is not rendered when no end date is set. */
  it('does not render the end-date clear button when no end date is set', () => {
    const { queryByTestId } = render(<JournalFilterPanel {...defaultProps} />);
    expect(queryByTestId('filter-end-date-clear')).toBeNull();
  });

  /** Tests that the start-date button shows placeholder text when no date is set. */
  it('shows placeholder text for the start-date button when unset', () => {
    const { getByText } = render(<JournalFilterPanel {...defaultProps} />);
    expect(getByText('Start date')).toBeTruthy();
  });

  /** Tests that the end-date button shows placeholder text when no date is set. */
  it('shows placeholder text for the end-date button when unset', () => {
    const { getByText } = render(<JournalFilterPanel {...defaultProps} />);
    expect(getByText('End date')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // resolvePickerDate (unset-default logic)
  // -------------------------------------------------------------------------

  /**
   * Tests that resolvePickerDate returns the start date when it is set for the start
   * picker.
   */
  it('resolvePickerDate returns the start date when set for the start picker', () => {
    const startDate = new Date('2024-01-01T00:00:00.000Z');
    expect(resolvePickerDate('start', { phrase: '', startDate })).toEqual(startDate);
  });

  /**
   * Tests that resolvePickerDate returns the end date when it is set for the end
   * picker.
   */
  it('resolvePickerDate returns the end date when set for the end picker', () => {
    const endDate = new Date('2024-12-31T23:59:59.999Z');
    expect(resolvePickerDate('end', { phrase: '', endDate })).toEqual(endDate);
  });

  /**
   * Tests that resolvePickerDate defaults the start picker to the end date when the
   * start date is unset but the end date is set.
   */
  it('resolvePickerDate defaults the start picker to the end date when start is unset', () => {
    const endDate = new Date('2024-12-31T23:59:59.999Z');
    expect(resolvePickerDate('start', { phrase: '', endDate })).toEqual(endDate);
  });

  /**
   * Tests that resolvePickerDate defaults the end picker to the start date when the end
   * date is unset but the start date is set.
   */
  it('resolvePickerDate defaults the end picker to the start date when end is unset', () => {
    const startDate = new Date('2024-01-01T00:00:00.000Z');
    expect(resolvePickerDate('end', { phrase: '', startDate })).toEqual(startDate);
  });

  /**
   * Tests that resolvePickerDate defaults to today when neither date is set for the
   * start picker.
   */
  it('resolvePickerDate defaults to today for the start picker when both unset', () => {
    const before = new Date();
    const result = resolvePickerDate('start', { phrase: '' });
    const after = new Date();
    expect(result.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  /**
   * Tests that resolvePickerDate defaults to today when neither date is set for the end
   * picker.
   */
  it('resolvePickerDate defaults to today for the end picker when both unset', () => {
    const before = new Date();
    const result = resolvePickerDate('end', { phrase: '' });
    const after = new Date();
    expect(result.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
