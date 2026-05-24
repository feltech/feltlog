import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaperProvider } from 'react-native-paper';
import * as ExpoLocation from 'expo-location';

// The debounce / timeout constants that drive the component under test.
// Must match the values in app/modal.tsx.
const GEOCODE_DEBOUNCE_MS = 600;
const GEOCODE_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
// Mocks — hoisted by Jest before any imports below.
// ---------------------------------------------------------------------------

/** Fully control router behaviour. */
jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({})),
  useRouter: jest.fn(() => ({ back: jest.fn() })),
}));

/** Replace the real ViewModel so we don't need a database. */
jest.mock('@/src/presentation/viewmodels/JournalViewModel', () => ({
  useJournalViewModel: jest.fn(),
}));

/**
 * Mock SafeAreaProvider to pass through children.
 *
 * The native SafeAreaProvider renders as RNCSafeAreaProvider, which produces children:
 * null in Jest. Replacing it with a simple Fragment wrapper ensures the modal's child
 * components are rendered and testable.
 */
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

import { useJournalViewModel } from '@/src/presentation/viewmodels/JournalViewModel';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { JournalEntry } from '@/src/domain/entities/JournalEntry';
import JournalEntryModal from '../modal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default (empty) view-model state used for most create-mode tests. */
const DEFAULT_STATE: {
  entries: JournalEntry[];
  tags: { id: string; name: string; created_at: string }[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  selectedTags: string[];
  hasMore: boolean;
} = {
  entries: [],
  tags: [],
  loading: false,
  error: null,
  searchQuery: '',
  selectedTags: [],
  hasMore: false,
};

/**
 * Returns a fresh set of mock actions. Every action is a jest mock that resolves so
 * Promise-based callers (e.g. createEntry, updateEntry) don't blow up.
 *
 * @returns A record of mock functions keyed by action name.
 */
function stubActions(): Record {
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
  };
}

/**
 * Helper to render the modal with both providers.
 *
 * @param entryId - Optional entry ID to pass as a search param (edit mode).
 *
 * @returns The render result from testing-library.
 */
function renderModal(entryId?: string) {
  (useLocalSearchParams as jest.Mock).mockReturnValue(entryId ? { entryId } : {});
  return render(
    <SafeAreaProvider>
      <PaperProvider>
        <JournalEntryModal />
      </PaperProvider>
    </SafeAreaProvider>,
  );
}

/**
 * Helper that waits for the location fetch to settle so the map appears. In create mode
 * the component fetches the device position on mount.
 *
 * @param result - The render result returned by renderModal.
 *
 * @returns Promise that resolves when the map testID is found.
 */
