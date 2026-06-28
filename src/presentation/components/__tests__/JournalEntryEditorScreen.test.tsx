import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Chip, PaperProvider } from 'react-native-paper';
import * as ExpoLocation from 'expo-location';

const GEOCODE_DEBOUNCE_MS = 600;
const POSITION_TIMEOUT_MS = 15000;
const BALANCED_TIMEOUT_MS = 5000;
const CONTENT_UNDO_COALESCE_MS = 500;
const MAP_INTERACTION_LOCK_MS = 300;
const AUTOSAVE_DELAY_MS = 500;

type TestInstance = { props: Record<string, unknown> };

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({})),
  useNavigation: jest.fn(() => mockNavigation),
}));

let beforeRemoveHandler:
  | ((e: { preventDefault: () => void; data: { action: unknown } }) => void)
  | null = null;
const mockDispatch = jest.fn();
const mockGoBack = jest.fn();
const mockNavigation = {
  dispatch: mockDispatch,
  goBack: mockGoBack,
  addListener: jest.fn((event: string, handler: (e: never) => void) => {
    if (event === 'beforeRemove') {
      beforeRemoveHandler = handler as typeof beforeRemoveHandler;
    }
    return jest.fn();
  }),
};

jest.mock('@/src/presentation/viewmodels/JournalViewModel', () => ({
  useJournalViewModel: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    ...jest.requireActual('react-native-safe-area-context'),
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SafeAreaConsumer: jest.fn(),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

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
            onPress: () => onConfirm({ date: new Date(2026, 5, 17) }),
          },
          React.createElement(Text, null, 'Save'),
        ),
        React.createElement(
          Pressable,
          {
            testID: 'date-picker-save-undefined',
            onPress: () => onConfirm({ date: undefined }),
          },
          React.createElement(Text, null, 'Save Undefined'),
        ),
        React.createElement(
          Pressable,
          { testID: 'date-picker-dismiss', onPress: onDismiss },
          React.createElement(Text, null, 'Dismiss'),
        ),
      );
    },
    TimePickerModal: ({
      visible,
      onDismiss,
      onConfirm,
      testID,
    }: {
      visible: boolean;
      onDismiss: () => void;
      onConfirm: (params: { hours?: number; minutes?: number }) => void;
      testID?: string;
    }) => {
      if (!visible) return null;
      return React.createElement(
        View,
        { testID },
        React.createElement(
          Pressable,
          {
            testID: 'time-picker-save',
            onPress: () => onConfirm({ hours: 8, minutes: 30 }),
          },
          React.createElement(Text, null, 'Save'),
        ),
        React.createElement(
          Pressable,
          {
            testID: 'time-picker-save-undefined',
            onPress: () => onConfirm({}),
          },
          React.createElement(Text, null, 'Save Undefined'),
        ),
        React.createElement(
          Pressable,
          { testID: 'time-picker-dismiss', onPress: onDismiss },
          React.createElement(Text, null, 'Dismiss'),
        ),
      );
    },
  };
});

import { useJournalViewModel } from '@/src/presentation/viewmodels/JournalViewModel';
import { useLocalSearchParams } from 'expo-router';
import type { MD3Theme } from 'react-native-paper';
import type { JournalEntry } from '@/src/domain/entities/JournalEntry';
import JournalEntryEditorScreen, { formatAddress } from '../JournalEntryEditorScreen';

const MICROTASK_FLUSH_COUNT = 20;

const DEFAULT_STATE = {
  entries: [] as JournalEntry[],
  tags: [] as { id: string; name: string; created_at: string }[],
  loading: false,
  error: null as string | null,
  searchQuery: '',
  selectedTags: [] as string[],
  hasMore: false,
};

/**
 * Returns a fresh set of mock ViewModel actions.
 *
 * Every action is a Jest mock that resolves so Promise-based callers don't throw.
 *
 * @returns A record of mock functions keyed by action name.
 */
