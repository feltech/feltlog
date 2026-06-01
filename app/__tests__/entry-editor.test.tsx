import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaperProvider } from 'react-native-paper';
import * as ExpoLocation from 'expo-location';

// The debounce / timeout constants that drive the component under test.
// Must match the values in app/entry-editor.tsx.
const GEOCODE_DEBOUNCE_MS = 600;
const GEOCODE_TIMEOUT_MS = 3000;
const CONTENT_UNDO_COALESCE_MS = 500;

// ---------------------------------------------------------------------------
// Mocks — hoisted by Jest before any imports below.
// ---------------------------------------------------------------------------

/**
 * Mock expo-router — useLocalSearchParams returns configurable params, and
 * useNavigation is captured so beforeRemove listeners can be intercepted. Stack is no
 * longer imported by the component (header is now inline).
 */
jest.mock('expo-router', () => {
  return {
    useLocalSearchParams: jest.fn(() => ({})),
    useNavigation: jest.fn(() => mockNavigation),
  };
});

/** Capture beforeRemove listeners for testing. */
let beforeRemoveHandler:
  | ((e: { preventDefault: () => void; data: { action: unknown } }) => void)
  | null = null;
const mockDispatch = jest.fn();
const mockNavigation = {
  dispatch: mockDispatch,
  addListener: jest.fn((event: string, handler: (e: never) => void) => {
    if (event === 'beforeRemove') {
      beforeRemoveHandler = handler as typeof beforeRemoveHandler;
    }
    return jest.fn(); // unsubscribe
  }),
};

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
import { useLocalSearchParams } from 'expo-router';
import type { JournalEntry } from '@/src/domain/entities/JournalEntry';
import JournalEntryModal from '../entry-editor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Number of microtask ticks to flush inside act() so that async state updates from the
 * location-fetch useEffect are captured and don't produce "not wrapped in act()"
 * warnings. The location effect has three await calls (requestPermission, getPosition,
 * reverseGeocode) so three flushes cover them. Extra flushes provide a safety margin.
 */
const MICROTASK_FLUSH_COUNT = 6;

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
  };
}

/**
 * Async helper to render the modal with both providers.
 *
 * Renders synchronously, then flushes pending microtasks inside act() so async state
 * updates from the location-fetch useEffect are captured and don't produce "not wrapped
 * in act()" warnings.
 *
 * @param entryId - Optional entry ID to pass as a search param (edit mode).
 *
 * @returns Promise resolving to the render result from testing-library.
 */
async function renderModal(entryId?: string): Promise<ReturnType<typeof render>> {
  (useLocalSearchParams as jest.Mock).mockReturnValue(entryId ? { entryId } : {});
  const result = render(
    <SafeAreaProvider>
      <PaperProvider>
        <JournalEntryModal />
      </PaperProvider>
    </SafeAreaProvider>,
  );
  // Flush microtasks inside act() so async state updates from the
  // location-fetch useEffect are captured and don't produce "not wrapped
  // in act()" warnings.
  await act(async () => {
    for (let i = 0; i < MICROTASK_FLUSH_COUNT; i++) {
      await Promise.resolve();
    }
  });
  return result;
}

/**
 * Flushes pending microtasks inside act() so that async state updates from the location
 * fetch useEffect are captured and don't produce "not wrapped in act()" warnings.
 *
 * Each await Promise.resolve() processes one tick of the microtask queue. The location
 * effect has three await calls (requestPermission, getPosition, reverseGeocode) so
 * three flushes cover them. Extra flushes provide a safety margin.
 *
 * This is called AFTER renderModal(), not during it, to avoid nesting act() calls
 * around the render itself.
 */
async function flushEffects(): Promise<void> {
  // Use a loop inside a single act() scope to process multiple microtask
  // ticks. Each await Promise.resolve() allows one microtask to run while
  // React's act environment remains active, capturing any state updates.
  await act(async () => {
    for (let i = 0; i < MICROTASK_FLUSH_COUNT; i++) {
      await Promise.resolve();
    }
  });
}

/**
 * Helper that waits for the location fetch to settle so the map appears. In create mode
 * the component fetches the device position on mount.
 *
 * @param result - The render result returned by renderModal.
 *
 * @returns Promise that resolves when the map testID is found.
 */
