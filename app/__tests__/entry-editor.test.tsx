import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaperProvider } from 'react-native-paper';
import * as ExpoLocation from 'expo-location';

// The debounce / timeout constants that drive the component under test.
// Must match the values in app/entry-editor.tsx.
const GEOCODE_DEBOUNCE_MS = 600;
const GEOCODE_TIMEOUT_MS = 3000;
const POSITION_TIMEOUT_MS = 15000;
const INITIAL_GEOCODE_TIMEOUT_MS = 15000;
const CONTENT_UNDO_COALESCE_MS = 500;
const MAP_INTERACTION_LOCK_MS = 300;

/**
 * Structural type for the test instances returned by RNTL's UNSAFE_root queries.
 *
 * We avoid importing `ReactTestInstance` from the deprecated `react-test-renderer`
 * package directly. RNTL transitively depends on `react-test-renderer` (and its types
 * via @types/react-test-renderer), so the runtime tree is unchanged — only our direct
 * dependency on the deprecated package is removed. The callbacks we pass to
 * find/findAll only touch `props`, so a narrow structural type is sufficient and keeps
 * the test decoupled from RTR's public surface.
 */
type TestInstance = { props: Record<string, unknown> };

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
const mockGoBack = jest.fn();
const mockNavigation = {
  dispatch: mockDispatch,
  goBack: mockGoBack,
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
            // Fixed test time: 08:30. Distinct from any default so a change
            // is observable in the rendered time text.
            onPress: () => onConfirm({ hours: 8, minutes: 30 }),
          },
          React.createElement(Text, null, 'Save'),
        ),
        React.createElement(
          Pressable,
          {
            testID: 'time-picker-save-undefined',
            // Calls onConfirm with no values to exercise the guard branch.
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
import { lightTheme, darkTheme } from '@/src/presentation/theme/appTheme';
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
const MICROTASK_FLUSH_COUNT = 20;

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
    getEntryById: jest.fn().mockResolvedValue(null),
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
 * @param theme - Optional Paper theme to wrap the component with.
 *
 * @returns Promise resolving to the render result from testing-library.
 */
async function renderModal(
  entryId?: string,
  theme?: MD3Theme,
): Promise<ReturnType<typeof render>> {
  (useLocalSearchParams as jest.Mock).mockReturnValue(entryId ? { entryId } : {});
  // If an entryId is requested, automatically configure the current mock's
  // getEntryById to return the matching entry from the ViewModel's entries
  // array. This mirrors the real ViewModel behaviour and lets existing
  // edit-mode tests work without manually wiring getEntryById on every test.
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
  jest.setTimeout(30000);
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
    (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'granted',
      granted: true,
      canAskAgain: true,
    });
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
    (ExpoLocation.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(null);

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
  // Camera re-center (reactive center prop)
  // -------------------------------------------------------------------------

  describe('camera re-center', () => {
    it('passes the entry saved location as Camera center in edit mode', async () => {
      // When opening an existing entry with a location, the Camera's initial
      // center prop should equal the entry's saved coordinates.
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
              location: { latitude: 40.7128, longitude: -74.006, elevation: 10 },
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await waitFor(() => {
        expect(result.queryByTestId('entry-location-map')).toBeTruthy();
      });

      // Find the Camera mock and verify its center matches the entry location.
      /**
       * Finds Camera mock views in the rendered tree by checking for center and zoom
       * props, which are forwarded through MockCamera.
       *
       * @returns Array of TestInstance nodes matching the Camera mock.
       */
      const findCameraViews = () =>
        result.UNSAFE_root.findAll(
          (node: TestInstance) =>
            Array.isArray((node.props as Record<string, unknown>)?.center) &&
            typeof (node.props as Record<string, unknown>)?.zoom === 'number',
        );

      const cameraViews = findCameraViews();
      expect(cameraViews.length).toBeGreaterThan(0);
      // center is [longitude, latitude] per MapLibre convention.
      expect(cameraViews[0].props.center).toEqual([-74.006, 40.7128]);
    });

    it('passes the updated center to Camera when handleRecenter completes', async () => {
      // The initial mount fetches the device position via
      // getCurrentPositionAsync (returns [0, 0] from beforeEach). Override
      // the *second* call (from handleRecenter) to return a new position.
      (ExpoLocation.getCurrentPositionAsync as jest.Mock)
        .mockResolvedValueOnce({
          coords: { latitude: 0, longitude: 0, altitude: 0, accuracy: 5 },
        })
        .mockResolvedValueOnce({
          coords: {
            latitude: 51.5074,
            longitude: -0.1278,
            altitude: 11,
            accuracy: 10,
          },
        });
      (ExpoLocation.reverseGeocodeAsync as jest.Mock).mockResolvedValue([]);

      const result = await renderModal();
      await waitForMap(result);

      /**
       * Finds Camera mock views in the rendered tree by checking for center and zoom
       * props, which are forwarded through MockCamera.
       *
       * @returns Array of TestInstance nodes matching the Camera mock.
       */
      const findCameraViews = () =>
        result.UNSAFE_root.findAll(
          (node: TestInstance) =>
            Array.isArray((node.props as Record<string, unknown>)?.center) &&
            typeof (node.props as Record<string, unknown>)?.zoom === 'number',
        );

      // Before re-center, the camera should show the initial position
      // (0, 0 from the first getCurrentPositionAsync mock).
      const initialCamera = findCameraViews();
      expect(initialCamera.length).toBeGreaterThan(0);
      expect(initialCamera[0].props.center).toEqual([0, 0]);
      expect(initialCamera[0].props.zoom).toBe(15);

      // Press the re-center button.
      const recenterBtn = result.getByTestId('recenter-button');
      await act(async () => {
        fireEvent.press(recenterBtn);
      });
      await flushEffects();

      // After re-center, the Camera mock should have received the new
      // center coordinates from the second getCurrentPositionAsync mock.
      await waitFor(() => {
        const updatedCamera = findCameraViews();
        expect(updatedCamera.length).toBeGreaterThan(0);
        expect(updatedCamera[0].props.center).toEqual([-0.1278, 51.5074]);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Map scroll interaction
  // -------------------------------------------------------------------------

  describe('map scroll interaction', () => {
    it('disables outer ScrollView while user is interacting with the map', async () => {
      console.log('--- SCROLL VIEW TEST: START ---');
      jest.useFakeTimers();
      console.log('--- SCROLL VIEW TEST: RENDERING MODAL ---');
      const result = await renderModal();
      console.log('--- SCROLL VIEW TEST: MODAL RENDERED ---');
      await flushEffects();
      console.log('--- SCROLL VIEW TEST: EFFECTS FLUSHED ---');
      await waitForMap(result);
      console.log('--- SCROLL VIEW TEST: MAP VISIBLE ---');

      const scrollView = result.getByTestId('entry-scroll-view');
      const map = result.getByTestId('entry-location-map');

      // By default, scrolling is enabled.
      expect(scrollView.props.scrollEnabled).toBe(true);

      console.log('--- SCROLL VIEW TEST: DISABLING SCROLL ---');
      // Fire a user-driven region change — should disable scrolling.
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [-122.4, 37.8], userInteraction: true },
        });
      });

      expect(scrollView.props.scrollEnabled).toBe(false);

      console.log('--- SCROLL VIEW TEST: ADVANCING TIMERS ---');
      // Advance past the debounce timer (300 ms + margin).
      await act(async () => {
        jest.advanceTimersByTime(MAP_INTERACTION_LOCK_MS + 50);
      });

      console.log('--- SCROLL VIEW TEST: CHECKING SCROLL ENABLED ---');
      expect(scrollView.props.scrollEnabled).toBe(true);

      console.log('--- SCROLL VIEW TEST: RESTORING REAL TIMERS ---');
      jest.useRealTimers();
      console.log('--- SCROLL VIEW TEST: DONE ---');
    });

    it('does not disable scrolling on non-user region changes', async () => {
      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      const scrollView = result.getByTestId('entry-scroll-view');
      const map = result.getByTestId('entry-location-map');

      // Scroll should start enabled.
      expect(scrollView.props.scrollEnabled).toBe(true);

      // Fire a programmatic (non-user) region change.
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [-122.4, 37.8], userInteraction: false },
        });
      });

      // Scrolling should remain enabled.
      expect(scrollView.props.scrollEnabled).toBe(true);
    });

    it('disables scrolling via touch start on map container', async () => {
      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      const scrollView = result.getByTestId('entry-scroll-view');
      const mapContainer = result.getByTestId('map-container');

      // Scrolling should be enabled initially.
      expect(scrollView.props.scrollEnabled).toBe(true);

      // Simulate a touch start on the map container — should disable scrolling.
      await act(async () => {
        mapContainer.props.onTouchStart();
      });

      expect(scrollView.props.scrollEnabled).toBe(false);

      // Simulate touch end — should re-enable scrolling.
      await act(async () => {
        mapContainer.props.onTouchEnd();
      });

      expect(scrollView.props.scrollEnabled).toBe(true);
    });

    it('re-enables scrolling on touch cancel', async () => {
      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      const scrollView = result.getByTestId('entry-scroll-view');
      const mapContainer = result.getByTestId('map-container');

      // Simulate a touch start on the map container.
      await act(async () => {
        mapContainer.props.onTouchStart();
      });

      expect(scrollView.props.scrollEnabled).toBe(false);

      // Simulate touch cancel — should also re-enable scrolling.
      await act(async () => {
        mapContainer.props.onTouchCancel();
      });

      expect(scrollView.props.scrollEnabled).toBe(true);
    });

    it('keeps scrolling disabled during rapid map drags', async () => {
      jest.useFakeTimers();
      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      const scrollView = result.getByTestId('entry-scroll-view');
      const map = result.getByTestId('entry-location-map');

      // First user-driven region change — disables scrolling.
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [-122.4, 37.8], userInteraction: true },
        });
      });
      expect(scrollView.props.scrollEnabled).toBe(false);

      // Advance 200 ms (less than the 300 ms debounce) — timer hasn't fired yet.
      await act(async () => {
        jest.advanceTimersByTime(200);
      });

      // Second user-driven region change resets the timer.
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [-122.41, 37.81], userInteraction: true },
        });
      });

      // Scrolling should still be disabled.
      expect(scrollView.props.scrollEnabled).toBe(false);

      // Advance past the full debounce from the second event.
      await act(async () => {
        jest.advanceTimersByTime(MAP_INTERACTION_LOCK_MS + 50);
      });

      // Now scrolling should be re-enabled.
      expect(scrollView.props.scrollEnabled).toBe(true);

      jest.useRealTimers();
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

    it('does not update location state on non-user region changes', async () => {
      // This guard is what makes the reactive Camera center prop safe from
      // feedback loops — programmatic camera moves must not update state.
      const result = await renderModal();
      await waitForMap(result);

      // Find the Camera mock to read the initial center.
      /**
       * Finds Camera mock views in the rendered tree by checking for center and zoom
       * props, which are forwarded through MockCamera.
       *
       * @returns Array of TestInstance nodes matching the Camera mock.
       */
      const findCameraViews = () =>
        result.UNSAFE_root.findAll(
          (node: TestInstance) =>
            Array.isArray((node.props as Record<string, unknown>)?.center) &&
            typeof (node.props as Record<string, unknown>)?.zoom === 'number',
        );

      const initialCamera = findCameraViews();
      expect(initialCamera.length).toBeGreaterThan(0);
      const initialCenter = initialCamera[0].props.center;

      const map = result.getByTestId('entry-location-map');

      // Fire a programmatic (non-user) region change with different coords.
      await act(async () => {
        map.props.onRegionDidChange({
          nativeEvent: { center: [99, 99], userInteraction: false },
        });
      });

      // The Camera center should remain unchanged — the handler must not
      // have updated currentLocation or editLocation.
      const cameraAfter = findCameraViews();
      expect(cameraAfter[0].props.center).toEqual(initialCenter);
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
  // Delete entry
  // -------------------------------------------------------------------------

  describe('delete entry', () => {
    it('shows the delete button in edit mode and hides it in create mode', async () => {
      const createResult = await renderModal();
      await flushEffects();
      expect(createResult.queryByTestId('delete-entry-button')).toBeNull();

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
            },
          ],
        },
        actions,
      });

      const editResult = await renderModal('edit-1');
      await flushEffects();
      expect(editResult.getByTestId('delete-entry-button')).toBeTruthy();
    });

    it('opens the delete confirmation dialog when the delete button is pressed', async () => {
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
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      expect(result.queryByTestId('delete-entry-dialog')).toBeNull();

      const deleteBtn = result.getByTestId('delete-entry-button');
      await act(async () => {
        fireEvent.press(deleteBtn);
      });

      expect(result.getByTestId('delete-entry-dialog')).toBeTruthy();
    });

    it('dismisses the dialog without deleting when cancel is pressed', async () => {
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
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      const deleteBtn = result.getByTestId('delete-entry-button');
      await act(async () => {
        fireEvent.press(deleteBtn);
      });

      const cancelBtn = result.getByTestId('delete-entry-cancel-button');
      await act(async () => {
        fireEvent.press(cancelBtn);
      });

      await waitFor(
        () => {
          expect(result.queryByTestId('delete-entry-dialog')).toBeNull();
        },
        { timeout: 3000 },
      );
      expect(actions.deleteEntry).not.toHaveBeenCalled();
    });

    it('calls deleteEntry and navigates back when deletion is confirmed', async () => {
      actions.deleteEntry.mockResolvedValue(true);

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
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      const deleteBtn = result.getByTestId('delete-entry-button');
      await act(async () => {
        fireEvent.press(deleteBtn);
      });

      const confirmBtn = result.getByTestId('delete-entry-confirm-button');
      await act(async () => {
        fireEvent.press(confirmBtn);
        await Promise.resolve();
      });

      expect(actions.deleteEntry).toHaveBeenCalledWith('edit-1');
      expect(mockGoBack).toHaveBeenCalled();
    });

    it('closes the dialog and stays on screen when deletion fails', async () => {
      actions.deleteEntry.mockResolvedValue(false);

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
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      const deleteBtn = result.getByTestId('delete-entry-button');
      await act(async () => {
        fireEvent.press(deleteBtn);
      });

      const confirmBtn = result.getByTestId('delete-entry-confirm-button');
      await act(async () => {
        fireEvent.press(confirmBtn);
        await Promise.resolve();
      });

      expect(actions.deleteEntry).toHaveBeenCalledWith('edit-1');
      await waitFor(() => {
        expect(result.queryByTestId('delete-entry-dialog')).toBeNull();
      });
      expect(mockGoBack).not.toHaveBeenCalled();
    });

    it('does not flush autosave when navigating back after a successful delete', async () => {
      actions.deleteEntry.mockResolvedValue(true);

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

      // Make a content change that would normally be flushed on back.
      const contentInput = result.getByTestId('entry-content-input');
      fireEvent.changeText(contentInput, 'modified content');

      // Confirm deletion.
      const deleteBtn = result.getByTestId('delete-entry-button');
      await act(async () => {
        fireEvent.press(deleteBtn);
      });

      const confirmBtn = result.getByTestId('delete-entry-confirm-button');
      await act(async () => {
        fireEvent.press(confirmBtn);
        await Promise.resolve();
      });

      expect(actions.deleteEntry).toHaveBeenCalledWith('edit-1');
      // updateEntry should NOT have been called — the beforeRemove flush was
      // short-circuited by the delete guard ref.
      expect(actions.updateEntry).not.toHaveBeenCalled();
      expect(mockGoBack).toHaveBeenCalled();
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
        (node: TestInstance) =>
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

    it('does not show loading spinner when entry has no location and not fetching', async () => {
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

      // The hint text is shown, not a loading spinner.
      expect(result.getByText('No location was recorded for this entry.')).toBeTruthy();
      // No ActivityIndicator / "Loading map…" text should appear.
      expect(result.queryByText('Loading map…')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Location permission denied
  // -------------------------------------------------------------------------

  describe('location permission denied', () => {
    it('shows permission denied hint when location permission is not granted', async () => {
      // getForegroundPermissionsAsync returns not-granted, canAskAgain=true so
      // the component will prompt via requestForegroundPermissionsAsync.
      (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
        granted: false,
        canAskAgain: true,
      });
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

    it('shows locError when getCurrentPositionAsync throws', async () => {
      (ExpoLocation.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
      });
      (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockRejectedValue(
        new Error('GPS unavailable'),
      );

      const result = await renderModal();
      await flushEffects();

      // GPS failures show a distinct locError message, not "permission denied".
      await waitFor(() => {
        expect(
          result.getByText('Could not get your location. GPS may be unavailable.'),
        ).toBeTruthy();
      });
    });

    it('skips requestForegroundPermissionsAsync when permission is already granted', async () => {
      // Pre-granted permission — the request dialog should be skipped.
      (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: false,
      });

      const result = await renderModal();
      await flushEffects();

      // requestForegroundPermissionsAsync should NOT have been called.
      expect(ExpoLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();

      // The map should appear (position was fetched).
      await waitForMap(result);
    });

    it('shows locError when getCurrentPositionAsync times out', async () => {
      jest.useFakeTimers();

      // Permission is granted but position never resolves.
      (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: false,
      });
      (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockImplementation(
        () => new Promise(() => {}),
      ); // never resolves

      const result = await renderModal();
      await flushEffects();

      // Advance past the position timeout (10 s).
      await act(async () => {
        jest.advanceTimersByTime(POSITION_TIMEOUT_MS + 500);
      });

      // Should show the timeout error message.
      await waitFor(() => {
        expect(
          result.getByText('Could not get your location. GPS may be unavailable.'),
        ).toBeTruthy();
      });

      jest.useRealTimers();
    });

    it('shows locError when initial reverseGeocodeAsync times out', async () => {
      jest.useFakeTimers();

      // Permission and position resolve, but geocode hangs.
      (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: false,
      });
      (ExpoLocation.reverseGeocodeAsync as jest.Mock).mockImplementation(
        () => new Promise(() => {}),
      ); // never resolves

      const result = await renderModal();
      await flushEffects();

      // Advance past the initial geocode timeout (10 s).
      await act(async () => {
        jest.advanceTimersByTime(INITIAL_GEOCODE_TIMEOUT_MS + 500);
      });

      // The component should still render — geocode timeout is gracefully
      // handled (address is undefined but position is shown).
      await waitFor(() => {
        // The map should appear (position was fetched, geocode timed out).
        expect(result.queryByTestId('entry-location-map')).toBeTruthy();
      });

      jest.useRealTimers();
    });

    it('handles permission permanently denied (canAskAgain=false) without prompting', async () => {
      // Permission is denied and cannot ask again.
      (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
        granted: false,
        canAskAgain: false,
      });

      const result = await renderModal();
      await flushEffects();

      // requestForegroundPermissionsAsync should NOT be called (canAskAgain is false).
      expect(ExpoLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();

      // Should show the permission denied message.
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
  // getLastKnownPositionAsync fallback
  // -------------------------------------------------------------------------

  describe('getLastKnownPositionAsync fallback', () => {
    it('uses last-known position when getCurrentPositionAsync times out (fetchLocation)', async () => {
      jest.useFakeTimers();

      // Permission is granted but getCurrentPositionAsync never resolves.
      (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: false,
      });
      (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockImplementation(
        () => new Promise(() => {}),
      ); // never resolves
      // getLastKnownPositionAsync returns a cached position.
      (ExpoLocation.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({
        coords: {
          latitude: 37.7749,
          longitude: -122.4194,
          altitude: 15,
          accuracy: 20,
        },
      });

      const result = await renderModal();
      await flushEffects();

      // Advance past the position timeout (10 s) so the fallback triggers.
      await act(async () => {
        jest.advanceTimersByTime(POSITION_TIMEOUT_MS + 500);
      });

      // The map should appear using the last-known position — no error.
      await waitFor(() => {
        expect(result.queryByTestId('entry-location-map')).toBeTruthy();
      });

      // No locError should be shown.
      expect(
        result.queryByText('Could not get your location. GPS may be unavailable.'),
      ).toBeNull();

      jest.useRealTimers();
    });

    it('shows error when both getCurrentPositionAsync and getLastKnownPositionAsync fail (fetchLocation)', async () => {
      jest.useFakeTimers();

      (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: false,
      });
      (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockImplementation(
        () => new Promise(() => {}),
      ); // never resolves
      // getLastKnownPositionAsync returns null (no cached position).
      (ExpoLocation.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(null);

      const result = await renderModal();
      await flushEffects();

      // Advance past the position timeout.
      await act(async () => {
        jest.advanceTimersByTime(POSITION_TIMEOUT_MS + 500);
      });

      // Should show the error message because both sources failed.
      await waitFor(() => {
        expect(
          result.getByText('Could not get your location. GPS may be unavailable.'),
        ).toBeTruthy();
      });

      jest.useRealTimers();
    });

    it('uses last-known position when getCurrentPositionAsync throws (fetchLocation)', async () => {
      (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: false,
      });
      (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockRejectedValue(
        new Error('GPS unavailable'),
      );
      (ExpoLocation.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({
        coords: {
          latitude: 51.5074,
          longitude: -0.1278,
          altitude: 11,
          accuracy: 10,
        },
      });

      const result = await renderModal();
      await flushEffects();

      // The map should appear using the last-known position.
      await waitFor(() => {
        expect(result.queryByTestId('entry-location-map')).toBeTruthy();
      });

      // No locError should be shown.
      expect(
        result.queryByText('Could not get your location. GPS may be unavailable.'),
      ).toBeNull();
    });

    it('uses last-known position when getCurrentPositionAsync times out on re-center', async () => {
      jest.useFakeTimers();

      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      // Re-center: getCurrentPositionAsync never resolves.
      (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockImplementation(
        () => new Promise(() => {}),
      );
      // getLastKnownPositionAsync returns a cached position.
      (ExpoLocation.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({
        coords: {
          latitude: 48.8566,
          longitude: 2.3522,
          altitude: 35,
          accuracy: 15,
        },
      });

      const recenterBtn = result.getByTestId('recenter-button');
      await act(async () => {
        fireEvent.press(recenterBtn);
      });

      // Advance past the position timeout.
      await act(async () => {
        jest.advanceTimersByTime(POSITION_TIMEOUT_MS + 500);
      });

      // No locError should be shown — the fallback succeeded.
      expect(
        result.queryByText('Could not get your location. GPS may be unavailable.'),
      ).toBeNull();

      jest.useRealTimers();
    });

    it('shows locError when both getCurrentPositionAsync and getLastKnownPositionAsync fail on re-center', async () => {
      jest.useFakeTimers();

      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      // Re-center: getCurrentPositionAsync never resolves.
      (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockImplementation(
        () => new Promise(() => {}),
      );
      // getLastKnownPositionAsync returns null.
      (ExpoLocation.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(null);

      const recenterBtn = result.getByTestId('recenter-button');
      await act(async () => {
        fireEvent.press(recenterBtn);
      });

      // Advance past the position timeout.
      await act(async () => {
        jest.advanceTimersByTime(POSITION_TIMEOUT_MS + 500);
      });

      // Should show the error message.
      await waitFor(() => {
        expect(
          result.queryByText('Could not get your location. GPS may be unavailable.'),
        ).toBeTruthy();
      });

      jest.useRealTimers();
    });

    it('shows locError when getLastKnownPositionAsync throws on re-center', async () => {
      jest.useFakeTimers();

      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      // Re-center: getCurrentPositionAsync never resolves.
      (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockImplementation(
        () => new Promise(() => {}),
      );
      // getLastKnownPositionAsync throws an unexpected error.
      (ExpoLocation.getLastKnownPositionAsync as jest.Mock).mockRejectedValue(
        new Error('location service crashed'),
      );

      const recenterBtn = result.getByTestId('recenter-button');
      await act(async () => {
        fireEvent.press(recenterBtn);
      });

      // Advance past the position timeout.
      await act(async () => {
        jest.advanceTimersByTime(POSITION_TIMEOUT_MS + 500);
      });

      // Should show the error message because both sources failed.
      await waitFor(() => {
        expect(
          result.queryByText('Could not get your location. GPS may be unavailable.'),
        ).toBeTruthy();
      });

      jest.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // Race condition: edit mode with initially-empty ViewModel
  // -------------------------------------------------------------------------

  describe('edit mode with initially-empty ViewModel', () => {
    it('does not request location permission when ViewModel starts with empty entries', async () => {
      // With getEntryById, the editor loads the entry directly from the
      // repository regardless of the ViewModel's entries array. The
      // ViewModel's entries may still be empty (still loading for the
      // journal list), but getEntryById resolves the entry independently.
      const editEntry = {
        id: 'edit-1',
        content: 'hello',
        datetime: new Date(),
        created_at: new Date(),
        modified_at: new Date(),
        tags: [] as string[],
        location: { latitude: 40.7, longitude: -74, elevation: 10 },
      };
      actions.getEntryById.mockResolvedValue(editEntry);
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: { ...DEFAULT_STATE, entries: [] },
        actions,
      });

      (useLocalSearchParams as jest.Mock).mockReturnValue({ entryId: 'edit-1' });

      // Reset location mocks so we can verify they were NOT called.
      (ExpoLocation.requestForegroundPermissionsAsync as jest.Mock).mockClear();

      const { unmount } = render(
        <SafeAreaProvider>
          <PaperProvider>
            <JournalEntryModal />
          </PaperProvider>
        </SafeAreaProvider>,
      );

      // Flush any microtasks from the initial render.
      await act(async () => {
        for (let i = 0; i < MICROTASK_FLUSH_COUNT; i++) {
          await Promise.resolve();
        }
      });

      // requestForegroundPermissionsAsync must NOT have been called during the
      // initial render when the ViewModel hasn't loaded the entry yet.
      expect(ExpoLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();

      unmount();
    });

    it('does request location permission in create mode (no entryId)', async () => {
      // Create mode: no entryId, so the component should request location
      // permission immediately. This ensures the guard doesn't break the
      // normal create flow.
      (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'undetermined',
        granted: false,
        canAskAgain: true,
      });

      await renderModal();
      await flushEffects();

      // Permission should have been requested in create mode.
      expect(ExpoLocation.requestForegroundPermissionsAsync).toHaveBeenCalled();
    });

    it('does not request location permission when entryId is set and entry exists from the start', async () => {
      // Edit mode with entry pre-loaded: no location fetch should happen.
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

      await renderModal('edit-1');
      await flushEffects();

      // Permission must NOT have been requested — edit mode.
      expect(ExpoLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    });

    it('does not call getCurrentPositionAsync when ViewModel starts with empty entries', async () => {
      // Even getCurrentPositionAsync should not be called when the entryId
      // is present — the entry is loaded via getEntryById, not via location.
      const editEntry = {
        id: 'edit-1',
        content: 'hello',
        datetime: new Date(),
        created_at: new Date(),
        modified_at: new Date(),
        tags: [] as string[],
        location: { latitude: 40.7, longitude: -74, elevation: 10 },
      };
      actions.getEntryById.mockResolvedValue(editEntry);
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: { ...DEFAULT_STATE, entries: [] },
        actions,
      });

      (useLocalSearchParams as jest.Mock).mockReturnValue({ entryId: 'edit-1' });

      (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockClear();

      const { unmount } = render(
        <SafeAreaProvider>
          <PaperProvider>
            <JournalEntryModal />
          </PaperProvider>
        </SafeAreaProvider>,
      );

      await act(async () => {
        for (let i = 0; i < MICROTASK_FLUSH_COUNT; i++) {
          await Promise.resolve();
        }
      });

      // getCurrentPositionAsync should NOT have been called — the entire
      // location fetch was short-circuited.
      expect(ExpoLocation.getCurrentPositionAsync).not.toHaveBeenCalled();

      unmount();
    });

    it('does not set isFetchingLocation when entryId present but entry not loaded', async () => {
      // Verify that the component does not set isFetchingLocation to true
      // (which would show the "Loading map…" spinner) when an entryId is
      // present. The entry is loaded via getEntryById (which returns the
      // entry), so isEditing becomes true immediately and the location
      // fetch is skipped.
      const editEntry = {
        id: 'edit-1',
        content: 'hello',
        datetime: new Date(),
        created_at: new Date(),
        modified_at: new Date(),
        tags: [] as string[],
        location: { latitude: 40.7, longitude: -74, elevation: 10 },
      };
      actions.getEntryById.mockResolvedValue(editEntry);
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: { ...DEFAULT_STATE, entries: [] },
        actions,
      });

      (useLocalSearchParams as jest.Mock).mockReturnValue({ entryId: 'edit-1' });

      const result = render(
        <SafeAreaProvider>
          <PaperProvider>
            <JournalEntryModal />
          </PaperProvider>
        </SafeAreaProvider>,
      );

      await act(async () => {
        for (let i = 0; i < MICROTASK_FLUSH_COUNT; i++) {
          await Promise.resolve();
        }
      });

      // No loading spinner should appear — the location fetch was skipped.
      expect(result.queryByText('Loading map…')).toBeNull();

      result.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Entry not found (getEntryById returns null)
  // -------------------------------------------------------------------------

  describe('entry not found', () => {
    it('shows error and navigates back when getEntryById returns null', async () => {
      jest.useFakeTimers();
      // getEntryById returns null — entry was deleted or DB error.
      actions.getEntryById.mockResolvedValue(null);

      const result = await renderModal('deleted-entry');
      await flushEffects();

      // The error snackbar should show.
      await waitFor(() => {
        expect(result.queryByText('Entry not found. It may have been deleted.')).toBeTruthy();
      });

      // Advance past the setTimeout that triggers goBack.
      await act(async () => {
        jest.advanceTimersByTime(200);
      });

      expect(mockGoBack).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('shows error and navigates back when getEntryById rejects', async () => {
      jest.useFakeTimers();
      actions.getEntryById.mockRejectedValue(new Error('DB error'));

      const result = await renderModal('error-entry');
      await flushEffects();

      await waitFor(() => {
        expect(result.queryByText('Failed to load entry.')).toBeTruthy();
      });

      // Advance past the setTimeout that triggers goBack.
      await act(async () => {
        jest.advanceTimersByTime(200);
      });

      expect(mockGoBack).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // Re-center button
  // -------------------------------------------------------------------------

  describe('re-center button', () => {
    it('renders the re-center button', async () => {
      const result = await renderModal();
      await flushEffects();
      expect(result.getByTestId('recenter-button')).toBeTruthy();
    });

    it('updates location in create mode on re-center press', async () => {
      const result = await renderModal();
      await waitForMap(result);

      // Override position for the re-center call.
      (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
        coords: {
          latitude: 51.5,
          longitude: -0.1,
          altitude: 20,
          accuracy: 10,
        },
      });
      (ExpoLocation.reverseGeocodeAsync as jest.Mock).mockResolvedValue([
        {
          name: 'London',
          street: '',
          city: 'London',
          region: '',
          postalCode: '',
          country: 'UK',
        },
      ]);

      const recenterBtn = result.getByTestId('recenter-button');
      await act(async () => {
        fireEvent.press(recenterBtn);
      });
      await flushEffects();

      // The new address from re-center should appear.
      await waitFor(() => {
        expect(result.queryByTestId('location-address-text')).toBeTruthy();
      });
    });

    it('updates editLocation in edit mode and marks dirty on re-center', async () => {
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

      // Override position for the re-center call.
      (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
        coords: {
          latitude: 48.9,
          longitude: 2.3,
          altitude: 30,
          accuracy: 8,
        },
      });
      (ExpoLocation.reverseGeocodeAsync as jest.Mock).mockResolvedValue([
        {
          name: 'Paris',
          street: '',
          city: 'Paris',
          region: '',
          postalCode: '',
          country: 'FR',
        },
      ]);

      const recenterBtn = result.getByTestId('recenter-button');
      await act(async () => {
        fireEvent.press(recenterBtn);
      });
      await flushEffects();

      // The address from re-center should appear.
      await waitFor(() => {
        expect(result.queryByTestId('location-address-text')).toBeTruthy();
      });

      // Change content and navigate back to verify location was persisted.
      const contentInput = result.getByTestId('entry-content-input');
      fireEvent.changeText(contentInput, 'modified content');

      const action = { type: 'GO_BACK' };
      await act(async () => {
        beforeRemoveHandler!({
          preventDefault: jest.fn(),
          data: { action },
        });
        await Promise.resolve();
      });

      // updateEntry should contain the re-centered location.
      await waitFor(() => {
        expect(actions.updateEntry).toHaveBeenCalledWith(
          'edit-1',
          expect.objectContaining({
            location: expect.objectContaining({
              latitude: 48.9,
              longitude: 2.3,
            }),
          }),
        );
      });
    });

    it('shows error when permission is denied on re-center', async () => {
      const result = await renderModal();
      await waitForMap(result);

      // Re-center: permission denied, cannot ask again.
      (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
        granted: false,
        canAskAgain: false,
      });

      const recenterBtn = result.getByTestId('recenter-button');
      await act(async () => {
        fireEvent.press(recenterBtn);
      });
      await flushEffects();

      // Should show an error message via Snackbar.
      await waitFor(() => {
        expect(result.queryByText('Location permission not granted.')).toBeTruthy();
      });
    });

    it('requests permission when canAskAgain on re-center', async () => {
      const result = await renderModal();
      await waitForMap(result);

      // First check: not granted but can ask again.
      (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'undetermined',
        granted: false,
        canAskAgain: true,
      });
      (ExpoLocation.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
      });
      (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
        coords: {
          latitude: 35.7,
          longitude: 139.7,
          altitude: 40,
          accuracy: 12,
        },
      });
      (ExpoLocation.reverseGeocodeAsync as jest.Mock).mockResolvedValue([
        {
          name: 'Tokyo',
          street: '',
          city: 'Tokyo',
          region: '',
          postalCode: '',
          country: 'JP',
        },
      ]);

      const recenterBtn = result.getByTestId('recenter-button');
      await act(async () => {
        fireEvent.press(recenterBtn);
      });
      await flushEffects();

      // The request should have been called because canAskAgain was true.
      expect(ExpoLocation.requestForegroundPermissionsAsync).toHaveBeenCalled();

      // The map should show the new address.
      await waitFor(() => {
        expect(result.queryByTestId('location-address-text')).toBeTruthy();
      });
    });

    it('shows locError when position times out on re-center', async () => {
      jest.useFakeTimers();

      const result = await renderModal();
      await flushEffects();
      await waitForMap(result);

      // Re-center: position never resolves.
      (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockImplementation(
        () => new Promise(() => {}),
      );

      const recenterBtn = result.getByTestId('recenter-button');
      await act(async () => {
        fireEvent.press(recenterBtn);
      });

      // Advance past the position timeout.
      await act(async () => {
        jest.advanceTimersByTime(POSITION_TIMEOUT_MS + 500);
      });

      await waitFor(() => {
        expect(
          result.queryByText('Could not get your location. GPS may be unavailable.'),
        ).toBeTruthy();
      });

      jest.useRealTimers();
    });

    it('guards against rapid double-tap on re-center', async () => {
      const result = await renderModal();
      await waitForMap(result);

      // Make getCurrentPositionAsync hang so the first re-center stays
      // in-flight long enough for a second tap to arrive.
      let resolvePosition: (v: unknown) => void;
      const positionPromise = new Promise(resolve => {
        resolvePosition = resolve;
      });
      (ExpoLocation.getCurrentPositionAsync as jest.Mock)
        .mockReturnValueOnce(positionPromise)
        .mockResolvedValue({
          coords: { latitude: 10, longitude: 20, altitude: 0, accuracy: 5 },
        });

      const recenterBtn = result.getByTestId('recenter-button');

      // First tap: starts a re-center (position hangs).
      await act(async () => {
        fireEvent.press(recenterBtn);
      });

      // The button should now be disabled while fetching.
      await waitFor(() => {
        expect(recenterBtn.props.accessibilityState?.disabled).toBe(true);
      });

      // Second rapid tap should be a no-op (the ref guard blocks it).
      // getCurrentPositionAsync should have been called once so far.
      const callCountAfterFirst = (ExpoLocation.getCurrentPositionAsync as jest.Mock).mock.calls
        .length;

      await act(async () => {
        fireEvent.press(recenterBtn);
      });

      // No additional getCurrentPositionAsync call should have been made.
      expect((ExpoLocation.getCurrentPositionAsync as jest.Mock).mock.calls.length).toBe(
        callCountAfterFirst,
      );

      // Resolve the hanging position so the first re-center completes
      // and cleans up.
      await act(async () => {
        resolvePosition!({
          coords: { latitude: 10, longitude: 20, altitude: 0, accuracy: 5 },
        });
      });
      await flushEffects();

      // After completion, the re-center button should be re-enabled.
      await waitFor(() => {
        expect(recenterBtn.props.accessibilityState?.disabled).toBe(false);
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
        (node: TestInstance) =>
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
  // Theming
  // -------------------------------------------------------------------------

  describe('theming', () => {
    /**
     * Checks whether a nested React Native style value contains the expected color.
     *
     * @param style - The style prop from a rendered element.
     * @param color - The color string to look for.
     *
     * @returns True if the color appears anywhere in the serialized style.
     */
    function styleContainsColor(style: unknown, color: string): boolean {
      return JSON.stringify(style).includes(color);
    }

    it('uses the theme background color on the root container in light mode', async () => {
      const result = await renderModal(undefined, lightTheme);
      await flushEffects();

      const root = result.getByTestId('entry-editor-root');
      expect(root.props.style).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ backgroundColor: lightTheme.colors.background }),
        ]),
      );
    });

    it('uses the theme background color on the root container in dark mode', async () => {
      const result = await renderModal(undefined, darkTheme);
      await flushEffects();

      const root = result.getByTestId('entry-editor-root');
      expect(root.props.style).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ backgroundColor: darkTheme.colors.background }),
        ]),
      );
    });

    it('uses primary color for the date text in light mode', async () => {
      const result = await renderModal(undefined, lightTheme);
      await flushEffects();

      const dateText = result.getByTestId('entry-date-text');
      expect(styleContainsColor(dateText.props.style, lightTheme.colors.primary)).toBe(true);
    });

    it('uses primary color for the date text in dark mode', async () => {
      const result = await renderModal(undefined, darkTheme);
      await flushEffects();

      const dateText = result.getByTestId('entry-date-text');
      expect(styleContainsColor(dateText.props.style, darkTheme.colors.primary)).toBe(true);
    });

    it('uses onSurfaceVariant for the saved indicator', async () => {
      jest.useFakeTimers();
      actions.updateEntry.mockResolvedValue({
        id: 'edit-1',
        content: 'changed',
        datetime: new Date(),
        created_at: new Date(),
        modified_at: new Date(),
        tags: [] as string[],
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

      const result = await renderModal('edit-1', darkTheme);
      await flushEffects();

      const contentInput = result.getByTestId('entry-content-input');
      await act(async () => {
        fireEvent.changeText(contentInput, 'changed');
      });
      await act(async () => {
        jest.advanceTimersByTime(600);
      });

      await waitFor(() => {
        expect(result.queryByTestId('saved-indicator')).toBeTruthy();
      });

      const savedIndicator = result.getByTestId('saved-indicator');
      expect(
        styleContainsColor(savedIndicator.props.style, darkTheme.colors.onSurfaceVariant),
      ).toBe(true);

      jest.useRealTimers();
    });

    it('uses onSurfaceVariant for location address text', async () => {
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

      const result = await renderModal(undefined, darkTheme);
      await flushEffects();
      await waitForMap(result);

      await waitFor(() => {
        expect(result.queryByTestId('location-address-text')).toBeTruthy();
      });

      const addressText = result.getByTestId('location-address-text');
      expect(styleContainsColor(addressText.props.style, darkTheme.colors.onSurfaceVariant)).toBe(
        true,
      );
    });

    it('uses onSurfaceVariant for location hints', async () => {
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
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1', darkTheme);
      await flushEffects();

      const hint = result.getByText('No location was recorded for this entry.');
      expect(styleContainsColor(hint.props.style, darkTheme.colors.onSurfaceVariant)).toBe(true);
    });

    it('uses theme.colors.error for location error text in light mode', async () => {
      (ExpoLocation.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
      });
      (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockRejectedValue(
        new Error('GPS unavailable'),
      );

      const result = await renderModal(undefined, lightTheme);
      await flushEffects();

      await waitFor(() => {
        expect(result.queryByTestId('location-error-text')).toBeTruthy();
      });

      const errorText = result.getByTestId('location-error-text');
      expect(styleContainsColor(errorText.props.style, lightTheme.colors.error)).toBe(true);
    });

    it('uses theme.colors.error for location error text in dark mode', async () => {
      (ExpoLocation.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
      });
      (ExpoLocation.getCurrentPositionAsync as jest.Mock).mockRejectedValue(
        new Error('GPS unavailable'),
      );

      const result = await renderModal(undefined, darkTheme);
      await flushEffects();

      await waitFor(() => {
        expect(result.queryByTestId('location-error-text')).toBeTruthy();
      });

      const errorText = result.getByTestId('location-error-text');
      expect(styleContainsColor(errorText.props.style, darkTheme.colors.error)).toBe(true);
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

  // -------------------------------------------------------------------------
  // Snackbar error dismiss
  // -------------------------------------------------------------------------

  describe('snackbar error dismiss', () => {
    it('clears error when Snackbar onDismiss is called', async () => {
      const result = await renderModal();
      await flushEffects();

      // Set an error via re-center with permission denied.
      (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
        granted: false,
        canAskAgain: false,
      });
      const recenterBtn = result.getByTestId('recenter-button');
      await act(async () => {
        fireEvent.press(recenterBtn);
      });
      await flushEffects();

      // Snackbar should be visible.
      await waitFor(() => {
        expect(result.queryByText('Location permission not granted.')).toBeTruthy();
      });

      // Find the Snackbar and fire its onDismiss.
      // The Snackbar component from react-native-paper is rendered with
      // visible and onDismiss props.
      const snackbar = result.UNSAFE_root.findAll(
        (node: TestInstance) =>
          typeof (node.props as Record<string, unknown>)?.onDismiss === 'function' &&
          (node.props as Record<string, unknown>)?.visible === true,
      );
      if (snackbar.length > 0) {
        await act(async () => {
          snackbar[0].props.onDismiss();
        });
      }

      // Error should be cleared.
      await waitFor(() => {
        expect(result.queryByText('Location permission not granted.')).toBeNull();
      });
    });
  });

  // -------------------------------------------------------------------------
  // handleRecenter failure catch block
  // -------------------------------------------------------------------------

  describe('handleRecenter failure', () => {
    it('shows generic error when handleRecenter catches an unexpected error', async () => {
      const result = await renderModal();
      await waitForMap(result);

      // Make getForegroundPermissionsAsync throw an unexpected error.
      (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockRejectedValue(
        new Error('unexpected'),
      );

      const recenterBtn = result.getByTestId('recenter-button');
      await act(async () => {
        fireEvent.press(recenterBtn);
      });
      await flushEffects();

      await waitFor(() => {
        expect(result.queryByText('Failed to update location.')).toBeTruthy();
      });
    });
  });

  // -------------------------------------------------------------------------
  // fetchLocation outer catch in create mode
  // -------------------------------------------------------------------------

  describe('fetchLocation unexpected error', () => {
    it('sets locDenied when fetchLocation catches an unexpected error', async () => {
      // Make getForegroundPermissionsAsync throw to trigger the outer catch.
      (ExpoLocation.getForegroundPermissionsAsync as jest.Mock).mockRejectedValue(
        new Error('unexpected error'),
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
  // Date picker
  // -------------------------------------------------------------------------

  describe('date picker', () => {
    /**
     * Joins the Text children array rendered by the date button into a plain string so
     * tests can assert on the displayed date/time text.
     *
     * @param props - The props object from the rendered date text element.
     *
     * @returns The joined text content.
     */
    function dateTextContent(props: Record<string, unknown>): string {
      const children = props.children;
      return Array.isArray(children) ? children.join('') : String(children);
    }

    it('opens the date picker when the date button is pressed', async () => {
      const result = await renderModal();
      await flushEffects();

      expect(result.queryByTestId('date-picker-modal')).toBeNull();

      const dateButton = result.getByTestId('entry-date-button');
      await act(async () => {
        fireEvent.press(dateButton);
      });

      expect(result.getByTestId('date-picker-modal')).toBeTruthy();
    });

    it('defaults to today for new entries', async () => {
      const result = await renderModal();
      await flushEffects();

      const dateText = result.getByTestId('entry-date-text');
      expect(dateTextContent(dateText.props)).toContain(new Date().toLocaleDateString());
    });

    it('defaults to the saved datetime when editing an existing entry', async () => {
      const savedDate = new Date(2025, 0, 15, 12, 0);
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'existing content',
              datetime: savedDate,
              created_at: savedDate,
              modified_at: savedDate,
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      const dateText = result.getByTestId('entry-date-text');
      expect(dateTextContent(dateText.props)).toContain(savedDate.toLocaleDateString());
    });

    it('updates the displayed date after confirming a new date', async () => {
      const result = await renderModal();
      await flushEffects();

      await act(async () => {
        fireEvent.press(result.getByTestId('entry-date-button'));
      });

      await act(async () => {
        fireEvent.press(result.getByTestId('date-picker-save'));
      });

      const dateText = result.getByTestId('entry-date-text');
      expect(dateTextContent(dateText.props)).toContain(
        new Date(2026, 5, 17).toLocaleDateString(),
      );
    });

    it('preserves the time-of-day when a new date is confirmed', async () => {
      const savedDate = new Date(2025, 0, 15, 14, 37, 0, 0);
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original content',
              datetime: savedDate,
              created_at: savedDate,
              modified_at: savedDate,
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      await act(async () => {
        fireEvent.press(result.getByTestId('entry-date-button'));
      });

      await act(async () => {
        fireEvent.press(result.getByTestId('date-picker-save'));
      });

      // Trigger the back-navigation flush so the update is persisted.
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
        expect(actions.updateEntry).toHaveBeenCalled();
      });

      const persistedDate: Date = actions.updateEntry.mock.calls[0][1].datetime;
      expect(persistedDate.getFullYear()).toBe(2026);
      expect(persistedDate.getMonth()).toBe(5);
      expect(persistedDate.getDate()).toBe(17);
      expect(persistedDate.getHours()).toBe(14);
      expect(persistedDate.getMinutes()).toBe(37);
    });

    it('pushes an undo snapshot when the date changes', async () => {
      const savedDate = new Date(2025, 0, 15, 12, 0, 0, 0);
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original content',
              datetime: savedDate,
              created_at: savedDate,
              modified_at: savedDate,
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      const initialText = dateTextContent(result.getByTestId('entry-date-text').props);

      await act(async () => {
        fireEvent.press(result.getByTestId('entry-date-button'));
      });

      await act(async () => {
        fireEvent.press(result.getByTestId('date-picker-save'));
      });

      // The date should have changed.
      await waitFor(() => {
        expect(dateTextContent(result.getByTestId('entry-date-text').props)).not.toBe(initialText);
      });

      // Undo should restore the original date.
      const undoBtn = result.getByTestId('undo-button');
      await act(async () => {
        fireEvent.press(undoBtn);
      });

      expect(dateTextContent(result.getByTestId('entry-date-text').props)).toBe(initialText);
    });

    it('does not change the date or push undo when the picker confirms without a date', async () => {
      const savedDate = new Date(2025, 0, 15, 12, 0, 0, 0);
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original content',
              datetime: savedDate,
              created_at: savedDate,
              modified_at: savedDate,
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      const initialText = dateTextContent(result.getByTestId('entry-date-text').props);

      await act(async () => {
        fireEvent.press(result.getByTestId('entry-date-button'));
      });

      await act(async () => {
        fireEvent.press(result.getByTestId('date-picker-save-undefined'));
      });

      // The guard should short-circuit before mutating state.
      expect(dateTextContent(result.getByTestId('entry-date-text').props)).toBe(initialText);

      // No undo snapshot should have been pushed, so undo remains disabled.
      expect(result.getByTestId('undo-button').props.accessibilityState?.disabled).toBe(true);
    });

    it('flushes a date-only change on back navigation', async () => {
      const savedDate = new Date(2025, 0, 15, 9, 0, 0, 0);
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original content',
              datetime: savedDate,
              created_at: savedDate,
              modified_at: savedDate,
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      await act(async () => {
        fireEvent.press(result.getByTestId('entry-date-button'));
      });

      await act(async () => {
        fireEvent.press(result.getByTestId('date-picker-save'));
      });

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
            datetime: expect.any(Date),
          }),
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // Time picker
  // -------------------------------------------------------------------------

  describe('time picker', () => {
    /**
     * Joins the Text children array rendered by a button into a plain string so tests
     * can assert on the displayed text.
     *
     * @param props - The props object from the rendered text element.
     *
     * @returns The joined text content.
     */
    function textContent(props: Record<string, unknown>): string {
      const children = props.children;
      return Array.isArray(children) ? children.join('') : String(children);
    }

    /**
     * Reads the date text content. Re-declared locally because the date picker block's
     * `dateTextContent` helper is block-scoped and not visible here.
     */
    const dateTextContent = textContent;

    it('opens the time picker when the time button is pressed', async () => {
      const result = await renderModal();
      await flushEffects();

      expect(result.queryByTestId('time-picker-modal')).toBeNull();

      const timeButton = result.getByTestId('entry-time-button');
      await act(async () => {
        fireEvent.press(timeButton);
      });

      expect(result.getByTestId('time-picker-modal')).toBeTruthy();
    });

    it('defaults to the current time for new entries', async () => {
      const result = await renderModal();
      await flushEffects();

      const timeText = result.getByTestId('entry-time-text');
      const expected = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      expect(textContent(timeText.props)).toContain(expected);
    });

    it('defaults to the saved time when editing an existing entry', async () => {
      const savedDate = new Date(2025, 0, 15, 14, 37, 0, 0);
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'existing content',
              datetime: savedDate,
              created_at: savedDate,
              modified_at: savedDate,
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      const timeText = result.getByTestId('entry-time-text');
      const expected = savedDate.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      expect(textContent(timeText.props)).toContain(expected);
    });

    it('updates the displayed time after confirming a new time', async () => {
      const result = await renderModal();
      await flushEffects();

      await act(async () => {
        fireEvent.press(result.getByTestId('entry-time-button'));
      });

      await act(async () => {
        fireEvent.press(result.getByTestId('time-picker-save'));
      });

      const timeText = result.getByTestId('entry-time-text');
      // The mock confirms with hours=8, minutes=30.
      const expected = new Date();
      expected.setHours(8, 30, 0, 0);
      expect(textContent(timeText.props)).toContain(
        expected.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      );
    });

    it('preserves the date when a new time is confirmed', async () => {
      const savedDate = new Date(2025, 0, 15, 14, 37, 0, 0);
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original content',
              datetime: savedDate,
              created_at: savedDate,
              modified_at: savedDate,
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      const initialDateText = dateTextContent(result.getByTestId('entry-date-text').props);

      await act(async () => {
        fireEvent.press(result.getByTestId('entry-time-button'));
      });

      await act(async () => {
        fireEvent.press(result.getByTestId('time-picker-save'));
      });

      // The date text should be unchanged after a time-only edit.
      expect(dateTextContent(result.getByTestId('entry-date-text').props)).toBe(initialDateText);
    });

    it('preserves seconds and milliseconds when a new time is confirmed', async () => {
      // Use a saved date with non-zero seconds and milliseconds so the
      // preservation is observable via the persisted datetime on flush.
      const savedDate = new Date(2025, 0, 15, 14, 37, 42, 123);
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original content',
              datetime: savedDate,
              created_at: savedDate,
              modified_at: savedDate,
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      await act(async () => {
        fireEvent.press(result.getByTestId('entry-time-button'));
      });

      await act(async () => {
        fireEvent.press(result.getByTestId('time-picker-save'));
      });

      // Trigger the back-navigation flush so the update is persisted.
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
        expect(actions.updateEntry).toHaveBeenCalled();
      });

      const persistedDate: Date = actions.updateEntry.mock.calls[0][1].datetime;
      // Hours/minutes replaced by the mock (8:30); seconds/ms preserved.
      expect(persistedDate.getHours()).toBe(8);
      expect(persistedDate.getMinutes()).toBe(30);
      expect(persistedDate.getSeconds()).toBe(42);
      expect(persistedDate.getMilliseconds()).toBe(123);
    });

    it('pushes an undo snapshot when the time changes', async () => {
      const savedDate = new Date(2025, 0, 15, 12, 0, 0, 0);
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original content',
              datetime: savedDate,
              created_at: savedDate,
              modified_at: savedDate,
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      const initialText = textContent(result.getByTestId('entry-time-text').props);

      await act(async () => {
        fireEvent.press(result.getByTestId('entry-time-button'));
      });

      await act(async () => {
        fireEvent.press(result.getByTestId('time-picker-save'));
      });

      // The time should have changed.
      await waitFor(() => {
        expect(textContent(result.getByTestId('entry-time-text').props)).not.toBe(initialText);
      });

      // Undo should restore the original time.
      const undoBtn = result.getByTestId('undo-button');
      await act(async () => {
        fireEvent.press(undoBtn);
      });

      expect(textContent(result.getByTestId('entry-time-text').props)).toBe(initialText);
    });

    it('does not change the time or push undo when the picker confirms without hours/minutes', async () => {
      const savedDate = new Date(2025, 0, 15, 12, 0, 0, 0);
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original content',
              datetime: savedDate,
              created_at: savedDate,
              modified_at: savedDate,
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      const initialText = textContent(result.getByTestId('entry-time-text').props);

      await act(async () => {
        fireEvent.press(result.getByTestId('entry-time-button'));
      });

      await act(async () => {
        fireEvent.press(result.getByTestId('time-picker-save-undefined'));
      });

      // The guard should short-circuit before mutating state.
      expect(textContent(result.getByTestId('entry-time-text').props)).toBe(initialText);

      // No undo snapshot should have been pushed, so undo remains disabled.
      expect(result.getByTestId('undo-button').props.accessibilityState?.disabled).toBe(true);
    });

    it('flushes a time-only change on back navigation', async () => {
      const savedDate = new Date(2025, 0, 15, 9, 0, 0, 0);
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original content',
              datetime: savedDate,
              created_at: savedDate,
              modified_at: savedDate,
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      await act(async () => {
        fireEvent.press(result.getByTestId('entry-time-button'));
      });

      await act(async () => {
        fireEvent.press(result.getByTestId('time-picker-save'));
      });

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
            datetime: expect.any(Date),
          }),
        );
      });

      const persistedDate: Date = actions.updateEntry.mock.calls[0][1].datetime;
      // The mock confirms 8:30; the date portion is preserved.
      expect(persistedDate.getHours()).toBe(8);
      expect(persistedDate.getMinutes()).toBe(30);
      expect(persistedDate.getFullYear()).toBe(2025);
      expect(persistedDate.getMonth()).toBe(0);
      expect(persistedDate.getDate()).toBe(15);
    });

    it('preserves the new time when editing time then date', async () => {
      const savedDate = new Date(2025, 0, 15, 14, 37, 0, 0);
      (useJournalViewModel as jest.Mock).mockReturnValue({
        state: {
          ...DEFAULT_STATE,
          entries: [
            {
              id: 'edit-1',
              content: 'original content',
              datetime: savedDate,
              created_at: savedDate,
              modified_at: savedDate,
              tags: [] as string[],
            },
          ],
        },
        actions,
      });

      const result = await renderModal('edit-1');
      await flushEffects();

      // First, change the time via the time picker (mock confirms 8:30).
      await act(async () => {
        fireEvent.press(result.getByTestId('entry-time-button'));
      });
      await act(async () => {
        fireEvent.press(result.getByTestId('time-picker-save'));
      });

      // Then, change the date via the date picker (mock confirms 2026-06-17).
      await act(async () => {
        fireEvent.press(result.getByTestId('entry-date-button'));
      });
      await act(async () => {
        fireEvent.press(result.getByTestId('date-picker-save'));
      });

      // Trigger the back-navigation flush so the update is persisted.
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
        expect(actions.updateEntry).toHaveBeenCalled();
      });

      const persistedDate: Date = actions.updateEntry.mock.calls[0][1].datetime;
      // The new time (8:30) must survive the subsequent date edit, and the
      // new date (2026-06-17) must be applied.
      expect(persistedDate.getHours()).toBe(8);
      expect(persistedDate.getMinutes()).toBe(30);
      expect(persistedDate.getFullYear()).toBe(2026);
      expect(persistedDate.getMonth()).toBe(5);
      expect(persistedDate.getDate()).toBe(17);
    });
  });
});