function stubActions(): Record<string, jest.Mock> {
  return {
    refreshData: jest.fn(),
    loadMoreEntries: jest.fn(),
    createEntry: jest.fn().mockResolvedValue({
      id: 'stub-id',
      content: '',
      datetime: new Date(),
      created_at: new Date(),
      modified_at: new Date(),
      tags: [] as string[],
    }),
    updateEntry: jest.fn().mockResolvedValue({
      id: 'stub-id',
      content: '',
      datetime: new Date(),
      created_at: new Date(),
      modified_at: new Date(),
      tags: [] as string[],
    }),
    deleteEntry: jest.fn(),
    search: jest.fn(),
    filterByTags: jest.fn(),
    clearFilters: jest.fn(),
    setError: jest.fn(),
    getEntryById: jest.fn().mockResolvedValue(null),
    loadDefaultTags: jest.fn().mockResolvedValue([]),
  };
}

/**
 * Flushes pending microtasks inside act() so async state updates settle.
 *
 * @returns Promise that resolves once the microtask queue has been drained.
 */
async function flushEffects(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < MICROTASK_FLUSH_COUNT; i++) {
      await Promise.resolve();
    }
  });
}

/**
 * Renders the editor screen with providers and configurable route params.
 *
 * @param entryId - Optional entry ID to simulate edit mode.
 * @param theme - Optional Paper theme to wrap the component with.
 *
 * @returns The render result from testing-library.
 */
async function renderScreen(
  entryId?: string,
  theme?: MD3Theme,
): Promise<ReturnType<typeof render>> {
  (useLocalSearchParams as jest.Mock).mockReturnValue(entryId ? { entryId } : {});
  if (entryId) {
    const vmReturn = (useJournalViewModel as jest.Mock)();
    const entries = vmReturn?.state?.entries ?? [];
    const match = entries.find((e: { id: string }) => e.id === entryId);
    if (match && vmReturn?.actions?.getEntryById) {
      vmReturn.actions.getEntryById.mockResolvedValue(match);
    }
  }
  const result = render(
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <JournalEntryEditorScreen />
      </PaperProvider>
    </SafeAreaProvider>,
  );
  await flushEffects();
  return result;
}

/**
 * Waits for the map to appear after the initial location fetch settles.
 *
 * @param result - The render result returned by renderScreen.
 *
 * @returns Promise that resolves once the map testID is found.
 */
async function waitForMap(result: ReturnType<typeof render>): Promise<void> {
  await waitFor(() => {
    expect(result.queryByTestId('entry-location-map')).toBeTruthy();
  });
}