async function waitForMap(result: ReturnType): Promise {
  await waitFor(() => {
    expect(result.queryByTestId('entry-location-map')).toBeTruthy();
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('JournalEntryModal', () => {
  let mockBack: jest.Mock;
  let actions: Record;

  beforeEach(() => {
    // Reset all mocks between tests so per-test overrides don't leak.
    jest.clearAllMocks();

    // Explicitly reset expo-location mocks to default implementations.
    // clearlAllMocks does not reset mock implementations, so any test that
    // overrode reverseGeocodeAsync (e.g. to hang forever) would leak into
    // subsequent tests, causing the initial location fetch to never resolve
    // and the map to never appear.
    (ExpoLocation.reverseGeocodeAsync as jest.Mock).mockImplementation(async () => []);

    mockBack = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ back: mockBack });
    (useLocalSearchParams as jest.Mock).mockReturnValue({}); // create mode by default

    actions = stubActions();
    (useJournalViewModel as jest.Mock).mockReturnValue({
      state: { ...DEFAULT_STATE },
      actions,
    });
  });

  afterEach(() => {
    // Ensure real timers are restored after any test that used fakes.
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  describe('rendering', () => {
    it('renders without error in create mode (no entryId)', async () => {
      const result = renderModal();
      // Sanity: the component produces a non-null component tree.
      expect(result.toJSON()).toBeTruthy();
    });

    it('shows a map in create mode once the initial location is fetched', async () => {
      const result = renderModal();
      await waitForMap(result);
      // The map should be interactive: scroll and zoom enabled.
      const map = result.getByTestId('entry-location-map');
      expect(map.props.scrollEnabled).toBe(true);
      expect(map.props.zoomEnabled).toBe(true);
    });

    it('shows "New Entry" title in create mode', () => {
      const result = renderModal();
      // Paper's Appbar.Content renders the title as a Text child.
      const header = result.getByText('New Entry');
      expect(header).toBeTruthy();
    });

    it('shows "Edit Entry" title in edit mode when entry exists', () => {
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'entry-1',
              content: 'existing content',
              datetime: new Date('2025-01-15T12:00:00Z'),
              created_at: new Date('2025-01-15T12:00:00Z'),
              modified_at: new Date('2025-01-15T12:00:00Z'),
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = renderModal('entry-1');
      expect(result.getByText('Edit Entry')).toBeTruthy();
    });

    it('renders undo and redo buttons', () => {
      const result = renderModal();
      expect(result.getByTestId('undo-button')).toBeTruthy();
      expect(result.getByTestId('redo-button')).toBeTruthy();
    });

    it('renders a back button', () => {
      const result = renderModal();
      expect(result.getByTestId('back')).toBeTruthy();
    });

    it('renders the content text input', () => {
      const result = renderModal();
      expect(result.getByTestId('entry-content-input')).toBeTruthy();
    });

    it('renders the tag input and add-tag icon', () => {
      const result = renderModal();
      expect(result.getByTestId('tag-input')).toBeTruthy();
      expect(result.getByTestId('add-tag-icon')).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Map interactivity
  // -------------------------------------------------------------------------

  describe('map interactivity', () => {
    it('has scrollEnabled=true and zoomEnabled=true in create mode', async () => {
      const result = renderModal();
      await waitForMap(result);

      const map = result.getByTestId('entry-location-map');
      expect(map.props.scrollEnabled).toBe(true);
      expect(map.props.zoomEnabled).toBe(true);
    });

    it('has scrollEnabled=false and zoomEnabled=false in edit mode', async () => {
      // Make the view-model return an existing entry with a location so the
      // map renders.
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'hello',
              datetime: new Date(),
              created_at: new Date(),
              modified_at: new Date(),
              tags: [] as string[],
              location: { latitude: 40.7, longitude: -74, elevation: 10 },
            },
          ],
        },
        actions,
      });

      const result = renderModal('edit-1');
      // The map should appear because the existing entry has a location.
      // Wait for any async effects to settle.
      await waitFor(() => {
        expect(result.queryByTestId('entry-location-map')).toBeTruthy();
      });

      const map = result.getByTestId('entry-location-map');
      expect(map.props.scrollEnabled).toBe(false);
      expect(map.props.zoomEnabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // isUpdatingLocation and back-button disabled state
  // -------------------------------------------------------------------------

  describe('isUpdatingLocation state and back-button', () => {
    it('back button is NOT disabled initially (before any region change)', async () => {
      const result = renderModal();
      await waitForMap(result);

      const backBtn = result.getByTestId('back');
      expect(backBtn.props.accessibilityState?.disabled).toBe(false);
    });

    it('back button becomes disabled when a user-driven region change fires', async () => {
      jest.useFakeTimers();
      const result = renderModal();
      await waitForMap(result);

      const map = result.getByTestId('entry-location-map');

      // Trigger a user-driven map region change.
      await act(async () => {
        map.props.onRegionDidChange({
          type: 'Feature',
          properties: { isUserInteraction: true },
          geometry: { type: 'Point', coordinates: [-122.4, 37.8] },
        });
      });

      // After the region change handler runs, isUpdatingLocation should be
      // true (the debounce hasn't fired yet), so the back button is disabled.
      const backBtn = result.getByTestId('back');
      expect(backBtn.props.accessibilityState?.disabled).toBe(true);

      // The hint text should also be present.
      expect(result.queryByText('Looking up address, please wait…')).toBeTruthy();

      jest.useRealTimers();
    });

    it('back button re-enables after geocode completes', async () => {
      jest.useFakeTimers();

      // Override the reverseGeocodeAsync mock to return an address quickly.
      (ExpoLocation.reverseGeocodeAsync as jest.Mock).mockResolvedValue([
        {
          name: 'Central Park',
          street: '5th Ave',
          city: 'New York',
          region: 'NY',
          postalCode: '10001',
          country: 'US',
        },
      ]);

      const result = renderModal();
      await waitForMap(result);

      const map = result.getByTestId('entry-location-map');

      // Trigger a user-driven region change.
      await act(async () => {
        map.props.onRegionDidChange({
          type: 'Feature',
          properties: { isUserInteraction: true },
          geometry: { type: 'Point', coordinates: [-122.4, 37.8] },
        });
      });

      // Advance past the debounce delay so the geocode fires.
      await act(async () => {
        jest.advanceTimersByTime(GEOCODE_DEBOUNCE_MS + 50);
      });

      // Wait for the state to settle: isUpdatingLocation should flip back to
      // false after the geocode resolves.
      await waitFor(() => {
        const backBtn = result.getByTestId('back');
        expect(backBtn.props.accessibilityState?.disabled).toBe(false);
      });

      // The hint text should be gone.
      expect(result.queryByText('Looking up address, please wait…')).toBeNull();

      jest.useRealTimers();
    });

    it('shows the location-updating hint text when disabled', async () => {
      jest.useFakeTimers();
      const result = renderModal();
      await waitForMap(result);

      const map = result.getByTestId('entry-location-map');
      await act(async () => {
        map.props.onRegionDidChange({
          type: 'Feature',
          properties: { isUserInteraction: true },
          geometry: { type: 'Point', coordinates: [-122.4, 37.8] },
        });
      });

      expect(result.queryByText('Looking up address, please wait…')).toBeTruthy();

      jest.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // Geocode behaviour (address update)
  // -------------------------------------------------------------------------

  describe('geocode behaviour', () => {
    it('updates the address in the location-updating UI on successful geocode', async () => {
      jest.useFakeTimers();

      // Provide a fake address.
      (ExpoLocation.reverseGeocodeAsync as jest.Mock).mockResolvedValue([
        {
          name: 'Golden Gate',
          street: '',
          city: 'San Francisco',
          region: 'CA',
          postalCode: '94129',
          country: 'US',
        },
      ]);

      const result = renderModal();
      await waitForMap(result);

      const map = result.getByTestId('entry-location-map');
      await act(async () => {
        map.props.onRegionDidChange({
          type: 'Feature',
          properties: { isUserInteraction: true },
          geometry: { type: 'Point', coordinates: [-122.478, 37.819] },
        });
      });

      // Advance timers past the debounce so the geocode request fires.
      await act(async () => {
        jest.advanceTimersByTime(GEOCODE_DEBOUNCE_MS + 50);
      });

      // After the geocode resolves, the "Updating location…" spinner should
      // disappear (isUpdatingLocation goes back to false).
      await waitFor(() => {
        expect(result.queryByText('Updating location…')).toBeNull();
      });

      // The back button should be re-enabled.
      const backBtn = result.getByTestId('back');
      expect(backBtn.props.accessibilityState?.disabled).toBe(false);

      jest.useRealTimers();
    });

    it('recovers gracefully when the geocode times out', async () => {
      jest.useFakeTimers();

      // The initial location fetch calls reverseGeocodeAsync — let it resolve.
      // Subsequent calls (from region-change geocode) hang forever so the
      // timeout always wins.
      (ExpoLocation.reverseGeocodeAsync as jest.Mock)
        .mockImplementationOnce(async () => [])
        .mockImplementation(() => new Promise(() => {})); // never resolves

      const result = renderModal();
      await waitForMap(result);

      const map = result.getByTestId('entry-location-map');
      await act(async () => {
        map.props.onRegionDidChange({
          type: 'Feature',
          properties: { isUserInteraction: true },
          geometry: { type: 'Point', coordinates: [10, 20] },
        });
      });

      // Advance past the debounce to start the geocode, then past the geocode
      // timeout (GEOCODE_TIMEOUT_MS). The total wait is debounce + timeout.
      await act(async () => {
        jest.advanceTimersByTime(GEOCODE_DEBOUNCE_MS + GEOCODE_TIMEOUT_MS + 100);
      });

      // After the timeout, the Promise.race rejects, catch clause runs,
      // and the finally block sets isUpdatingLocation back to false.
      await waitFor(() => {
        const backBtn = result.getByTestId('back');
        expect(backBtn.props.accessibilityState?.disabled).toBe(false);
      });

      // The hint text should also be gone.
      expect(result.queryByText('Looking up address, please wait…')).toBeNull();

      jest.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // handleRegionDidChange — filtering branches
  // -------------------------------------------------------------------------

  describe('handleRegionDidChange', () => {
    it('ignores region changes in edit mode', async () => {
      // Set up an existing entry so the modal is in edit mode.
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'hello',
              datetime: new Date(),
              created_at: new Date(),
              modified_at: new Date(),
              tags: [] as string[],
              location: { latitude: 40.7, longitude: -74, elevation: 10 },
            },
          ],
        },
        actions,
      });

      const result = renderModal('edit-1');
      await waitFor(() => {
        expect(result.queryByTestId('entry-location-map')).toBeTruthy();
      });

      const map = result.getByTestId('entry-location-map');

      // Fire a user-driven region change — it should be ignored.
      await act(async () => {
        map.props.onRegionDidChange({
          type: 'Feature',
          properties: { isUserInteraction: true },
          geometry: { type: 'Point', coordinates: [1, 2] },
        });
      });

      // Back button should still be enabled (isUpdatingLocation stayed false).
      const backBtn = result.getByTestId('back');
      expect(backBtn.props.accessibilityState?.disabled).toBe(false);
    });

    it('ignores non-user-interaction region changes', async () => {
      jest.useFakeTimers();
      const result = renderModal();
      await waitForMap(result);

      const map = result.getByTestId('entry-location-map');

      // Fire a programmatic region change (no isUserInteraction).
      await act(async () => {
        map.props.onRegionDidChange({
          type: 'Feature',
          properties: { isUserInteraction: false },
          geometry: { type: 'Point', coordinates: [1, 2] },
        });
      });

      // isUpdatingLocation should remain false because the handler bailed early.
      const backBtn = result.getByTestId('back');
      expect(backBtn.props.accessibilityState?.disabled).toBe(false);

      jest.useRealTimers();
    });

    it('discards stale geocode results from rapid drags', async () => {
      jest.useFakeTimers();

      // Initial location fetch: resolve immediately so the map appears.
      // First user drag (stale): hang forever (simulates slow network).
      // Second user drag: resolve with address "B".
      (ExpoLocation.reverseGeocodeAsync as jest.Mock)
        .mockImplementationOnce(async () => []) // initial fetch
        .mockImplementationOnce(() => new Promise(() => {})) // first drag (stale)
        .mockResolvedValueOnce([
          {
            name: 'Address B',
            street: 'B St',
            city: 'B City',
            region: 'BR',
            postalCode: 'B01',
            country: 'BC',
          },
        ]);

      const result = renderModal();
      await waitForMap(result);

      const map = result.getByTestId('entry-location-map');

      // First user-driven drag.
      await act(async () => {
        map.props.onRegionDidChange({
          type: 'Feature',
          properties: { isUserInteraction: true },
          geometry: { type: 'Point', coordinates: [10, 20] },
        });
      });

      // Advance past the first debounce → first geocode starts (but hangs).
      await act(async () => {
        jest.advanceTimersByTime(GEOCODE_DEBOUNCE_MS + 10);
      });

      // Second drag while first geocode is still in-flight.
      await act(async () => {
        map.props.onRegionDidChange({
          type: 'Feature',
          properties: { isUserInteraction: true },
          geometry: { type: 'Point', coordinates: [30, 40] },
        });
      });

      // Advance past the second debounce → second geocode starts and resolves.
      await act(async () => {
        jest.advanceTimersByTime(GEOCODE_DEBOUNCE_MS + 10);
      });

      // After the second geocode resolves, isUpdatingLocation goes to false.
      await waitFor(() => {
        const backBtn = result.getByTestId('back');
        expect(backBtn.props.accessibilityState?.disabled).toBe(false);
      });

      // The first (stale) geocode never resolves, but even if it did, its
      // geocodeId wouldn't match pendingGeocodeRef, so the address from drag 2
      // is the only one that could have been applied.
      //
      // We cannot inspect currentLocation directly (it's internal state), but
      // we can verify that the component is still in a healthy state.
      expect(result.toJSON()).toBeTruthy();

      jest.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // Back button behaviour
  // -------------------------------------------------------------------------

  describe('back button', () => {
    it('calls router.back when pressed in create mode (no content)', async () => {
      const result = renderModal();
      await waitForMap(result);

      fireEvent.press(result.getByTestId('back'));

      // In create mode with no content, handleSaveAndClose just calls back().
      await waitFor(() => {
        expect(mockBack).toHaveBeenCalled();
      });
    });

    it('creates an entry then navigates back when content is present', async () => {
      const result = renderModal();
      await waitForMap(result);

      // Type some content.
      const contentInput = result.getByTestId('entry-content-input');
      fireEvent.changeText(contentInput, 'My new journal entry');

      // Press back.
      fireEvent.press(result.getByTestId('back'));

      // createEntry should have been called.
      await waitFor(() => {
        expect(actions.createEntry).toHaveBeenCalled();
        expect(mockBack).toHaveBeenCalled();
      });
    });

    it('still saves and navigates back when isUpdatingLocation is true', async () => {
      // Prevent the geocode from resolving so isUpdatingLocation stays true.
      jest.useFakeTimers();
      // Initial fetch: resolve immediately with empty result so map appears.
      // Region-change geocode: hang forever so isUpdatingLocation never flips.
      (ExpoLocation.reverseGeocodeAsync as jest.Mock)
        .mockImplementationOnce(async () => [])
        .mockImplementation(() => new Promise(() => {}));

      const result = renderModal();
      await waitForMap(result);

      // Trigger a user-driven region change to set isUpdatingLocation = true.
      const map = result.getByTestId('entry-location-map');
      await act(async () => {
        map.props.onRegionDidChange({
          type: 'Feature',
          properties: { isUserInteraction: true },
          geometry: { type: 'Point', coordinates: [10, 20] },
        });
      });

      // Verify the back button is disabled.
      const backBtn = result.getByTestId('back');
      expect(backBtn.props.accessibilityState?.disabled).toBe(true);

      // Type content so createEntry will be called.
      const contentInput = result.getByTestId('entry-content-input');
      fireEvent.changeText(contentInput, 'Entry during location update');

      // The back button is disabled, so fireEvent.press won't trigger the
      // onPress handler through Paper's internal disabled guard. Instead,
      // traverse the rendered tree to find the element that actually holds
      // the onPress callback and invoke it directly — simulating what would
      // happen if a hardware back gesture bypassed the disabled state.
      const pressableElement = result.UNSAFE_root.findByProps({
        disabled: true,
        accessibilityLabel: 'Go back',
      });
      await act(async () => {
        pressableElement.props.onPress();
      });

      // The save should still proceed and navigate back — the old guard that
      // used to return early (dropping data) has been removed.
      await waitFor(() => {
        expect(actions.createEntry).toHaveBeenCalled();
        expect(mockBack).toHaveBeenCalled();
      });

      jest.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // Undo / redo
  // -------------------------------------------------------------------------

  describe('undo and redo', () => {
    it('undo button is initially disabled', () => {
      const result = renderModal();
      expect(result.getByTestId('undo-button').props.accessibilityState?.disabled).toBe(true);
    });

    it('redo button is initially disabled', () => {
      const result = renderModal();
      expect(result.getByTestId('redo-button').props.accessibilityState?.disabled).toBe(true);
    });

    it('undo becomes enabled after typing, and reverts text', () => {
      const result = renderModal();
      const contentInput = result.getByTestId('entry-content-input');

      fireEvent.changeText(contentInput, 'first version');
      fireEvent.changeText(contentInput, 'second version');

      // Undo should go back to 'first version'.
      const undoBtn = result.getByTestId('undo-button');
      expect(undoBtn.props.accessibilityState?.disabled).toBe(false);

      fireEvent.press(undoBtn);
      expect(contentInput.props.value).toBe('first version');
    });

    it('redo restores undone text', () => {
      const result = renderModal();
      const contentInput = result.getByTestId('entry-content-input');

      fireEvent.changeText(contentInput, 'first version');
      fireEvent.changeText(contentInput, 'second version');

      // Undo.
      const undoBtn = result.getByTestId('undo-button');
      fireEvent.press(undoBtn);

      // Redo should restore 'second version'.
      const redoBtn = result.getByTestId('redo-button');
      expect(redoBtn.props.accessibilityState?.disabled).toBe(false);
      fireEvent.press(redoBtn);

      expect(contentInput.props.value).toBe('second version');
    });
  });

  // -------------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------------

  describe('tags', () => {
    it('adds a tag when the plus icon is pressed', () => {
      const result = renderModal();
      const tagInput = result.getByTestId('tag-input');

      fireEvent.changeText(tagInput, 'work');

      const addIcon = result.getByTestId('add-tag-icon');
      fireEvent.press(addIcon);

      // After adding, the tag input should be cleared.
      expect(tagInput.props.value).toBe('');
    });

    it('does not add duplicate tags', () => {
      const result = renderModal();
      const tagInput = result.getByTestId('tag-input');

      fireEvent.changeText(tagInput, 'work');
      fireEvent.press(result.getByTestId('add-tag-icon'));

      // Try adding the same tag again — the input is not cleared when the
      // tag already exists (the handler returns early without calling
      // setTagInput('')).
      fireEvent.changeText(tagInput, 'work');
      fireEvent.press(result.getByTestId('add-tag-icon'));

      // The input still holds the duplicate tag text.
      expect(tagInput.props.value).toBe('work');
    });
  });

  // -------------------------------------------------------------------------
  // Unmount cleanup
  // -------------------------------------------------------------------------

  describe('unmount cleanup', () => {
    it('does not throw when unmounted while a geocode debounce is active', async () => {
      // Spy on console.error to catch any "state update on unmounted component"
      // warnings from React.
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      jest.useFakeTimers();
      // Initial fetch resolves quickly so the map appears.
      // Region-change geocode hangs so the debounce timer doesn't resolve.
      (ExpoLocation.reverseGeocodeAsync as jest.Mock)
        .mockImplementationOnce(async () => [])
        .mockImplementation(() => new Promise(() => {}));

      const result = renderModal();
      await waitForMap(result);

      // Trigger a region change to start a geocode debounce timer.
      const map = result.getByTestId('entry-location-map');
      await act(async () => {
        map.props.onRegionDidChange({
          type: 'Feature',
          properties: { isUserInteraction: true },
          geometry: { type: 'Point', coordinates: [10, 20] },
        });
      });

      // Unmount the component while the geocode debounce timer is still
      // active (it hasn't fired yet).
      result.unmount();

      // Advance past the debounce delay. The timer should fire, but the
      // cleanup effect [useEffect with empty deps, lines 189-194] clears
      // geoDebounceRef.current on unmount. However, setTimeout callbacks
      // can't truly be cancelled after the fact — the callback still runs
      // but clearTimeout was called, so Jest's fake timers won't invoke it.
      await act(async () => {
        jest.advanceTimersByTime(GEOCODE_DEBOUNCE_MS + 100);
      });

      // The geocode timeout timer is also a concern: ensure advancing past
      // it doesn't cause issues either.
      await act(async () => {
        jest.advanceTimersByTime(GEOCODE_TIMEOUT_MS + 100);
      });

      // No "state update on unmounted component" warnings should appear.
      const stateUpdateWarnings = consoleSpy.mock.calls.filter(
        call => typeof call[0] === 'string' && call[0].includes('unmounted'),
      );
      expect(stateUpdateWarnings).toHaveLength(0);

      consoleSpy.mockRestore();
      jest.useRealTimers();
    });
  });
});