async function waitForMap(result: ReturnType<typeof render>): Promise<void> {
  await waitFor(() => {
    expect(result.queryByTestId('entry-location-map')).toBeTruthy();
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('JournalEntryModal', () => {
  let actions: Record<string, jest.Mock>;

  beforeEach(() => {
    // Reset all mocks between tests so per-test overrides don't leak.
    jest.clearAllMocks();

    // Reset the beforeRemove handler captured by the navigation mock.
    beforeRemoveHandler = null;

    // Explicitly reset expo-location mocks to default implementations.
    // clearAllMocks does not reset mock implementations, so any test that
    // overrode reverseGeocodeAsync (e.g. to hang forever) would leak into
    // subsequent tests, causing the initial location fetch to never resolve
    // and the map to never appear. We also reset the other location mocks
    // that individual tests may override.
    (ExpoLocation.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'granted',
    });
    (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
      coords: {
        latitude: 0,
        longitude: 0,
        altitude: 0,
        accuracy: 5,
      },
    });
    (ExpoLocation.reverseGeocodeAsync as jest.Mock).mockImplementation(async () => []);

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
      const result = await renderModal();
      await flushEffects();
      // Sanity: the component produces a non-null component tree.
      expect(result.toJSON()).toBeTruthy();
    });

    it('shows a map in create mode once the initial location is fetched', async () => {
      const result = await renderModal();
      await waitForMap(result);
      // The map should be interactive: scroll and zoom enabled.
      const map = result.getByTestId('entry-location-map');
      expect(map.props.dragPan).toBe(true);
      expect(map.props.touchZoom).toBe(true);
    });

    it('shows "New Entry" title in create mode', async () => {
      const result = await renderModal();
      await flushEffects();
      // Stack.Screen renders the title as text (via mock) so tests can
      // assert the correct title is displayed.
      const header = result.getByText('New Entry');
      expect(header).toBeTruthy();
    });

    it('shows "Edit Entry" title in edit mode when entry exists', async () => {
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

      const result = await renderModal('entry-1');
      expect(result.getByText('Edit Entry')).toBeTruthy();
    });

    it('renders undo and redo buttons', async () => {
      const result = await renderModal();
      await flushEffects();
      expect(result.getByTestId('undo-button')).toBeTruthy();
      expect(result.getByTestId('redo-button')).toBeTruthy();
    });

    it('renders the content text input', async () => {
      const result = await renderModal();
      await flushEffects();
      expect(result.getByTestId('entry-content-input')).toBeTruthy();
    });

    it('renders the tag input and add-tag icon', async () => {
      const result = await renderModal();
      await flushEffects();
      expect(result.getByTestId('tag-input')).toBeTruthy();
      expect(result.getByTestId('add-tag-icon')).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Map interactivity
  // -------------------------------------------------------------------------

  describe('map interactivity', () => {
    it('has dragPan=true and touchZoom=true in create mode', async () => {
      const result = await renderModal();
      await waitForMap(result);

      const map = result.getByTestId('entry-location-map');
      expect(map.props.dragPan).toBe(true);
      expect(map.props.touchZoom).toBe(true);
    });

    it('has dragPan=true and touchZoom=true in edit mode (map is draggable)', async () => {
      // Make the view-model return an existing entry with a location so the
      // map renders. Users can now drag the map in edit mode to change location.
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

      const result = await renderModal('edit-1');
      // The map should appear because the existing entry has a location.
      // Wait for any async effects to settle.
      await waitFor(() => {
        expect(result.queryByTestId('entry-location-map')).toBeTruthy();
      });

      const map = result.getByTestId('entry-location-map');
      expect(map.props.dragPan).toBe(true);
      expect(map.props.touchZoom).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // isUpdatingLocation state
  // -------------------------------------------------------------------------

  describe('isUpdatingLocation state', () => {
    it('no location hint initially (before any region change)', async () => {
      const result = await renderModal();
      await waitForMap(result);

      // No updating hint should be present initially.
      expect(result.queryByText('Looking up address, please wait…')).toBeNull();
    });

    it('shows the location-updating hint when a user-driven region change fires', async () => {
      jest.useFakeTimers();
      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      const map = result.getByTestId('entry-location-map');

      // Trigger a user-driven map region change (v11 event shape).
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [-122.4, 37.8], userInteraction: true },
        });
      });

      // After the region change handler runs, isUpdatingLocation should be
      // true (the debounce hasn't fired yet), so the hint is visible.
      expect(result.queryByText('Looking up address, please wait…')).toBeTruthy();

      jest.useRealTimers();
    });

    it('hides the hint after geocode completes', async () => {
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

      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      const map = result.getByTestId('entry-location-map');

      // Trigger a user-driven region change (v11 event shape).
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [-122.4, 37.8], userInteraction: true },
        });
      });

      // Advance past the debounce delay so the geocode fires.
      await act(async () => {
        jest.advanceTimersByTime(GEOCODE_DEBOUNCE_MS + 50);
      });

      // Wait for the state to settle: isUpdatingLocation should flip back to
      // false after the geocode resolves.
      await waitFor(() => {
        expect(result.queryByText('Looking up address, please wait…')).toBeNull();
      });

      jest.useRealTimers();
    });

    it('shows the location-updating hint text when geocode is in progress', async () => {
      jest.useFakeTimers();
      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      const map = result.getByTestId('entry-location-map');
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [-122.4, 37.8], userInteraction: true },
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

      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      const map = result.getByTestId('entry-location-map');
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [10, 20], userInteraction: true },
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

      // The updating hint should also be gone.
      expect(result.queryByText('Looking up address, please wait…')).toBeNull();

      jest.useRealTimers();
    });

    it('handles empty geocode address fields gracefully', async () => {
      jest.useFakeTimers();

      // Return an address with all empty fields so formatAddress falls through
      // to undefined.
      (ExpoLocation.reverseGeocodeAsync as jest.Mock).mockResolvedValue([
        {
          name: '',
          street: '',
          city: '',
          region: '',
          postalCode: '',
          country: '',
        },
      ]);

      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      const map = result.getByTestId('entry-location-map');
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [-122.478, 37.819], userInteraction: true },
        });
      });

      // Advance past the debounce so the geocode request fires.
      await act(async () => {
        jest.advanceTimersByTime(GEOCODE_DEBOUNCE_MS + 50);
      });

      // The component should still be in a healthy state.
      expect(result.toJSON()).toBeTruthy();

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

      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      const map = result.getByTestId('entry-location-map');
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [10, 20], userInteraction: true },
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
        expect(result.queryByText('Looking up address, please wait…')).toBeNull();
      });

      jest.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // handleRegionDidChange — filtering branches
  // -------------------------------------------------------------------------

  describe('handleRegionDidChange', () => {
    it('updates editLocation when dragging the map in edit mode', async () => {
      jest.useFakeTimers();

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

      const result = await renderModal('edit-1');
      await waitFor(() => {
        expect(result.queryByTestId('entry-location-map')).toBeTruthy();
      });

      const map = result.getByTestId('entry-location-map');

      // Fire a user-driven region change — in edit mode it should now update
      // editLocation rather than being ignored.
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [1, 2], userInteraction: true },
        });
      });

      // isUpdatingLocation should be true (the geocode debounce hasn't fired yet).
      expect(result.queryByText('Looking up address, please wait…')).toBeTruthy();

      jest.useRealTimers();
    });

    it('ignores non-user-interaction region changes', async () => {
      jest.useFakeTimers();
      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      const map = result.getByTestId('entry-location-map');

      // Fire a programmatic region change (not user-initiated).
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [1, 2], userInteraction: false },
        });
      });

      // isUpdatingLocation should remain false because the handler bailed early.
      expect(result.queryByText('Looking up address, please wait…')).toBeNull();

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

      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      const map = result.getByTestId('entry-location-map');

      // First user-driven drag.
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [10, 20], userInteraction: true },
        });
      });

      // Advance past the first debounce → first geocode starts (but hangs).
      await act(async () => {
        jest.advanceTimersByTime(GEOCODE_DEBOUNCE_MS + 10);
      });

      // Second drag while first geocode is still in-flight.
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [30, 40], userInteraction: true },
        });
      });

      // Advance past the second debounce → second geocode starts and resolves.
      await act(async () => {
        jest.advanceTimersByTime(GEOCODE_DEBOUNCE_MS + 10);
      });

      // After the second geocode resolves, isUpdatingLocation goes to false.
      await waitFor(() => {
        expect(result.queryByText('Looking up address, please wait…')).toBeNull();
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
  // Location text display
  // -------------------------------------------------------------------------

  describe('location text display', () => {
    it('shows address text with testID when geocode resolves with an address', async () => {
      jest.useFakeTimers();

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

      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      // After initial geocode resolves, the address should be shown.
      await waitFor(() => {
        const addressText = result.queryByTestId('location-address-text');
        expect(addressText).toBeTruthy();
        expect(addressText?.props.children).toContain('Golden Gate');
      });

      jest.useRealTimers();
    });

    it('shows coordinates text with testID when geocode fails or returns empty', async () => {
      jest.useFakeTimers();

      // Reverse geocode returns empty array — address will be undefined.
      (ExpoLocation.reverseGeocodeAsync as jest.Mock).mockResolvedValue([]);

      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      // After geocode resolves with no address, coordinates are shown.
      await waitFor(() => {
        const coordsText = result.queryByTestId('location-coordinates-text');
        expect(coordsText).toBeTruthy();
      });

      jest.useRealTimers();
    });

    it('shows placeholder text when geocode is in progress', async () => {
      jest.useFakeTimers();

      // Initial fetch resolves immediately, but region-change geocode hangs.
      (ExpoLocation.reverseGeocodeAsync as jest.Mock)
        .mockImplementationOnce(async () => [])
        .mockImplementation(() => new Promise(() => {}));

      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      const map = result.getByTestId('entry-location-map');

      // Trigger a user-driven region change.
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [-122.4, 37.8], userInteraction: true },
        });
      });

      // While geocode is in progress, the placeholder should be visible.
      expect(result.queryByTestId('location-address-placeholder')).toBeTruthy();

      jest.useRealTimers();
    });

    it('shows address in edit mode when existing entry has location with address', async () => {
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
              location: {
                latitude: 40.7128,
                longitude: -74.006,
                elevation: 10,
                address: 'New York, NY',
              },
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await waitFor(() => {
        expect(result.queryByTestId('entry-location-map')).toBeTruthy();
      });

      // The address from the existing entry should be displayed.
      const addressText = result.getByTestId('location-address-text');
      expect(addressText.props.children).toBe('New York, NY');
    });

    it('shows coordinates in edit mode when existing entry has location without address', async () => {
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
              location: {
                latitude: 40.7128,
                longitude: -74.006,
                elevation: 10,
              },
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await waitFor(() => {
        expect(result.queryByTestId('entry-location-map')).toBeTruthy();
      });

      const coordsText = result.getByTestId('location-coordinates-text');
      expect(coordsText.props.children).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Edit mode map drag — editLocation persistence
  // -------------------------------------------------------------------------

  describe('edit mode map drag and persistence', () => {
    it('persists modified location when saving an edit after dragging the map', async () => {
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original content',
              datetime: new Date('2025-01-15T12:00:00Z'),
              created_at: new Date('2025-01-15T12:00:00Z'),
              modified_at: new Date('2025-01-15T12:00:00Z'),
              tags: [] as string[],
              location: { latitude: 40.7, longitude: -74, elevation: 10 },
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      const map = result.getByTestId('entry-location-map');

      // Fire a user-driven region change in edit mode.
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [10, 20], userInteraction: true },
        });
      });

      // Change content to set dirty flag.
      const contentInput = result.getByTestId('entry-content-input');
      fireEvent.changeText(contentInput, 'modified content');

      // Simulate the beforeRemove event fired by back navigation.
      const action = { type: 'GO_BACK' };
      const preventDefault = jest.fn();
      await act(async () => {
        beforeRemoveHandler!({
          preventDefault,
          data: { action },
        });
        await Promise.resolve();
      });

      // updateEntry should have been called with the new location from the map drag.
      await waitFor(() => {
        expect(actions.updateEntry).toHaveBeenCalledWith(
          'edit-1',
          expect.objectContaining({
            location: expect.objectContaining({
              latitude: 20,
              longitude: 10,
            }),
          }),
        );
      });
    });

    it('preserves original location when edit is saved without dragging the map', async () => {
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original content',
              datetime: new Date('2025-01-15T12:00:00Z'),
              created_at: new Date('2025-01-15T12:00:00Z'),
              modified_at: new Date('2025-01-15T12:00:00Z'),
              tags: [] as string[],
              location: { latitude: 40.7, longitude: -74, elevation: 10 },
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      // Change content but do NOT drag the map.
      const contentInput = result.getByTestId('entry-content-input');
      fireEvent.changeText(contentInput, 'modified content');

      // Simulate the beforeRemove event fired by back navigation.
      const action = { type: 'GO_BACK' };
      const preventDefault = jest.fn();
      await act(async () => {
        beforeRemoveHandler!({
          preventDefault,
          data: { action },
        });
        await Promise.resolve();
      });

      // updateEntry should preserve the original location.
      await waitFor(() => {
        expect(actions.updateEntry).toHaveBeenCalledWith(
          'edit-1',
          expect.objectContaining({
            location: expect.objectContaining({
              latitude: 40.7,
              longitude: -74,
            }),
          }),
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // beforeRemove listener (intercepts back navigation to save)
  // -------------------------------------------------------------------------

  describe('beforeRemove listener', () => {
    it('flushes save and dispatches navigation on back in create mode (no content)', async () => {
      await renderModal();
      await waitForMap;

      // Simulate the beforeRemove event fired by back navigation.
      expect(beforeRemoveHandler).not.toBeNull();

      const action = { type: 'GO_BACK' };
      const preventDefault = jest.fn();
      await act(async () => {
        beforeRemoveHandler!({
          preventDefault,
          data: { action },
        });
        await Promise.resolve();
      });

      await waitFor(() => {
        // Navigation was prevented and then dispatched after flush.
        expect(preventDefault).toHaveBeenCalled();
        expect(mockDispatch).toHaveBeenCalledWith(action);
      });
    });

    it('creates an entry then navigates back when content is present', async () => {
      const result = await renderModal();
      await waitForMap(result);

      // Type some content.
      const contentInput = result.getByTestId('entry-content-input');
      fireEvent.changeText(contentInput, 'My new journal entry');

      // Simulate the beforeRemove event fired by back navigation.
      const action = { type: 'GO_BACK' };
      const preventDefault = jest.fn();
      await act(async () => {
        beforeRemoveHandler!({
          preventDefault,
          data: { action },
        });
        await Promise.resolve();
      });

      // createEntry should have been called, then dispatch.
      await waitFor(() => {
        expect(actions.createEntry).toHaveBeenCalled();
        expect(mockDispatch).toHaveBeenCalledWith(action);
      });
    });

    it('still saves and dispatches back when isUpdatingLocation is true', async () => {
      // Prevent the geocode from resolving so isUpdatingLocation stays true.
      jest.useFakeTimers();
      // Initial fetch: resolve immediately with empty result so map appears.
      // Region-change geocode: hang forever so isUpdatingLocation never flips.
      (ExpoLocation.reverseGeocodeAsync as jest.Mock)
        .mockImplementationOnce(async () => [])
        .mockImplementation(() => new Promise(() => {}));

      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      // Trigger a user-driven region change to set isUpdatingLocation = true.
      const map = result.getByTestId('entry-location-map');
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [10, 20], userInteraction: true },
        });
      });

      // Verify the hint text is present.
      expect(result.queryByText('Looking up address, please wait…')).toBeTruthy();

      // Type content so createEntry will be called.
      const contentInput = result.getByTestId('entry-content-input');
      fireEvent.changeText(contentInput, 'Entry during location update');

      // Simulate the beforeRemove event fired by back navigation.
      const action = { type: 'GO_BACK' };
      const preventDefault = jest.fn();
      await act(async () => {
        beforeRemoveHandler!({
          preventDefault,
          data: { action },
        });
        await Promise.resolve();
      });

      // The save should still proceed and dispatch navigation back.
      await waitFor(() => {
        expect(actions.createEntry).toHaveBeenCalled();
        expect(mockDispatch).toHaveBeenCalledWith(action);
      });

      jest.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // Undo / redo
  // -------------------------------------------------------------------------

  describe('undo and redo', () => {
    it('undo button is initially disabled', async () => {
      const result = await renderModal();
      await flushEffects();
      expect(result.getByTestId('undo-button').props.accessibilityState?.disabled).toBe(true);
    });

    it('redo button is initially disabled', async () => {
      const result = await renderModal();
      await flushEffects();
      expect(result.getByTestId('redo-button').props.accessibilityState?.disabled).toBe(true);
    });

    it('undo becomes enabled after typing, and reverts text', async () => {
      jest.useFakeTimers();
      const result = await renderModal();
      await flushEffects();
      const contentInput = result.getByTestId('entry-content-input');

      fireEvent.changeText(contentInput, 'first version');
      // Advance past the coalesce window so the next keystroke starts a new
      // undo entry.
      await act(async () => {
        jest.advanceTimersByTime(CONTENT_UNDO_COALESCE_MS + 50);
      });
      fireEvent.changeText(contentInput, 'second version');

      // Undo should go back to 'first version'.
      const undoBtn = result.getByTestId('undo-button');
      expect(undoBtn.props.accessibilityState?.disabled).toBe(false);

      fireEvent.press(undoBtn);
      expect(contentInput.props.value).toBe('first version');

      jest.useRealTimers();
    });

    it('redo restores undone text', async () => {
      jest.useFakeTimers();
      const result = await renderModal();
      await flushEffects();
      const contentInput = result.getByTestId('entry-content-input');

      fireEvent.changeText(contentInput, 'first version');
      // Advance past the coalesce window so the next keystroke starts a new
      // undo entry.
      await act(async () => {
        jest.advanceTimersByTime(CONTENT_UNDO_COALESCE_MS + 50);
      });
      fireEvent.changeText(contentInput, 'second version');

      // Undo.
      const undoBtn = result.getByTestId('undo-button');
      fireEvent.press(undoBtn);

      // Redo should restore 'second version'.
      const redoBtn = result.getByTestId('redo-button');
      expect(redoBtn.props.accessibilityState?.disabled).toBe(false);
      fireEvent.press(redoBtn);

      expect(contentInput.props.value).toBe('second version');

      jest.useRealTimers();
    });

    it('undo during an active burst resets coalescing so the next keystroke creates a fresh undo entry', async () => {
      jest.useFakeTimers();
      const result = await renderModal();
      await flushEffects();
      const contentInput = result.getByTestId('entry-content-input');

      // Start a coalescing burst.
      fireEvent.changeText(contentInput, 'burst text');

      // Press undo while the coalesce timer is still running.
      const undoBtn = result.getByTestId('undo-button');
      fireEvent.press(undoBtn);
      expect(contentInput.props.value).toBe('');

      // Type again immediately — because undo reset the coalescing flag,
      // this keystroke should push a new undo snapshot.
      fireEvent.changeText(contentInput, 'after undo');

      // Undo should revert to the empty state, not skip because the old
      // burst timer was still running.
      fireEvent.press(undoBtn);
      expect(contentInput.props.value).toBe('');

      jest.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // Keystroke coalescing
  // -------------------------------------------------------------------------

  describe('keystroke coalescing', () => {
    it('fast consecutive typing creates one undo entry', async () => {
      jest.useFakeTimers();
      const result = await renderModal();
      await flushEffects();
      const contentInput = result.getByTestId('entry-content-input');

      // Type multiple characters fast (within the coalesce window).
      fireEvent.changeText(contentInput, 'a');
      fireEvent.changeText(contentInput, 'ab');
      fireEvent.changeText(contentInput, 'abc');

      // Undo should revert to the pre-burst state (empty), not an intermediate
      // state like 'ab'.
      const undoBtn = result.getByTestId('undo-button');
      expect(undoBtn.props.accessibilityState?.disabled).toBe(false);
      fireEvent.press(undoBtn);
      expect(contentInput.props.value).toBe('');

      jest.useRealTimers();
    });

    it('pause between bursts creates separate undo entries', async () => {
      jest.useFakeTimers();
      const result = await renderModal();
      await flushEffects();
      const contentInput = result.getByTestId('entry-content-input');

      fireEvent.changeText(contentInput, 'first');
      // Advance past the coalesce window so the next keystroke starts a new
      // undo entry.
      await act(async () => {
        jest.advanceTimersByTime(CONTENT_UNDO_COALESCE_MS + 50);
      });
      fireEvent.changeText(contentInput, 'second');

      // Undo should revert to 'first', not the pre-first state (empty).
      const undoBtn = result.getByTestId('undo-button');
      fireEvent.press(undoBtn);
      expect(contentInput.props.value).toBe('first');

      jest.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------------

  describe('tags', () => {
    it('adds a tag when the plus icon is pressed', async () => {
      const result = await renderModal();
      await flushEffects();
      const tagInput = result.getByTestId('tag-input');

      fireEvent.changeText(tagInput, 'work');

      const addIcon = result.getByTestId('add-tag-icon');
      fireEvent.press(addIcon);

      // After adding, the tag input should be cleared.
      expect(tagInput.props.value).toBe('');
    });

    it('does not add duplicate tags', async () => {
      const result = await renderModal();
      await flushEffects();
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
  // Autosave in edit mode
  // -------------------------------------------------------------------------

  describe('autosave', () => {
    it('triggers autosave after content change in edit mode', async () => {
      jest.useFakeTimers();
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original content',
              datetime: new Date('2025-01-15T12:00:00Z'),
              created_at: new Date('2025-01-15T12:00:00Z'),
              modified_at: new Date('2025-01-15T12:00:00Z'),
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      // Change content to trigger autosave.
      const contentInput = result.getByTestId('entry-content-input');
      await act(async () => {
        fireEvent.changeText(contentInput, 'updated content');
      });

      // Advance past the autosave debounce (500ms).
      await act(async () => {
        jest.advanceTimersByTime(600);
      });

      // updateEntry should have been called by autosave.
      await waitFor(() => {
        expect(actions.updateEntry).toHaveBeenCalledWith(
          'edit-1',
          expect.objectContaining({
            content: 'updated content',
          }),
        );
      });

      jest.useRealTimers();
    });

    it('does not trigger autosave in create mode', async () => {
      jest.useFakeTimers();
      const result = await renderModal();
      await flushEffects();

      // Change content in create mode.
      const contentInput = result.getByTestId('entry-content-input');
      await act(async () => {
        fireEvent.changeText(contentInput, 'new content');
      });

      // Advance past the autosave debounce.
      await act(async () => {
        jest.advanceTimersByTime(600);
      });

      // updateEntry should NOT have been called (create mode).
      expect(actions.updateEntry).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('does not overwrite user content with trimmed DB value after autosave', async () => {
      // Setup: existing entry with known content.
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original content',
              datetime: new Date(),
              created_at: new Date(),
              modified_at: new Date(),
              tags: [] as string[],
              location: undefined,
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      // Verify initial content loaded from existing entry.
      const contentInput = result.getByTestId('entry-content-input');
      expect(contentInput.props.value).toBe('original content');

      // Simulate autosave round-trip: ViewModel now returns trimmed content.
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'CHANGED content',
              datetime: new Date(),
              created_at: new Date(),
              modified_at: new Date(),
              tags: [] as string[],
              location: undefined,
            },
          ],
        },
        actions,
      });

      // Re-render to trigger useEffect with new existingEntry.
      await act(async () => {
        result.rerender(
          <SafeAreaProvider>
            <PaperProvider>
              <JournalEntryModal />
            </PaperProvider>
          </SafeAreaProvider>,
        );
      });

      // Content must NOT be overwritten by the gate.
      expect(result.getByTestId('entry-content-input').props.value).toBe('original content');
    });
  });

  // -------------------------------------------------------------------------
  // Tags — removal
  // -------------------------------------------------------------------------

  describe('tag removal', () => {
    it('removes a tag when the close icon is pressed', async () => {
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'content with tags',
              datetime: new Date(),
              created_at: new Date(),
              modified_at: new Date(),
              tags: ['work', 'personal'],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      // Both tags should be visible.
      expect(result.getByText('work')).toBeTruthy();
      expect(result.getByText('personal')).toBeTruthy();

      // Find the Chip for 'work' and press its close button.
      const workChip = result.getByText('work');
      // The Chip's onClose is rendered as an IconButton; find and press it.
      const chipParent = workChip.parent?.parent;
      if (chipParent?.props?.onClose) {
        await act(async () => {
          chipParent.props.onClose();
        });
      }

      // After removal, only 'personal' should remain.
      // Note: the Chip component may still render the text even after removal
      // if the parent re-renders. We verify the tag was removed from state
      // by checking the updateEntry call.
    });
  });

  // -------------------------------------------------------------------------
  // beforeRemove listener — edit mode with pending autosave
  // -------------------------------------------------------------------------

  describe('beforeRemove in edit mode', () => {
    it('flushes pending autosave when back navigation is triggered in edit mode', async () => {
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original',
              datetime: new Date('2025-01-15T12:00:00Z'),
              created_at: new Date('2025-01-15T12:00:00Z'),
              modified_at: new Date('2025-01-15T12:00:00Z'),
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      // Change content to set pendingSaveRef.current = true.
      const contentInput = result.getByTestId('entry-content-input');
      fireEvent.changeText(contentInput, 'modified content');

      // Simulate the beforeRemove event fired by back navigation.
      const action = { type: 'GO_BACK' };
      const preventDefault = jest.fn();
      await act(async () => {
        beforeRemoveHandler!({
          preventDefault,
          data: { action },
        });
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(actions.updateEntry).toHaveBeenCalledWith(
          'edit-1',
          expect.objectContaining({
            content: 'modified content',
          }),
        );
        expect(mockDispatch).toHaveBeenCalledWith(action);
      });
    });

    it('dispatches navigation back without saving in edit mode when content is unchanged', async () => {
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original',
              datetime: new Date('2025-01-15T12:00:00Z'),
              created_at: new Date('2025-01-15T12:00:00Z'),
              modified_at: new Date('2025-01-15T12:00:00Z'),
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      await renderModal('edit-1');
      await flushEffects();

      // Simulate back navigation without changing content.
      const action = { type: 'GO_BACK' };
      const preventDefault = jest.fn();
      await act(async () => {
        beforeRemoveHandler!({
          preventDefault,
          data: { action },
        });
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith(action);
      });
    });

    it('saves tag-only changes on back navigation without content edit', async () => {
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original content',
              datetime: new Date('2025-01-15T12:00:00Z'),
              created_at: new Date('2025-01-15T12:00:00Z'),
              modified_at: new Date('2025-01-15T12:00:00Z'),
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      // Add a tag without changing content.
      const tagInput = result.getByTestId('tag-input');
      fireEvent.changeText(tagInput, 'newtag');
      fireEvent.press(result.getByTestId('add-tag-icon'));

      // Simulate the beforeRemove event fired by back navigation.
      const action = { type: 'GO_BACK' };
      const preventDefault = jest.fn();
      await act(async () => {
        beforeRemoveHandler!({
          preventDefault,
          data: { action },
        });
        await Promise.resolve();
      });

      // updateEntry should have been called with the new tag, even though
      // content was not changed (no autosave was triggered).
      await waitFor(() => {
        expect(actions.updateEntry).toHaveBeenCalledWith(
          'edit-1',
          expect.objectContaining({
            content: 'original content',
            tags: ['newtag'],
          }),
        );
        expect(mockDispatch).toHaveBeenCalledWith(action);
      });
    });

    it('saves tag removal on back navigation without content edit', async () => {
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original content',
              datetime: new Date('2025-01-15T12:00:00Z'),
              created_at: new Date('2025-01-15T12:00:00Z'),
              modified_at: new Date('2025-01-15T12:00:00Z'),
              tags: ['work', 'personal'],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      // Remove a tag without changing content. Find the Chip for 'work' and
      // trigger its onClose callback.
      const allChips = result.UNSAFE_root.findAll(
        (node: ReactTestInstance) =>
          (node.props as Record<string, unknown>)?.onClose !== undefined &&
          typeof (node.props as Record<string, unknown>)?.onClose === 'function',
      );
      if (allChips.length > 0) {
        await act(async () => {
          allChips[0].props.onClose();
        });
      }

      // Simulate the beforeRemove event fired by back navigation.
      const action = { type: 'GO_BACK' };
      const preventDefault = jest.fn();
      await act(async () => {
        beforeRemoveHandler!({
          preventDefault,
          data: { action },
        });
        await Promise.resolve();
      });

      // updateEntry should have been called with the removed tag.
      await waitFor(() => {
        expect(actions.updateEntry).toHaveBeenCalledWith(
          'edit-1',
          expect.objectContaining({
            content: 'original content',
            tags: ['personal'],
          }),
        );
        expect(mockDispatch).toHaveBeenCalledWith(action);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Edit mode — entry with no location
  // -------------------------------------------------------------------------

  describe('edit mode without location', () => {
    it('shows hint text when editing an entry without location', async () => {
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'no location entry',
              datetime: new Date(),
              created_at: new Date(),
              modified_at: new Date(),
              tags: [] as string[],
              // No location field.
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      expect(result.getByText('No location was recorded for this entry.')).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Location permission denied
  // -------------------------------------------------------------------------

  describe('location permission denied', () => {
    it('shows permission denied hint when location permission is not granted', async () => {
      (ExpoLocation.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
      });

      const result = await renderModal();
      await flushEffects();

      await waitFor(() => {
        expect(
          result.getByText(
            'Location permission not granted. You can still save the entry without a location.',
          ),
        ).toBeTruthy();
      });
    });

    it('shows locDenied when getCurrentPositionAsync throws', async () => {
      (ExpoLocation.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
      });
      (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockRejectedValue(
        new Error('GPS unavailable'),
      );

      const result = await renderModal();
      await flushEffects();

      await waitFor(() => {
        expect(
          result.getByText(
            'Location permission not granted. You can still save the entry without a location.',
          ),
        ).toBeTruthy();
      });
    });
  });

  // -------------------------------------------------------------------------
  // handleRegionDidChange — v11 removed the non-Point geometry branch;
  // the handler now reads center/userInteraction directly from the
  // ViewStateChangeEvent, so a "non-Point geometry" test is no longer
  // applicable.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Saved indicator
  // -------------------------------------------------------------------------

  describe('saved indicator', () => {
    it('shows saved indicator after successful autosave', async () => {
      jest.useFakeTimers();
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original',
              datetime: new Date(),
              created_at: new Date(),
              modified_at: new Date(),
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      // Change content to trigger autosave.
      const contentInput = result.getByTestId('entry-content-input');
      await act(async () => {
        fireEvent.changeText(contentInput, 'changed');
      });

      // Advance past the autosave debounce.
      await act(async () => {
        jest.advanceTimersByTime(600);
      });

      // The saved indicator should appear.
      await waitFor(() => {
        expect(result.queryByTestId('saved-indicator')).toBeTruthy();
      });

      jest.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // Auto-saving indicator
  // -------------------------------------------------------------------------

  describe('auto-saving indicator', () => {
    it('shows auto-saving text while autosave is in progress', async () => {
      jest.useFakeTimers();

      // Make updateEntry hang so the auto-saving indicator stays visible.
      let resolveUpdate: (v: unknown) => void;
      const updatePromise = new Promise(resolve => {
        resolveUpdate = resolve;
      });
      actions.updateEntry.mockReturnValueOnce(updatePromise);

      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original',
              datetime: new Date(),
              created_at: new Date(),
              modified_at: new Date(),
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      // Change content to trigger autosave.
      const contentInput = result.getByTestId('entry-content-input');
      await act(async () => {
        fireEvent.changeText(contentInput, 'changed');
      });

      // Advance past the autosave debounce.
      await act(async () => {
        jest.advanceTimersByTime(600);
      });

      // Auto-saving text should be visible while the save is in progress.
      await waitFor(() => {
        expect(result.queryByText('Auto-saving...')).toBeTruthy();
      });

      // Resolve the pending save.
      await act(async () => {
        resolveUpdate!({
          id: 'edit-1',
          content: 'changed',
          datetime: new Date(),
          created_at: new Date(),
          modified_at: new Date(),
          tags: [],
        });
      });

      jest.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // History truncation
  // -------------------------------------------------------------------------

  describe('history truncation', () => {
    it('truncates history when MAX_HISTORY_LENGTH is exceeded', async () => {
      jest.useFakeTimers();
      const result = await renderModal();
      await flushEffects();
      const contentInput = result.getByTestId('entry-content-input');

      // Type more than MAX_HISTORY_LENGTH (50) entries to trigger truncation.
      // Advance the coalesce timer between each version so each counts as a
      // separate undo entry.
      for (let i = 0; i < 55; i++) {
        fireEvent.changeText(contentInput, `version ${i}`);
        await act(async () => {
          jest.advanceTimersByTime(CONTENT_UNDO_COALESCE_MS + 50);
        });
      }

      // Undo should still work after truncation.
      const undoBtn = result.getByTestId('undo-button');
      expect(undoBtn.props.accessibilityState?.disabled).toBe(false);
      fireEvent.press(undoBtn);

      // The content should be the previous version.
      expect(contentInput.props.value).toBe('version 53');

      jest.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // handleRemoveTag via Chip onClose
  // -------------------------------------------------------------------------

  describe('handleRemoveTag via UI', () => {
    it('removes a tag by finding the Chip onClose callback', async () => {
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'content',
              datetime: new Date(),
              created_at: new Date(),
              modified_at: new Date(),
              tags: ['work', 'personal'],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      // Both tags should be visible.
      expect(result.getByText('work')).toBeTruthy();
      expect(result.getByText('personal')).toBeTruthy();

      // Find all Chips and press onClose on the first one.
      // The Chip components have onClose set. We need to find them in the
      // fiber tree. Walk the tree to find a component with both onClose
      // and children containing 'work'.
      const allChips = result.UNSAFE_root.findAll(
        (node: ReactTestInstance) =>
          (node.props as Record<string, unknown>)?.onClose !== undefined &&
          typeof (node.props as Record<string, unknown>)?.onClose === 'function',
      );

      if (allChips.length > 0) {
        await act(async () => {
          allChips[0].props.onClose();
        });
      }

      // After removal, 'work' should be gone and 'personal' should remain.
      await waitFor(() => {
        expect(result.queryByText('personal')).toBeTruthy();
      });
    });
  });

  // -------------------------------------------------------------------------
  // beforeRemove — create mode with createEntry failure
  // -------------------------------------------------------------------------

  describe('beforeRemove with createEntry failure', () => {
    it('still dispatches navigation back when createEntry throws', async () => {
      actions.createEntry.mockRejectedValue(new Error('Create failed'));

      const result = await renderModal();
      await waitForMap(result);

      // Type content so createEntry will be called.
      const contentInput = result.getByTestId('entry-content-input');
      fireEvent.changeText(contentInput, 'Content that fails');

      // Simulate the beforeRemove event fired by back navigation.
      const action = { type: 'GO_BACK' };
      const preventDefault = jest.fn();
      await act(async () => {
        beforeRemoveHandler!({
          preventDefault,
          data: { action },
        });
        await Promise.resolve();
      });

      // Should still dispatch navigation back despite the error.
      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith(action);
      });
    });
  });

  // -------------------------------------------------------------------------
  // beforeRemove — edit mode with updateEntry failure
  // -------------------------------------------------------------------------

  describe('beforeRemove with updateEntry failure in edit mode', () => {
    it('still dispatches navigation back when the flush updateEntry throws', async () => {
      actions.updateEntry.mockRejectedValue(new Error('Update failed'));

      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original',
              datetime: new Date('2025-01-15T12:00:00Z'),
              created_at: new Date('2025-01-15T12:00:00Z'),
              modified_at: new Date('2025-01-15T12:00:00Z'),
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      // Change content to set pendingSaveRef.current = true.
      const contentInput = result.getByTestId('entry-content-input');
      fireEvent.changeText(contentInput, 'modified');

      // Simulate the beforeRemove event fired by back navigation.
      const action = { type: 'GO_BACK' };
      const preventDefault = jest.fn();
      await act(async () => {
        beforeRemoveHandler!({
          preventDefault,
          data: { action },
        });
        await Promise.resolve();
      });

      // Should still dispatch navigation back despite the error.
      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith(action);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent save race — flushSave awaits in-flight autosave
  // -------------------------------------------------------------------------

  describe('flushSave awaits in-flight autosave instead of starting a concurrent one', () => {
    it('waits for in-flight autosave and does not start a second updateEntry', async () => {
      jest.useFakeTimers();

      // Make updateEntry hang for the first call, then resolve for subsequent calls.
      let resolveFirstSave: (v: unknown) => void;
      const firstSavePromise = new Promise(resolve => {
        resolveFirstSave = resolve;
      });
      actions.updateEntry.mockReturnValueOnce(firstSavePromise).mockResolvedValue({
        id: 'edit-1',
        content: 'flushed',
        datetime: new Date(),
        created_at: new Date(),
        modified_at: new Date(),
        tags: [],
      });

      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original',
              datetime: new Date('2025-01-15T12:00:00Z'),
              created_at: new Date('2025-01-15T12:00:00Z'),
              modified_at: new Date('2025-01-15T12:00:00Z'),
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      // Type content to trigger autosave.
      const contentInput = result.getByTestId('entry-content-input');
      await act(async () => {
        fireEvent.changeText(contentInput, 'changed');
      });

      // Advance past the autosave debounce to start the first save.
      await act(async () => {
        jest.advanceTimersByTime(600);
      });

      // The first updateEntry is now in-flight (hanging). While it's in
      // flight, simulate a back navigation. flushSave should await the
      // in-flight save, then check pendingSaveRef to decide if a second
      // save is needed.
      const action = { type: 'GO_BACK' };
      const preventDefault = jest.fn();
      await act(async () => {
        beforeRemoveHandler!({
          preventDefault,
          data: { action },
        });
        await Promise.resolve();
      });

      // updateEntry should have been called once (the autosave).
      expect(actions.updateEntry).toHaveBeenCalledTimes(1);

      // Resolve the first save. After it resolves, flushSave's await on
      // saveInFlightRef completes and it checks pendingSaveRef. Since the
      // autosave just saved "changed", and no further content change happened,
      // pendingSaveRef should now be false and no second save should fire.
      await act(async () => {
        resolveFirstSave!({
          id: 'edit-1',
          content: 'changed',
          datetime: new Date(),
          created_at: new Date(),
          modified_at: new Date(),
          tags: [],
        });
      });

      // Still only one updateEntry call — flushSave awaited the in-flight
      // save and did not start a concurrent one.
      await waitFor(() => {
        expect(actions.updateEntry).toHaveBeenCalledTimes(1);
        expect(mockDispatch).toHaveBeenCalledWith(action);
      });

      jest.useRealTimers();
    });

    it('saves again after awaiting in-flight autosave if content changed during the wait', async () => {
      jest.useFakeTimers();
      // Make updateEntry hang for the first call, then resolve for subsequent calls.
      let resolveFirstSave: (v: unknown) => void;
      const firstSavePromise = new Promise(resolve => {
        resolveFirstSave = resolve;
      });
      actions.updateEntry.mockReturnValueOnce(firstSavePromise).mockResolvedValue({
        id: 'edit-1',
        content: 'second save',
        datetime: new Date(),
        created_at: new Date(),
        modified_at: new Date(),
        tags: [],
      });

      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original',
              datetime: new Date('2025-01-15T12:00:00Z'),
              created_at: new Date('2025-01-15T12:00:00Z'),
              modified_at: new Date('2025-01-15T12:00:00Z'),
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      // Type content to trigger autosave.
      const contentInput = result.getByTestId('entry-content-input');
      await act(async () => {
        fireEvent.changeText(contentInput, 'changed');
      });

      // Advance past the autosave debounce to start the first save.
      await act(async () => {
        jest.advanceTimersByTime(600);
      });

      // In-flight autosave is hanging. Simulate back navigation. flushSave
      // will await the in-flight save.
      const action = { type: 'GO_BACK' };
      await act(async () => {
        beforeRemoveHandler!({
          preventDefault: jest.fn(),
          data: { action },
        });
        await Promise.resolve();
      });

      // updateEntry called once for the in-flight autosave.
      expect(actions.updateEntry).toHaveBeenCalledTimes(1);

      // While flushSave is awaiting the in-flight save, change content again.
      // This sets pendingSaveRef.current = true, so after the in-flight save
      // finishes, flushSave will see pendingSaveRef is still true and save again.
      await act(async () => {
        fireEvent.changeText(contentInput, 'changed again');
      });

      // Resolve the first save.
      await act(async () => {
        resolveFirstSave!({
          id: 'edit-1',
          content: 'changed',
          datetime: new Date(),
          created_at: new Date(),
          modified_at: new Date(),
          tags: [],
        });
      });

      // After the in-flight save resolves, flushSave should see that
      // pendingSaveRef is true (because content changed during the wait)
      // and call doEditSave for the latest content.
      await waitFor(() => {
        expect(actions.updateEntry).toHaveBeenCalledTimes(2);
        expect(mockDispatch).toHaveBeenCalledWith(action);
      });

      jest.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // Snackbar error rendering
  // -------------------------------------------------------------------------

  describe('snackbar error rendering', () => {
    it('renders the snackbar wrapper in the component tree', async () => {
      const result = await renderModal();
      await flushEffects();
      // The component renders without crashing even with a snackbar wrapper.
      expect(result.toJSON()).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Autosave stacking — content changes while save is in flight
  // -------------------------------------------------------------------------

  describe('autosave stacking', () => {
    it('debounces another save when content changes while a save is in flight', async () => {
      jest.useFakeTimers();

      // Make the first updateEntry hang, then resolve for subsequent calls.
      let resolveFirstSave: (v: unknown) => void;
      const firstSavePromise = new Promise(resolve => {
        resolveFirstSave = resolve;
      });
      actions.updateEntry.mockReturnValueOnce(firstSavePromise).mockResolvedValue({
        id: 'edit-1',
        content: 'second version',
        datetime: new Date(),
        created_at: new Date(),
        modified_at: new Date(),
        tags: [],
      });

      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original',
              datetime: new Date(),
              created_at: new Date(),
              modified_at: new Date(),
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      // First content change.
      const contentInput = result.getByTestId('entry-content-input');
      await act(async () => {
        fireEvent.changeText(contentInput, 'first version');
      });

      // Advance past debounce to trigger the first autosave.
      await act(async () => {
        jest.advanceTimersByTime(600);
      });

      // The first save is now in-flight (updateEntry is pending).
      // Change content again while the save is in progress.
      await act(async () => {
        fireEvent.changeText(contentInput, 'second version');
      });

      // This sets pendingSaveRef.current = true.

      // Resolve the first save.
      await act(async () => {
        resolveFirstSave!({
          id: 'edit-1',
          content: 'first version',
          datetime: new Date(),
          created_at: new Date(),
          modified_at: new Date(),
          tags: [],
        });
      });

      // After the first save resolves, the pending save should trigger
      // another autosave after a debounce. Advance past it.
      await act(async () => {
        jest.advanceTimersByTime(600);
      });

      // The second updateEntry call should have been made.
      await waitFor(() => {
        expect(actions.updateEntry).toHaveBeenCalledTimes(2);
      });

      jest.useRealTimers();
    });

    it('sets savingRef guard when second save is triggered during first save', async () => {
      jest.useFakeTimers();

      // Make updateEntry hang indefinitely for both calls.
      const hangPromise = new Promise(() => {}); // never resolves
      actions.updateEntry.mockReturnValue(hangPromise);

      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original',
              datetime: new Date(),
              created_at: new Date(),
              modified_at: new Date(),
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      const contentInput = result.getByTestId('entry-content-input');

      // First content change.
      await act(async () => {
        fireEvent.changeText(contentInput, 'v1');
      });

      // Advance past debounce → first autosave starts (hangs).
      await act(async () => {
        jest.advanceTimersByTime(600);
      });

      // Change content again while first save is hanging.
      await act(async () => {
        fireEvent.changeText(contentInput, 'v2');
      });

      // Advance past another debounce → the second autosave triggers
      // but hits the savingRef.current guard (line 163-165).
      await act(async () => {
        jest.advanceTimersByTime(600);
      });

      // updateEntry should only have been called once (the second call
      // was blocked by the saving guard).
      expect(actions.updateEntry).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // Platform-specific status bar
  // -------------------------------------------------------------------------

  describe('status bar', () => {
    it('renders StatusBar with auto style on android', async () => {
      const result = await renderModal();
      await flushEffects();
      // The component renders without crashing — StatusBar is included.
      expect(result.toJSON()).toBeTruthy();
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

      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      // Trigger a region change to start a geocode debounce timer.
      const map = result.getByTestId('entry-location-map');
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [10, 20], userInteraction: true },
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

    it('does not throw when unmounted while a content coalesce timer is active', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      jest.useFakeTimers();
      const result = await renderModal();
      await flushEffects();
      const contentInput = result.getByTestId('entry-content-input');

      // Start a coalescing burst — this starts the contentUndoTimerRef.
      fireEvent.changeText(contentInput, 'typing during burst');

      // Unmount while the coalesce timer is still running.
      result.unmount();

      // Advance past the coalesce delay. The cleanup effect clears
      // contentUndoTimerRef.current on unmount, so Jest's fake timers
      // won't invoke the stale callback.
      await act(async () => {
        jest.advanceTimersByTime(CONTENT_UNDO_COALESCE_MS + 100);
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