describe('JournalEntryEditorScreen', () => {
  jest.setTimeout(30000);
  let actions: Record<string, jest.Mock>;

  beforeEach(() => {
    jest.clearAllMocks();
    beforeRemoveHandler = null;

    (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'granted',
      granted: true,
      canAskAgain: true,
    });
    (ExpoLocation.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'granted',
    });
    (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 0, longitude: 0, altitude: 0, accuracy: 5 },
    });
    (ExpoLocation.reverseGeocodeAsync as jest.Mock).mockImplementation(async () => []);
    (ExpoLocation.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(null);

    (useLocalSearchParams as jest.Mock).mockReturnValue({});

    actions = stubActions();
    (useJournalViewModel as jest.Mock).mockReturnValue({
      state: { ...DEFAULT_STATE },
      actions,
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('formatAddress', () => {
    it('returns a comma-separated address when fields are present', () => {
      const address = formatAddress({
        name: 'Name',
        street: '123 Main St',
        city: 'City',
        region: 'Region',
        postalCode: '12345',
        country: 'Country',
        isoCountryCode: 'US',
        district: null,
        subregion: null,
        timezone: null,
      } as ExpoLocation.LocationGeocodedAddress);
      expect(address).toBe('Name, 123 Main St, City, Region, 12345, Country');
    });

    it('returns undefined when all fields are empty', () => {
      const address = formatAddress({
        name: '',
        street: '',
        city: '',
        region: '',
        postalCode: '',
        country: '',
      } as ExpoLocation.LocationGeocodedAddress);
      expect(address).toBeUndefined();
    });
  });

  describe('create mode', () => {
    it('renders New Entry title and basic inputs', async () => {
      const result = await renderScreen();
      expect(result.getByText('New Entry')).toBeTruthy();
      expect(result.getByTestId('entry-content-input')).toBeTruthy();
      expect(result.getByTestId('tag-input')).toBeTruthy();
      expect(result.getByTestId('add-tag-icon')).toBeTruthy();
    });

    it('renders the map once location is fetched', async () => {
      const result = await renderScreen();
      await waitForMap(result);
      const map = result.getByTestId('entry-location-map');
      expect(map.props.dragPan).toBe(true);
      expect(map.props.touchZoom).toBe(true);
    });

    it('shows an error when the initial location fetch fails', async () => {
      (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockRejectedValue(new Error('no fix'));
      (ExpoLocation.getLastKnownPositionAsync as jest.Mock).mockRejectedValue(
        new Error('no last known'),
      );

      const result = await renderScreen();
      await waitFor(() => {
        expect(result.getByTestId('location-error-text')).toBeTruthy();
      });
    });
    it('shows a hint when location permission is denied', async () => {
      (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
        granted: false,
        canAskAgain: false,
      });

      const result = await renderScreen();
      await waitFor(() => {
        expect(
          result.getByText(
            'Location permission not granted. You can still save the entry without a location.',
          ),
        ).toBeTruthy();
      });
    });

    it('shows a hint when the permission request is denied', async () => {
      (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'undetermined',
        granted: false,
        canAskAgain: true,
      });
      (ExpoLocation.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
        granted: false,
      });

      const result = await renderScreen();
      await waitFor(() => {
        expect(
          result.getByText(
            'Location permission not granted. You can still save the entry without a location.',
          ),
        ).toBeTruthy();
      });
    });

    it('updates content when typing', async () => {
      const result = await renderScreen();
      const input = result.getByTestId('entry-content-input');
      await act(async () => {
        fireEvent.changeText(input, 'Hello world');
      });
      expect(input.props.value).toBe('Hello world');
    });

    it('adds a tag via the plus icon', async () => {
      const result = await renderScreen();
      const tagInput = result.getByTestId('tag-input');
      await act(async () => {
        fireEvent.changeText(tagInput, 'mood');
      });
      const addIcon = result.getByTestId('add-tag-icon');
      await act(async () => {
        fireEvent.press(addIcon);
      });
      expect(result.getByText('mood')).toBeTruthy();
    });

    it('removes a tag by firing its Chip onClose event', async () => {
      const result = await renderScreen();
      const tagInput = result.getByTestId('tag-input');
      await act(async () => {
        fireEvent.changeText(tagInput, 'mood');
      });
      const addIcon = result.getByTestId('add-tag-icon');
      await act(async () => {
        fireEvent.press(addIcon);
      });
      expect(result.getByText('mood')).toBeTruthy();

      const chips = result.UNSAFE_getAllByType(Chip);
      const tagChip = chips.find(chip => chip.props.children === 'mood');
      expect(tagChip).toBeTruthy();

      await act(async () => {
        fireEvent(tagChip!, 'onClose');
      });
      expect(result.queryByText('mood')).toBeNull();
    });

    it('does not add duplicate tags and leaves input intact', async () => {
      const result = await renderScreen();
      const tagInput = result.getByTestId('tag-input');
      await act(async () => {
        fireEvent.changeText(tagInput, 'mood');
      });
      const addIcon = result.getByTestId('add-tag-icon');
      await act(async () => {
        fireEvent.press(addIcon);
      });
      await act(async () => {
        fireEvent.changeText(tagInput, 'mood');
      });
      await act(async () => {
        fireEvent.press(addIcon);
      });
      const chips = result.queryAllByText('mood');
      expect(chips.length).toBe(1);
      expect(tagInput.props.value).toBe('mood');
    });

    it('shows autocomplete suggestions and adds a tag from them', async () => {
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          tags: [{ id: '1', name: 'mood', created_at: new Date().toISOString() }],
        },
        actions,
      });
      const result = await renderScreen();
      const tagInput = result.getByTestId('tag-input');
      await act(async () => {
        fireEvent.changeText(tagInput, 'mo');
      });
      await waitFor(() => {
        expect(result.queryByTestId('tag-suggestions')).toBeTruthy();
      });
      const suggestion = result.getByTestId('tag-suggestion-mood');
      await act(async () => {
        fireEvent.press(suggestion);
      });
      expect(result.getByText('mood')).toBeTruthy();
      expect(tagInput.props.value).toBe('');
    });

    it('loads default tags on mount', async () => {
      actions.loadDefaultTags.mockResolvedValue(['journal', 'morning']);
      const result = await renderScreen();
      await waitFor(() => {
        expect(result.queryByText('journal')).toBeTruthy();
      });
      expect(result.getByText('morning')).toBeTruthy();
    });

    it('opens the date picker and updates the date', async () => {
      const result = await renderScreen();
      const dateButton = result.getByTestId('entry-date-button');
      await act(async () => {
        fireEvent.press(dateButton);
      });
      expect(result.getByTestId('date-picker-modal')).toBeTruthy();
      const saveButton = result.getByTestId('date-picker-save');
      await act(async () => {
        fireEvent.press(saveButton);
      });
      const dateText = result.getByTestId('entry-date-text');
      expect(dateText.children[0]).toMatch(/17/);
      expect(dateText.children[0]).toMatch(/2026/);
    });

    it('opens the time picker and updates the time', async () => {
      const result = await renderScreen();
      const timeButton = result.getByTestId('entry-time-button');
      await act(async () => {
        fireEvent.press(timeButton);
      });
      expect(result.getByTestId('time-picker-modal')).toBeTruthy();
      const saveButton = result.getByTestId('time-picker-save');
      await act(async () => {
        fireEvent.press(saveButton);
      });
      const timeText = result.getByTestId('entry-time-text');
      expect(timeText.children[0]).toMatch('08:30');
    });

    it('dismisses the date picker without changing the date', async () => {
      const result = await renderScreen();
      const dateButton = result.getByTestId('entry-date-button');
      await act(async () => {
        fireEvent.press(dateButton);
      });
      expect(result.getByTestId('date-picker-modal')).toBeTruthy();

      const dismissButton = result.getByTestId('date-picker-dismiss');
      await act(async () => {
        fireEvent.press(dismissButton);
      });
      expect(result.queryByTestId('date-picker-modal')).toBeNull();
    });

    it('dismisses the time picker without changing the time', async () => {
      const result = await renderScreen();
      const timeButton = result.getByTestId('entry-time-button');
      await act(async () => {
        fireEvent.press(timeButton);
      });
      expect(result.getByTestId('time-picker-modal')).toBeTruthy();

      const dismissButton = result.getByTestId('time-picker-dismiss');
      await act(async () => {
        fireEvent.press(dismissButton);
      });
      expect(result.queryByTestId('time-picker-modal')).toBeNull();
    });

    it('is a no-op when the date picker confirms without a date', async () => {
      const result = await renderScreen();
      const dateButton = result.getByTestId('entry-date-button');
      await act(async () => {
        fireEvent.press(dateButton);
      });
      expect(result.getByTestId('date-picker-modal')).toBeTruthy();

      const initialDate = result.getByTestId('entry-date-text').children[0];
      const undefinedSaveButton = result.getByTestId('date-picker-save-undefined');
      await act(async () => {
        fireEvent.press(undefinedSaveButton);
      });
      expect(result.queryByTestId('date-picker-modal')).toBeNull();
      expect(result.getByTestId('entry-date-text').children[0]).toEqual(initialDate);
    });

    it('is a no-op when the time picker confirms without a time', async () => {
      const result = await renderScreen();
      const timeButton = result.getByTestId('entry-time-button');
      await act(async () => {
        fireEvent.press(timeButton);
      });
      expect(result.getByTestId('time-picker-modal')).toBeTruthy();

      const initialTime = result.getByTestId('entry-time-text').children[0];
      const undefinedSaveButton = result.getByTestId('time-picker-save-undefined');
      await act(async () => {
        fireEvent.press(undefinedSaveButton);
      });
      expect(result.queryByTestId('time-picker-modal')).toBeNull();
      expect(result.getByTestId('entry-time-text').children[0]).toEqual(initialTime);
    });
  });

  describe('edit mode', () => {
    it('renders Edit Entry title and loads existing content', async () => {
      const entry: JournalEntry = {
        id: 'entry-1',
        content: 'existing content',
        datetime: new Date('2025-01-15T12:00:00Z'),
        created_at: new Date('2025-01-15T12:00:00Z'),
        modified_at: new Date('2025-01-15T12:00:00Z'),
        tags: ['tag1', 'tag2'],
        location: { latitude: 40.7, longitude: -74, elevation: 10 },
      };
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: { ...DEFAULT_STATE, entries: [entry] },
        actions,
      });
      const result = await renderScreen('entry-1');
      expect(result.getByText('Edit Entry')).toBeTruthy();
      const input = result.getByTestId('entry-content-input');
      expect(input.props.value).toBe('existing content');
      expect(result.getByText('tag1')).toBeTruthy();
      expect(result.getByText('tag2')).toBeTruthy();
    });

    it('autosaves edited content after debounce', async () => {
      jest.useFakeTimers();
      const entry: JournalEntry = {
        id: 'entry-1',
        content: 'initial',
        datetime: new Date(),
        created_at: new Date(),
        modified_at: new Date(),
        tags: [],
      };
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: { ...DEFAULT_STATE, entries: [entry] },
        actions,
      });
      const result = await renderScreen('entry-1');
      const input = result.getByTestId('entry-content-input');
      await act(async () => {
        fireEvent.changeText(input, 'updated content');
      });
      await act(async () => {
        jest.advanceTimersByTime(AUTOSAVE_DELAY_MS + 50);
      });
      await waitFor(() => {
        expect(actions.updateEntry).toHaveBeenCalledWith(
          'entry-1',
          expect.objectContaining({ content: 'updated content' }),
        );
      });
      await waitFor(() => {
        expect(result.queryByTestId('saved-indicator')).toBeTruthy();
      });
    });

    it('shows delete button and confirms deletion', async () => {
      const entry: JournalEntry = {
        id: 'entry-1',
        content: 'initial',
        datetime: new Date(),
        created_at: new Date(),
        modified_at: new Date(),
        tags: [],
      };
      actions.deleteEntry.mockResolvedValue(true);
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: { ...DEFAULT_STATE, entries: [entry] },
        actions,
      });
      const result = await renderScreen('entry-1');
      const deleteButton = result.getByTestId('delete-entry-button');
      await act(async () => {
        fireEvent.press(deleteButton);
      });
      expect(result.getByTestId('delete-entry-dialog')).toBeTruthy();
      const confirmButton = result.getByTestId('delete-entry-confirm-button');
      await act(async () => {
        fireEvent.press(confirmButton);
      });
      expect(actions.deleteEntry).toHaveBeenCalledWith('entry-1');
      expect(mockGoBack).toHaveBeenCalled();
    });

    it('cancels deletion when cancel is pressed', async () => {
      const entry: JournalEntry = {
        id: 'entry-1',
        content: 'initial',
        datetime: new Date(),
        created_at: new Date(),
        modified_at: new Date(),
        tags: [],
      };
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: { ...DEFAULT_STATE, entries: [entry] },
        actions,
      });
      const result = await renderScreen('entry-1');
      const deleteButton = result.getByTestId('delete-entry-button');
      await act(async () => {
        fireEvent.press(deleteButton);
      });
      const cancelButton = result.getByTestId('delete-entry-cancel-button');
      await act(async () => {
        fireEvent.press(cancelButton);
      });
      expect(actions.deleteEntry).not.toHaveBeenCalled();
      await waitFor(
        () => {
          expect(result.queryByText('Delete entry?')).toBeNull();
        },
        { timeout: 2000 },
      );
    });

    it('shows error and navigates back when entry is not found', async () => {
      jest.useFakeTimers();
      actions.getEntryById.mockResolvedValue(null);
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: { ...DEFAULT_STATE },
        actions,
      });
      const result = await renderScreen('missing-id');
      await waitFor(() => {
        expect(result.queryByText('Entry not found. It may have been deleted.')).toBeTruthy();
      });
      await act(async () => {
        jest.advanceTimersByTime(150);
      });
      expect(mockGoBack).toHaveBeenCalled();
    });

    it('shows error and navigates back when entry load fails', async () => {
      actions.getEntryById.mockRejectedValue(new Error('DB error'));
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: { ...DEFAULT_STATE },
        actions,
      });
      const result = await renderScreen('entry-1');
      await waitFor(() => {
        expect(result.queryByText('Failed to load entry.')).toBeTruthy();
      });
    });
  });

  describe('location', () => {
    it('shows permission denied message when permission is denied', async () => {
      (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
        granted: false,
        canAskAgain: false,
      });
      const result = await renderScreen();
      await waitFor(() => {
        expect(
          result.queryByText(
            'Location permission not granted. You can still save the entry without a location.',
          ),
        ).toBeTruthy();
      });
    });

    it('shows error when GPS fetch times out and no fallback is available', async () => {
      jest.useFakeTimers();
      (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockRejectedValue(new Error('timeout'));
      (ExpoLocation.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(null);
      const result = await renderScreen();
      await act(async () => {
        jest.advanceTimersByTime(POSITION_TIMEOUT_MS + BALANCED_TIMEOUT_MS + 100);
      });
      await flushEffects();
      await waitFor(() => {
        expect(result.queryByTestId('location-error-text')).toBeTruthy();
      });
    });

    it('falls back to balanced accuracy when high accuracy fails', async () => {
      jest.useFakeTimers();
      (ExpoLocation.getCurrentPositionAsync as jest.Mock)
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce({
          coords: { latitude: 1.23, longitude: 4.56, altitude: 7, accuracy: 10 },
        });
      const result = await renderScreen();
      await act(async () => {
        jest.advanceTimersByTime(POSITION_TIMEOUT_MS + 100);
      });
      await flushEffects();
      await waitForMap(result);
      const coordsText = result.getByTestId('location-coordinates-text');
      expect(coordsText.children.join('')).toContain('1.2300');
    });

    it('falls back to last known position when high and balanced accuracy fail', async () => {
      jest.useFakeTimers();
      (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockRejectedValue(new Error('timeout'));
      (ExpoLocation.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({
        coords: { latitude: 9.87, longitude: 6.54, altitude: 3, accuracy: 15 },
      });
      const result = await renderScreen();
      await act(async () => {
        jest.advanceTimersByTime(POSITION_TIMEOUT_MS + BALANCED_TIMEOUT_MS + 100);
      });
      await flushEffects();
      await waitForMap(result);
      const coordsText = result.getByTestId('location-coordinates-text');
      expect(coordsText.children.join('')).toContain('9.8700');
    });

    it('displays the reverse geocoded address', async () => {
      (ExpoLocation.reverseGeocodeAsync as jest.Mock).mockResolvedValue([
        {
          name: 'Golden Gate Park',
          street: 'Main Drive',
          city: 'San Francisco',
          region: 'CA',
          postalCode: '94122',
          country: 'USA',
        },
      ]);
      const result = await renderScreen();
      await waitForMap(result);
      await waitFor(() => {
        expect(result.queryByTestId('location-address-text')).toBeTruthy();
      });
      const addressText = result.getByTestId('location-address-text');
      expect(addressText.children.join('')).toContain('Golden Gate Park');
    });

    it('re-centers to current location when the re-center button is pressed', async () => {
      (ExpoLocation.getCurrentPositionAsync as jest.Mock)
        .mockResolvedValueOnce({ coords: { latitude: 0, longitude: 0, altitude: 0, accuracy: 5 } })
        .mockResolvedValueOnce({
          coords: { latitude: 51.5074, longitude: -0.1278, altitude: 11, accuracy: 10 },
        });
      const result = await renderScreen();
      await waitForMap(result);
      const recenterBtn = result.getByTestId('recenter-button');
      await act(async () => {
        fireEvent.press(recenterBtn);
      });
      await flushEffects();
      const coordsText = await result.findByTestId('location-coordinates-text');
      expect(coordsText.children.join('')).toContain('51.5074');
    });

    it('requests permission when re-centering and permission has not been decided', async () => {
      (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'undetermined',
        granted: false,
        canAskAgain: true,
      });
      (ExpoLocation.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
        granted: true,
      });
      (ExpoLocation.getCurrentPositionAsync as jest.Mock)
        .mockResolvedValueOnce({ coords: { latitude: 0, longitude: 0, altitude: 0, accuracy: 5 } })
        .mockResolvedValueOnce({
          coords: { latitude: 12.34, longitude: 56.78, altitude: 11, accuracy: 10 },
        });

      const result = await renderScreen();
      await waitForMap(result);
      const recenterBtn = result.getByTestId('recenter-button');
      await act(async () => {
        fireEvent.press(recenterBtn);
      });
      await flushEffects();

      expect(ExpoLocation.requestForegroundPermissionsAsync).toHaveBeenCalled();
      const coordsText = await result.findByTestId('location-coordinates-text');
      expect(coordsText.children.join('')).toContain('12.34');
    });

    it('updates location when the map is dragged', async () => {
      jest.useFakeTimers();
      (ExpoLocation.reverseGeocodeAsync as jest.Mock).mockResolvedValue([
        { name: 'New Spot', city: 'New City', country: 'Newland' },
      ]);
      const result = await renderScreen();
      await waitForMap(result);
      const map = result.getByTestId('entry-location-map');
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [10, 20], userInteraction: true },
        });
      });
      await act(async () => {
        jest.advanceTimersByTime(GEOCODE_DEBOUNCE_MS + 50);
      });
      await flushEffects();
      const addressText = await result.findByTestId('location-address-text');
      expect(addressText.children.join('')).toContain('New Spot');
    });

    it('disables outer ScrollView while user is interacting with the map', async () => {
      jest.useFakeTimers();
      const result = await renderScreen();
      await waitForMap(result);
      const scrollView = result.getByTestId('entry-scroll-view');
      const map = result.getByTestId('entry-location-map');
      expect(scrollView.props.scrollEnabled).toBe(true);
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [-122.4, 37.8], userInteraction: true },
        });
      });
      expect(scrollView.props.scrollEnabled).toBe(false);
      await act(async () => {
        jest.advanceTimersByTime(MAP_INTERACTION_LOCK_MS + 50);
      });
      expect(scrollView.props.scrollEnabled).toBe(true);
    });
  });

  describe('autosave', () => {
    it('flushes pending autosave on back navigation', async () => {
      jest.useFakeTimers();
      const entry: JournalEntry = {
        id: 'entry-1',
        content: 'initial',
        datetime: new Date(),
        created_at: new Date(),
        modified_at: new Date(),
        tags: [],
      };
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: { ...DEFAULT_STATE, entries: [entry] },
        actions,
      });
      const result = await renderScreen('entry-1');
      const input = result.getByTestId('entry-content-input');
      await act(async () => {
        fireEvent.changeText(input, 'flushed content');
      });
      expect(beforeRemoveHandler).toBeTruthy();
      await act(async () => {
        beforeRemoveHandler!({ preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } });
      });
      await flushEffects();
      expect(actions.updateEntry).toHaveBeenCalledWith(
        'entry-1',
        expect.objectContaining({ content: 'flushed content' }),
      );
      expect(mockDispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
    });

    it('creates a new entry on back navigation in create mode', async () => {
      jest.useFakeTimers();
      const result = await renderScreen();
      const input = result.getByTestId('entry-content-input');
      await act(async () => {
        fireEvent.changeText(input, 'new entry content');
      });
      expect(beforeRemoveHandler).toBeTruthy();
      await act(async () => {
        beforeRemoveHandler!({ preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } });
      });
      await flushEffects();
      expect(actions.createEntry).toHaveBeenCalledWith(
        'new entry content',
        expect.any(Date),
        [],
        expect.objectContaining({ latitude: 0, longitude: 0 }),
      );
    });
  });

  describe('undo/redo', () => {
    it('undoes and redoes content changes', async () => {
      jest.useFakeTimers();
      const result = await renderScreen();
      const input = result.getByTestId('entry-content-input');
      await act(async () => {
        fireEvent.changeText(input, 'first');
      });
      await act(async () => {
        jest.advanceTimersByTime(CONTENT_UNDO_COALESCE_MS + 50);
      });
      await act(async () => {
        fireEvent.changeText(input, 'second');
      });
      await act(async () => {
        jest.advanceTimersByTime(CONTENT_UNDO_COALESCE_MS + 50);
      });
      expect(input.props.value).toBe('second');
      const undoButton = result.getByTestId('undo-button');
      await act(async () => {
        fireEvent.press(undoButton);
      });
      expect(input.props.value).toBe('first');
      const redoButton = result.getByTestId('redo-button');
      await act(async () => {
        fireEvent.press(redoButton);
      });
      expect(input.props.value).toBe('second');
    });

    it('undoes tag additions and removals', async () => {
      const result = await renderScreen();
      const tagInput = result.getByTestId('tag-input');
      await act(async () => {
        fireEvent.changeText(tagInput, 'mood');
      });
      const addIcon = result.getByTestId('add-tag-icon');
      await act(async () => {
        fireEvent.press(addIcon);
      });
      expect(result.queryByText('mood')).toBeTruthy();
      const undoButton = result.getByTestId('undo-button');
      await act(async () => {
        fireEvent.press(undoButton);
      });
      expect(result.queryByText('mood')).toBeNull();
    });

    it('undoes date changes', async () => {
      const result = await renderScreen();
      const initialDate = result.getByTestId('entry-date-text').children[0];
      const dateButton = result.getByTestId('entry-date-button');
      await act(async () => {
        fireEvent.press(dateButton);
      });
      const saveButton = result.getByTestId('date-picker-save');
      await act(async () => {
        fireEvent.press(saveButton);
      });
      expect(result.getByTestId('entry-date-text').children[0]).not.toEqual(initialDate);
      const undoButton = result.getByTestId('undo-button');
      await act(async () => {
        fireEvent.press(undoButton);
      });
      expect(result.getByTestId('entry-date-text').children[0]).toEqual(initialDate);
    });
  });

  describe('snackbar', () => {
    it('displays and dismisses error messages', async () => {
      (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
        granted: false,
        canAskAgain: false,
      });
      const result = await renderScreen();
      await flushEffects();
      const recenterBtn = result.getByTestId('recenter-button');
      await act(async () => {
        fireEvent.press(recenterBtn);
      });
      await waitFor(() => {
        expect(result.queryByText('Location permission not granted.')).toBeTruthy();
      });
      const dismissButton = result.getByText('Dismiss');
      await act(async () => {
        fireEvent.press(dismissButton);
      });
      expect(result.queryByText('Location permission not granted.')).toBeNull();
    });
  });

  describe('camera re-center', () => {
    it('passes the entry saved location as Camera center in edit mode', async () => {
      const entry: JournalEntry = {
        id: 'edit-1',
        content: 'hello',
        datetime: new Date(),
        created_at: new Date(),
        modified_at: new Date(),
        tags: [],
        location: { latitude: 40.7128, longitude: -74.006, elevation: 10 },
      };
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: { ...DEFAULT_STATE, entries: [entry] },
        actions,
      });
      const result = await renderScreen('edit-1');
      await waitFor(() => {
        expect(result.queryByTestId('entry-location-map')).toBeTruthy();
      });
      /**
       * Finds Camera mock views in the rendered tree by center and zoom props.
       *
       * @returns Array of test instances matching the Camera mock.
       */
      const findCameraViews = () =>
        result.UNSAFE_root.findAll(
          (node: TestInstance) =>
            Array.isArray((node.props as Record<string, unknown>)?.center) &&
            typeof (node.props as Record<string, unknown>)?.zoom === 'number',
        );
      const cameraViews = findCameraViews();
      expect(cameraViews.length).toBeGreaterThan(0);
      expect(cameraViews[0].props.center).toEqual([-74.006, 40.7128]);
    });
  });
});
