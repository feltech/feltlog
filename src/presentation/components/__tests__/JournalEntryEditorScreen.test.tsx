import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, AppStateStatus, ScrollView } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Chip, PaperProvider } from 'react-native-paper';
import * as ExpoLocation from 'expo-location';

const GEOCODE_DEBOUNCE_MS = 600;
const POSITION_TIMEOUT_MS = 15000;
const BALANCED_TIMEOUT_MS = 5000;
const CONTENT_UNDO_COALESCE_MS = 500;

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

    it('does not autosave edited content during typing (debounce removed)', async () => {
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
      // Advance well past the former AUTOSAVE_DELAY_MS window. No save should
      // fire because the debounced autosave effect has been removed.
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      await flushEffects();
      expect(actions.updateEntry).not.toHaveBeenCalled();
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

    it('imperatively locks the outer ScrollView via setNativeProps when the map is dragged', async () => {
      // The scroll lock is now toggled imperatively via setNativeProps on the
      // ScrollView host instance (held in a ref) instead of via the
      // `scrollEnabled` React prop. This avoids re-rendering the ScrollView +
      // TextInput subtree during a map gesture, which was the root cause of
      // the scroll-offset reset that made the outer scroll jump up and
      // obscure the map.
      //
      // The jest-preset ScrollView mock exposes setNativeProps on its
      // prototype (via MockNativeMethods), so spying on
      // ScrollView.prototype.setNativeProps captures the imperative calls.
      jest.useFakeTimers();
      const setNativePropsSpy = jest.spyOn(ScrollView.prototype, 'setNativeProps');

      const result = await renderScreen();
      await waitForMap(result);
      const map = result.getByTestId('entry-location-map');

      // No lock call before any interaction.
      const lockCallsBefore = setNativePropsSpy.mock.calls.filter(
        ([props]) => (props as { scrollEnabled?: boolean }).scrollEnabled === false,
      );
      expect(lockCallsBefore).toHaveLength(0);

      // A user-driven region change locks scrolling.
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [-122.4, 37.8], userInteraction: true },
        });
      });
      expect(setNativePropsSpy).toHaveBeenCalledWith({ scrollEnabled: false });

      // A subsequent programmatic region change (userInteraction: false, i.e.
      // the gesture has ended) releases the lock. No debounce timer is
      // involved — the lock is released directly on gesture end.
      setNativePropsSpy.mockClear();
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [-122.4, 37.8], userInteraction: false },
        });
      });
      expect(setNativePropsSpy).toHaveBeenCalledWith({ scrollEnabled: true });

      setNativePropsSpy.mockRestore();
    });

    it('does not re-render the ScrollView subtree on repeated user-driven region changes', async () => {
      // Regression test for the scroll-jump bug: a series of user-driven
      // onRegionDidChange events must NOT flip the `scrollEnabled` React
      // prop (which would re-render the ScrollView and reset the scroll
      // offset). The lock is toggled imperatively via setNativeProps, so the
      // prop stays at its default (true) throughout the gesture.
      jest.useFakeTimers();
      const setNativePropsSpy = jest.spyOn(ScrollView.prototype, 'setNativeProps');

      const result = await renderScreen();
      await waitForMap(result);
      const scrollView = result.getByTestId('entry-scroll-view');
      const map = result.getByTestId('entry-location-map');

      // The scrollEnabled prop is never set in JSX, so it remains undefined
      // (the native default is true). It must NOT become false during a drag.
      expect(scrollView.props.scrollEnabled).toBeUndefined();

      // Simulate a rapid series of drag events.
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          map.props.onRegionDidChange({
            nativeEvent: { center: [-122.4 + i * 0.001, 37.8], userInteraction: true },
          });
        });
      }

      // The prop must still be undefined (no re-render with scrollEnabled=false).
      // The lock was applied imperatively, not via the prop.
      const scrollViewAfter = result.getByTestId('entry-scroll-view');
      expect(scrollViewAfter.props.scrollEnabled).toBeUndefined();

      // setNativeProps should have been called exactly once with
      // scrollEnabled: false (the first user-driven event locks; subsequent
      // user-driven events are no-ops because mapTouchedRef is already true).
      const lockCalls = setNativePropsSpy.mock.calls.filter(
        ([props]) => (props as { scrollEnabled?: boolean }).scrollEnabled === false,
      );
      expect(lockCalls).toHaveLength(1);

      setNativePropsSpy.mockRestore();
    });

    it('locks the outer ScrollView on touch start and releases on touch end', async () => {
      // The map container's onTouchStart/onTouchEnd handlers also toggle the
      // imperative lock, covering the case where a touch lands on the map
      // without producing a region change (e.g. a tap without a drag).
      jest.useFakeTimers();
      const setNativePropsSpy = jest.spyOn(ScrollView.prototype, 'setNativeProps');

      const result = await renderScreen();
      await waitForMap(result);
      const mapContainer = result.getByTestId('map-container');

      await act(async () => {
        mapContainer.props.onTouchStart();
      });
      expect(setNativePropsSpy).toHaveBeenCalledWith({ scrollEnabled: false });

      setNativePropsSpy.mockClear();
      await act(async () => {
        mapContainer.props.onTouchEnd();
      });
      expect(setNativePropsSpy).toHaveBeenCalledWith({ scrollEnabled: true });

      setNativePropsSpy.mockRestore();
    });

    it('releases the scroll lock on touch cancel', async () => {
      // onTouchCancel mirrors onTouchEnd: a system-interrupted gesture must
      // still release the imperative scroll lock so the outer ScrollView
      // becomes scrollable again.
      jest.useFakeTimers();
      const setNativePropsSpy = jest.spyOn(ScrollView.prototype, 'setNativeProps');

      const result = await renderScreen();
      await waitForMap(result);
      const mapContainer = result.getByTestId('map-container');

      await act(async () => {
        mapContainer.props.onTouchStart();
      });
      expect(setNativePropsSpy).toHaveBeenCalledWith({ scrollEnabled: false });

      setNativePropsSpy.mockClear();
      await act(async () => {
        mapContainer.props.onTouchCancel();
      });
      expect(setNativePropsSpy).toHaveBeenCalledWith({ scrollEnabled: true });

      setNativePropsSpy.mockRestore();
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

    /**
     * Captures the AppState 'change' listener registered by the editor screen so the
     * test can simulate app backgrounding.
     *
     * @returns The captured listener function.
     */
    function captureAppStateListener(): (state: AppStateStatus) => void {
      const listeners: Array<(state: AppStateStatus) => void> = [];
      (AppState.addEventListener as jest.Mock).mockImplementation(
        (_event: string, handler: (state: AppStateStatus) => void) => {
          listeners.push(handler);
          return { remove: jest.fn() };
        },
      );
      // The mock is consumed at render time; return a getter that reads the
      // most recently registered listener.
      return (state: AppStateStatus) => listeners[listeners.length - 1](state);
    }

    it('flushes pending edits when the app is backgrounded', async () => {
      const triggerBackground = captureAppStateListener();
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
        fireEvent.changeText(input, 'backgrounded content');
      });
      await act(async () => {
        triggerBackground('background');
      });
      await flushEffects();
      expect(actions.updateEntry).toHaveBeenCalledWith(
        'entry-1',
        expect.objectContaining({ content: 'backgrounded content' }),
      );
    });

    it('flushes pending edits when the app becomes inactive', async () => {
      const triggerInactive = captureAppStateListener();
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
        fireEvent.changeText(input, 'inactive content');
      });
      await act(async () => {
        triggerInactive('inactive');
      });
      await flushEffects();
      expect(actions.updateEntry).toHaveBeenCalledWith(
        'entry-1',
        expect.objectContaining({ content: 'inactive content' }),
      );
    });

    it('does not flush when the app returns to the active state', async () => {
      const triggerActive = captureAppStateListener();
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
        fireEvent.changeText(input, 'active content');
      });
      await act(async () => {
        triggerActive('active');
      });
      await flushEffects();
      expect(actions.updateEntry).not.toHaveBeenCalled();
    });

    it('does not attach an AppState listener in create mode', async () => {
      (AppState.addEventListener as jest.Mock).mockClear();
      await renderScreen();
      // The editor only flushes on AppState changes in edit mode; create mode
      // persists solely on back navigation.
      expect(AppState.addEventListener).not.toHaveBeenCalled();
    });

    it('persists tag-only edits on AppState background flush', async () => {
      const triggerBackground = captureAppStateListener();
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
      const tagInput = result.getByTestId('tag-input');
      await act(async () => {
        fireEvent.changeText(tagInput, 'mood');
      });
      const addIcon = result.getByTestId('add-tag-icon');
      await act(async () => {
        fireEvent.press(addIcon);
      });
      await act(async () => {
        triggerBackground('background');
      });
      await flushEffects();
      expect(actions.updateEntry).toHaveBeenCalledWith(
        'entry-1',
        expect.objectContaining({ tags: ['mood'] }),
      );
    });

    /**
     * Verifies that a second AppState background event arriving while a save is already
     * in-flight does not start a concurrent write and does not lose the latest edits.
     * The second flush must await the in-flight save and then re-save the latest dirty
     * state.
     */
    it('awaits an in-flight save on a second background event and re-saves latest edits', async () => {
      const triggerBackground = captureAppStateListener();
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
      // Block the first updateEntry so a save stays in-flight when the second
      // background event fires.
      let resolveFirstSave: (value: unknown) => void;
      const firstSavePromise = new Promise(resolve => {
        resolveFirstSave = resolve;
      });
      actions.updateEntry.mockImplementationOnce(() => firstSavePromise);

      const result = await renderScreen('entry-1');
      const input = result.getByTestId('entry-content-input');
      // First edit triggers a dirty state.
      await act(async () => {
        fireEvent.changeText(input, 'first edit');
      });
      // First background event starts a save (in-flight, unresolved).
      await act(async () => {
        triggerBackground('background');
      });
      await flushEffects();
      expect(actions.updateEntry).toHaveBeenCalledTimes(1);

      // Second edit while the first save is still in-flight.
      await act(async () => {
        fireEvent.changeText(input, 'first edit plus more');
      });
      // Second background event must await the in-flight save, then re-save.
      await act(async () => {
        triggerBackground('background');
      });
      await flushEffects();
      // Still only one call — the second save is queued behind the first.
      expect(actions.updateEntry).toHaveBeenCalledTimes(1);

      // Resolve the first save; the queued second save should now fire.
      await act(async () => {
        resolveFirstSave({
          id: 'entry-1',
          content: 'first edit',
          datetime: new Date(),
          created_at: new Date(),
          modified_at: new Date(),
          tags: [],
        });
      });
      await flushEffects();
      // The second save fired with the latest content — no data loss, no
      // concurrent write.
      expect(actions.updateEntry).toHaveBeenCalledTimes(2);
      expect(actions.updateEntry).toHaveBeenLastCalledWith(
        'entry-1',
        expect.objectContaining({ content: 'first edit plus more' }),
      );
    });

    /**
     * Verifies that a beforeRemove back-navigation flush arriving while an
     * AppState-triggered save is in-flight awaits the in-flight save and then skips a
     * redundant save when the in-flight save already cleared dirty state, without
     * concurrent writes or data loss.
     */
    it('awaits an in-flight AppState save when beforeRemove fires and skips redundant save when no longer dirty', async () => {
      const triggerBackground = captureAppStateListener();
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
      // Block the AppState-triggered save so it stays in-flight when
      // beforeRemove fires.
      let resolveAppStateSave: (value: unknown) => void;
      const appStateSavePromise = new Promise(resolve => {
        resolveAppStateSave = resolve;
      });
      actions.updateEntry.mockImplementationOnce(() => appStateSavePromise);

      const result = await renderScreen('entry-1');
      const input = result.getByTestId('entry-content-input');
      await act(async () => {
        fireEvent.changeText(input, 'appstate edit');
      });
      // AppState background starts a save (in-flight, unresolved).
      await act(async () => {
        triggerBackground('background');
      });
      await flushEffects();
      expect(actions.updateEntry).toHaveBeenCalledTimes(1);

      // Now the user presses back — beforeRemove must await the in-flight save.
      expect(beforeRemoveHandler).toBeTruthy();
      await act(async () => {
        beforeRemoveHandler!({
          preventDefault: jest.fn(),
          data: { action: { type: 'GO_BACK' } },
        });
      });
      await flushEffects();
      // The in-flight save has not resolved yet, so no second write has
      // started — no concurrent write.
      expect(actions.updateEntry).toHaveBeenCalledTimes(1);

      // Resolve the AppState save. dirtyRef was cleared by the first save, and
      // no further mutation happened, so the beforeRemove flush should NOT
      // trigger a second save.
      await act(async () => {
        resolveAppStateSave({
          id: 'entry-1',
          content: 'appstate edit',
          datetime: new Date(),
          created_at: new Date(),
          modified_at: new Date(),
          tags: [],
        });
      });
      await flushEffects();
      expect(actions.updateEntry).toHaveBeenCalledTimes(1);
      // The back navigation was dispatched after the flush completed.
      expect(mockDispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
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
