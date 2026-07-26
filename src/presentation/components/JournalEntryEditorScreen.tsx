import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  type AppStateStatus,
  ScrollView,
  StyleSheet,
  View,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  Appbar,
  Button,
  Chip,
  Dialog,
  IconButton,
  Portal,
  Snackbar,
  Surface,
  Text,
  TextInput,
  ActivityIndicator,
  useTheme,
} from 'react-native-paper';
import { useLocalSearchParams } from 'expo-router';
import { useNavigation } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Map, Camera, type ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import * as ExpoLocation from 'expo-location';
import { useImmer } from 'use-immer';
import { DatePickerModal, TimePickerModal } from 'react-native-paper-dates';

import { useJournalViewModel } from '@/src/presentation/viewmodels/JournalViewModel';
import type { JournalEntry } from '@/src/domain/entities/JournalEntry';

const MAX_HISTORY_LENGTH = 50;
const GEOCODE_DEBOUNCE_MS = 600;
const GEOCODE_TIMEOUT_MS = 3000;
/** Timeout for getCurrentPositionAsync (does not accept a timeout option). */
const POSITION_TIMEOUT_MS = 15000;
/** Timeout for the reverseGeocodeAsync call during the initial location fetch. */
const INITIAL_GEOCODE_TIMEOUT_MS = 15000;
const CONTENT_UNDO_COALESCE_MS = 500;
// OpenFreeMap — free OpenStreetMap-based vector tiles, no API key required.
// See: https://openfreemap.org
const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** Consolidated state for the journal entry modal. */
interface ModalState {
  /** Entry content text. */
  content: string;
  /** Entry datetime. */
  datetime: Date;
  /** Entry tags. */
  tags: string[];
  /** Current value of the tag input field (ephemeral UI state). */
  tagInput: string;
  /** Transient error message for the Snackbar. */
  error: string | null;
  /** Whether an autosave is currently in-flight. */
  autoSaving: boolean;
  /** Timestamp of the last successful autosave. */
  lastSaved: Date | null;
  /** Current map location (create mode only). */
  currentLocation: JournalEntry['location'] | undefined;
  /** Modified location during edit mode, separate from the saved entry location. */
  editLocation: JournalEntry['location'] | undefined;
  /** Whether location permission was denied. */
  locDenied: boolean;
  /** Transient location error message (timeout, fetch failure, etc.). */
  locError: string | null;
  /** Whether an active GPS position fetch is in progress. */
  isFetchingLocation: boolean;
}

/** A snapshot of just the undo-able entry fields. */
interface UndoableSnapshot {
  /** Entry content at the time of the snapshot. */
  content: string;
  /** Entry datetime at the time of the snapshot. */
  datetime: Date;
  /** Entry tags at the time of the snapshot. */
  tags: string[];
}

/**
 * Formats a geocoded address object into a human-readable string.
 *
 * @param geocode - The geocoded address result from expo-location.
 *
 * @returns A comma-separated address string, or undefined if all fields are empty.
 */
export function formatAddress(geocode: ExpoLocation.LocationGeocodedAddress): string | undefined {
  const parts = [
    geocode.name,
    geocode.street,
    geocode.city,
    geocode.region,
    geocode.postalCode,
    geocode.country,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * Modal screen for creating or editing a journal entry.
 *
 * @returns The rendered modal screen.
 */
export default function JournalEntryEditorScreen() {
  const { entryId } = useLocalSearchParams<{ entryId?: string }>();
  const resolvedEntryId: string | undefined = Array.isArray(entryId) ? entryId[0] : entryId;
  const { actions, state: viewModelState } = useJournalViewModel();
  const navigation = useNavigation();
  const theme = useTheme();

  // The ViewModel's tag list (all existing tags in the system) used for
  // autocomplete suggestions in the tag input.
  const viewModelTags = viewModelState.tags;

  // The entry loaded from the repository by ID. Decoupled from the ViewModel's
  // paginated `entries` array so that entries beyond the first page (loaded via
  // infinite scroll) can still be opened in edit mode.
  const [loadedEntry, setLoadedEntry] = useState<JournalEntry | null>(null);

  const [state, setState] = useImmer<ModalState>({
    content: '',
    datetime: new Date(),
    tags: [],
    tagInput: '',
    error: null,
    autoSaving: false,
    lastSaved: null,
    currentLocation: undefined,
    editLocation: undefined,
    locDenied: false,
    locError: null,
    isFetchingLocation: false,
  });

  // Tracks whether any saveable field (content, tags, datetime, location) has
  // changed since the last successful save. Flush paths (back navigation and
  // AppState background/inactive) consult this ref to decide whether a save is
  // needed, so tag-only, datetime-only, and location-only mutations are
  // persisted even though they never schedule a debounced autosave.
  const dirtyRef = useRef(false);
  // Tracks whether a save API call is currently in-flight to prevent stacking.
  const savingRef = useRef(false);
  // Holds the in-flight save promise so flushSave can await it instead of
  // starting a concurrent write.
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  // Ref to a stable save function that always has access to latest state.
  // Avoids stale closures when called from the AppState listener.
  const saveFnRef = useRef<() => Promise<void>>(undefined);
  // Prevents the sync effect from overwriting the user's current editing
  // content with a trimmed DB value after a save completes (via any flush path).
  // Content is initialized from the existing entry once on mount only.
  //
  // NOTE: If entryId were ever to change while the modal stays mounted
  // (e.g., deep-link navigation swapping entries in-place), this ref would
  // need to be reset so the new entry's content loads. In the current Expo
  // Router model the modal is always pushed/popped, so this is not a concern.
  const contentInitializedRef = useRef(false);

  // Ref to the shared edit-save function. Reassigned every render to close over
  // the latest state. Both the AppState flush path and flushSaveRef call this to
  // avoid duplicating the save payload and the bookkeeping around
  // savingRef / saveInFlightRef.
  const doEditSaveRef = useRef<() => Promise<void>>(undefined);

  // Location refs
  const geoDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Counter used to discard stale geocode results when the user drags again
  // while a previous request is still outstanding.
  const pendingGeocodeRef = useRef(0);

  // Undo/redo stacks stored in refs to enable snapshotting of undo-able
  // entry fields only. Moving them out of ModalState allows setState to
  // restore only content/datetime/tags without clobbering transient UI state.
  const undoStackRef = useRef<UndoableSnapshot[]>([]);
  const redoStackRef = useRef<UndoableSnapshot[]>([]);
  // Render signals derived from stack state.
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // Controls visibility of the delete confirmation dialog.
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  // Controls visibility of the date picker modal.
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  // Controls visibility of the time picker modal. Independent from the date
  // picker so the user can edit only the time without touching the date.
  const [timePickerVisible, setTimePickerVisible] = useState(false);

  // Timer-based keystroke coalescing for undo/redo: fast consecutive content
  // changes are collapsed into a single undo entry so the user can undo an
  // entire burst of typing in one step.
  const contentUndoTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isContentUndoCoalescingRef = useRef(false);

  // Synchronous guard to prevent concurrent handleRecenter invocations.
  // The state-based isFetchingLocation drives the UI (disabled prop),
  // but setState is batched so a second tap before React re-renders would
  // see the stale false value. The ref is set synchronously on entry and
  // provides immediate protection against rapid double-taps.
  const recenterInProgressRef = useRef(false);

  // Imperative scroll-lock for the outer ScrollView during map gestures.
  //
  // The "map is being touched" flag is intentionally kept in a ref (not React
  // state) so that toggling it does NOT re-render the ScrollView + TextInput
  // subtree. Re-rendering that subtree during a map drag was resetting the
  // scroll offset and causing the outer scroll to jump up and obscure the map
  // (see commit history for the scroll-jump bug).
  //
  // Instead of binding `scrollEnabled` to React state, we imperatively toggle
  // the native `scrollEnabled` prop via `setNativeProps` on the ScrollView
  // host instance. This bypasses the React render cycle entirely for the
  // duration of the gesture.
  const mapTouchedRef = useRef(false);
  // Ref to the ScrollView host instance so we can call setNativeProps on it
  // without triggering a re-render. Typed loosely since the mock and the real
  // host component both expose setNativeProps but the exact type is internal.
  const scrollViewRef = useRef<ScrollView | null>(null);

  /**
   * Imperatively locks or unlocks the outer ScrollView's `scrollEnabled` native prop
   * without triggering a React re-render.
   *
   * This is the crux of the scroll-jump fix: toggling scroll via `setNativeProps`
   * bypasses the render cycle, so the TextInput/ScrollView subtree is not re-rendered
   * and the scroll offset is preserved during map gestures.
   *
   * @param enabled - Whether the ScrollView should be scrollable.
   */
  const setScrollEnabled = useCallback((enabled: boolean) => {
    // setNativeProps is available on the real host component and on the
    // jest-preset ScrollView mock. Guard for safety in non-native renderers.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance = scrollViewRef.current as any;
    instance?.setNativeProps?.({ scrollEnabled: enabled });
  }, []);

  /**
   * Locks the outer ScrollView's scroll when the user begins a map gesture.
   *
   * Idempotent: only flips the ref and calls `setNativeProps` when not already locked,
   * so repeated touch/region-change events do not re-issue native prop writes or
   * re-render the subtree.
   */
  const lockScroll = useCallback(() => {
    if (!mapTouchedRef.current) {
      mapTouchedRef.current = true;
      setScrollEnabled(false);
    }
  }, [setScrollEnabled]);

  /**
   * Releases the outer ScrollView's scroll lock when a map gesture ends.
   *
   * Idempotent: only flips the ref and calls `setNativeProps` when currently locked, so
   * a stray unlock (e.g. touch end with no preceding region change) does not issue a
   * redundant native prop write.
   */
  const unlockScroll = useCallback(() => {
    if (mapTouchedRef.current) {
      mapTouchedRef.current = false;
      setScrollEnabled(true);
    }
  }, [setScrollEnabled]);

  /**
   * Snapshots the undo-able entry fields onto the undo stack and clears redo. Enforces
   * MAX_HISTORY_LENGTH.
   *
   * @param currentState - The current ModalState to snapshot fields from.
   */
  const pushUndoState = useCallback((currentState: ModalState) => {
    undoStackRef.current.push({
      content: currentState.content,
      datetime: currentState.datetime,
      tags: currentState.tags,
    });
    if (undoStackRef.current.length > MAX_HISTORY_LENGTH) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  // Load the entry by ID directly from the repository when an entryId is
  // present. This decouples edit detection from the ViewModel's paginated
  // entries array so entries beyond the first page (infinite scroll) can be
  // opened correctly.
  useEffect(() => {
    if (!resolvedEntryId) {
      setLoadedEntry(null);
      return;
    }
    let cancelled = false;
    actions
      .getEntryById(resolvedEntryId)
      .then(entry => {
        if (!cancelled) {
          setLoadedEntry(entry);
          if (!entry) {
            // Entry not found (deleted or DB error). Show an error and
            // navigate back so the user doesn't accidentally create a
            // duplicate entry in what looks like "New Entry" mode.
            setState(draft => {
              draft.error = 'Entry not found. It may have been deleted.';
            });
            setTimeout(() => navigation.goBack(), 100);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState(draft => {
            draft.error = 'Failed to load entry.';
          });
          setTimeout(() => navigation.goBack(), 100);
        }
      });
    return () => {
      cancelled = true;
    };
    // Only re-run when the entryId changes. The actions object is stable
    // (useCallback-backed) so getEntryById won't change between renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedEntryId, navigation, setState]);

  const existingEntry = loadedEntry;
  const isEditing = !!existingEntry;

  useEffect(() => {
    if (existingEntry) {
      setState(draft => {
        // Only initialize content from the existing entry once. Subsequent
        // updates to existingEntry.content (e.g., from our own autosave
        // saving trimmed content) must not overwrite the user's current
        // editing state — that would cause the cursor to visibly jump.
        if (!contentInitializedRef.current) {
          draft.content = existingEntry.content;
          contentInitializedRef.current = true;
        }
        draft.datetime = existingEntry.datetime;
        draft.tags = existingEntry.tags;
      });
    }
  }, [existingEntry, setState]);

  // On create (not editing), pre-populate the tag list with the tags from
  // the most recently created entry. This is a UX convenience so the user
  // doesn't have to re-add their commonly used tags every time. Only runs in
  // create mode (no entryId) and only once on mount. The async fetch is
  // non-blocking — the UI renders immediately with an empty tag list and the
  // tags appear once loaded.
  //
  // A pristine undo snapshot is pushed BEFORE the default tags are applied so
  // the first Ctrl+Z clears the auto-populated tags. Without this snapshot the
  // first undo would skip past the default tags (since setState does not push
  // to the undo stack), which would surprise the user.
  useEffect(() => {
    if (resolvedEntryId) return; // edit mode — leave tags as loaded above
    let cancelled = false;
    actions
      .loadDefaultTags()
      .then(tags => {
        if (cancelled) return;
        if (tags.length > 0) {
          // Snapshot the pre-default state (empty tags) so the first undo
          // reverts the auto-populated default tags back to an empty list.
          pushUndoState(state);
          setState(draft => {
            draft.tags = tags;
          });
        }
      })
      .catch(() => {
        // Silently ignore — the user can still add tags manually.
      });
    return () => {
      cancelled = true;
    };
    // Only run once on mount. The actions object is stable (useCallback-backed)
    // so loadDefaultTags won't change between renders. pushUndoState and
    // setState are also stable. state is intentionally read at invocation time
    // (the snapshot must capture the empty pre-default state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tag autocomplete suggestions derived from the system tags (state.tags from
  // the ViewModel) filtered by the current tagInput. Case-insensitive prefix
  // match; tags already added to the entry are excluded so the user isn't
  // offered a tag they just added. Memoized to avoid recomputing on every
  // render when neither the input nor the tag list changed.
  const tagSuggestions = useMemo(() => {
    const input = state.tagInput.trim().toLowerCase();
    if (!input) return [];
    return viewModelTags
      .filter(tag => tag.name.toLowerCase().startsWith(input))
      .filter(tag => !state.tags.includes(tag.name))
      .map(tag => tag.name)
      .slice(0, 8);
  }, [state.tagInput, state.tags, viewModelTags]);

  // On create (not editing), request permission and fetch current location.
  // First checks existing permission to avoid unnecessarily prompting the user,
  // then fetches the GPS position and reverse-geocodes it, both with timeouts.
  //
  // Race condition guard: when editing an existing entry, the ViewModel may still
  // be loading (entries is empty). In that transient state isEditing is false, so
  // the naive check would trigger a spurious permission dialog. The guard inside
  // the effect skips the fetch whenever a resolvedEntryId is present but the
  // entry has not loaded yet — isEditing would be true in that case.
  useEffect(() => {
    let cancelled = false;
    /** Fetches the current location and reverse geocodes it. */
    const fetchLocation = async () => {
      if (isEditing) return; // Only for new entries
      // Race condition guard: entryId is set but the entry hasn't loaded yet.
      // isEditing would be true if the entry were loaded. Skip the fetch to
      // avoid spurious permission dialogs until the ViewModel populates.
      if (resolvedEntryId) return;
      try {
        setState(draft => {
          draft.locDenied = false;
          draft.locError = null;
          draft.isFetchingLocation = true;
        });

        // Check existing permission first to avoid prompting the user
        // unnecessarily. If already granted, skip the request dialog.
        const existingPerm = await ExpoLocation.getForegroundPermissionsAsync();
        let granted = existingPerm.granted;
        if (!granted && existingPerm.canAskAgain) {
          // Permission not yet decided — prompt the user.
          const perm = await ExpoLocation.requestForegroundPermissionsAsync();
          granted = perm.status === 'granted';
        }

        if (!granted) {
          if (!cancelled) {
            setState(draft => {
              draft.locDenied = true;
              draft.isFetchingLocation = false;
            });
          }
          return;
        }

        // getCurrentPositionAsync does not accept a timeout option, so wrap
        // it in Promise.race with a manual timeout.
        let positionTimeoutId: ReturnType<typeof setTimeout>;
        const positionPromise = ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.High,
        });
        const positionTimeout = new Promise<never>((_, reject) => {
          positionTimeoutId = setTimeout(
            () => reject(new Error('position_timeout')),
            POSITION_TIMEOUT_MS,
          );
        });
        let pos: ExpoLocation.LocationObject | null = null;
        try {
          pos = await Promise.race([positionPromise, positionTimeout]);
        } catch (err) {
          // Log the error to aid diagnostics if location fetch fails in the
          // emulator. Suppressed in tests to keep output clean (mocked
          // location APIs reject during unit tests).
          if (process.env.NODE_ENV !== 'test') {
            console.warn('[EntryEditor] Initial location fetch failed:', err);
          }
          // getCurrentPositionAsync failed or timed out — try the cached
          // last-known position as a fallback. This is useful when a fresh
          // GPS fix isn't available (e.g. indoors, emulator without mock GPS,
          // or weak signal). The fallback runs unconditionally (including in
          // tests) so the balanced-accuracy path is exercised; only the
          // warning output is silenced.
          try {
            // Fallback 1: Try a Balanced accuracy fetch first.
            // Balanced accuracy (network/Wi-Fi positioning) is much faster and
            // more reliable on emulators/indoor devices than High accuracy
            // (GPS-only) when satellite locks are missing.
            try {
              const positionPromiseBalanced = ExpoLocation.getCurrentPositionAsync({
                accuracy: ExpoLocation.Accuracy.Balanced,
              });
              let positionTimeoutIdBalanced: ReturnType<typeof setTimeout>;
              const positionTimeoutBalanced = new Promise<never>((_, reject) => {
                positionTimeoutIdBalanced = setTimeout(
                  () => reject(new Error('position_timeout_balanced')),
                  5000,
                );
              });
              pos = await Promise.race([positionPromiseBalanced, positionTimeoutBalanced]);
              clearTimeout(positionTimeoutIdBalanced!);
            } catch (balancedErr) {
              if (process.env.NODE_ENV !== 'test') {
                console.warn('[EntryEditor] Balanced accuracy fallback also failed:', balancedErr);
              }
            }

            // Fallback 2: If we still do not have a position, try the cached
            // last-known position.
            if (!pos) {
              const lastKnown = await ExpoLocation.getLastKnownPositionAsync();
              if (lastKnown) {
                pos = lastKnown;
              }
            }
          } catch {
            // getLastKnownPositionAsync also failed — pos stays null.
          }
        } finally {
          clearTimeout(positionTimeoutId!);
        }

        if (!pos) {
          // Both getCurrentPositionAsync and getLastKnownPositionAsync
          // returned null/failed — show the error.
          if (!cancelled) {
            setState(draft => {
              draft.locError = 'Could not get your location. GPS may be unavailable.';
              draft.isFetchingLocation = false;
            });
          }
          return;
        }

        // Reverse geocode is optional; attempt with a timeout.
        let address: string | undefined = undefined;
        try {
          let geocodeTimeoutId: ReturnType<typeof setTimeout>;
          const geocodePromise = ExpoLocation.reverseGeocodeAsync({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
          const geocodeTimeout = new Promise<never>((_, reject) => {
            geocodeTimeoutId = setTimeout(
              () => reject(new Error('geocode_timeout')),
              INITIAL_GEOCODE_TIMEOUT_MS,
            );
          });
          const geos = await Promise.race([geocodePromise, geocodeTimeout]);
          clearTimeout(geocodeTimeoutId!);
          if (geos && geos.length > 0) {
            address = formatAddress(geos[0]);
          }
        } catch {
          // ignore reverse geocode errors or timeout
        }
        const elevation = typeof pos.coords.altitude === 'number' ? pos.coords.altitude : 0;
        const loc: JournalEntry['location'] = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          elevation: elevation,
          accuracy: pos.coords.accuracy ?? undefined,
          address,
        };
        if (!cancelled) {
          setState(draft => {
            draft.currentLocation = loc;
            draft.isFetchingLocation = false;
          });
        }
      } catch {
        if (!cancelled) {
          setState(draft => {
            draft.locDenied = true;
            draft.isFetchingLocation = false;
          });
        }
      }
    };
    void fetchLocation();
    return () => {
      cancelled = true;
    };
  }, [isEditing, resolvedEntryId, setState]);

  // Shared edit-save logic extracted into a ref to avoid duplicating the
  // payload and bookkeeping between saveFnRef and flushSaveRef.
  // Reassigned every render to close over the latest state and actions.
  doEditSaveRef.current = async () => {
    if (!resolvedEntryId) return;
    savingRef.current = true;
    dirtyRef.current = false;
    setState(draft => {
      draft.autoSaving = true;
    });
    const promise = actions.updateEntry(resolvedEntryId, {
      content: state.content.trim(),
      datetime: state.datetime,
      tags: state.tags,
      // Persist location changes made by dragging the map in edit mode.
      // If the user dragged the map, editLocation is set; otherwise fall back
      // to the existing entry's saved location (which may be undefined).
      ...(state.editLocation !== undefined
        ? { location: state.editLocation }
        : existingEntry?.location !== undefined
          ? { location: existingEntry.location }
          : {}),
    });
    // Track the in-flight promise so flushSave can await it instead of
    // starting a concurrent write to the same entry.
    saveInFlightRef.current = promise.then(
      () => {},
      () => {},
    ) as Promise<void>;
    try {
      await promise;
      setState(draft => {
        draft.lastSaved = new Date();
      });
    } catch {
      // silently fail save
    } finally {
      saveInFlightRef.current = null;
      setState(draft => {
        draft.autoSaving = false;
      });
      savingRef.current = false;
    }
  };

  // Stable save fn — reassigned every render to close over latest state.
  // Called from the AppState background/inactive listener. Not invoked during
  // normal typing (the previous debounced autosave was removed to fix a
  // scroll-jump bug where the autoSaving/lastSaved state mutation re-rendered
  // the ScrollView and reset the visible region).
  //
  // If a save is already in-flight, this awaits it and then re-checks
  // dirtyRef so that a second background event (or a background event arriving
  // while the beforeRemove flush is mid-save) does not lose edits. This mirrors
  // the flushSaveRef path and avoids the dead pendingSaveRef flag that
  // previously dropped edits on rapid background/foreground/background cycles.
  saveFnRef.current = async () => {
    if (!isEditing || !resolvedEntryId || !state.content.trim()) return;
    if (savingRef.current) {
      // A save is in-flight — await it instead of starting a concurrent write.
      if (saveInFlightRef.current) {
        await saveInFlightRef.current;
      }
      // After awaiting, re-check whether a save is still needed. The
      // in-flight save may have already persisted everything (dirtyRef false),
      // or a subsequent mutation may have set dirtyRef true again — in which
      // case we must save the latest state to avoid losing edits.
      if (!dirtyRef.current || !state.content.trim()) return;
    }
    await doEditSaveRef.current?.();
  };

  // Flush pending edits when the app is backgrounded or becomes inactive.
  // This complements the beforeRemove back-navigation flush so that unsaved
  // changes are not lost when the user switches apps or the OS suspends the
  // process. The listener is only attached in edit mode (create-mode entries
  // are persisted solely on back navigation, matching the previous behaviour).
  useEffect(() => {
    if (!isEditing) return;
    /**
     * Flushes pending edits when the app leaves the active state.
     *
     * @param nextState - The next AppState status.
     */
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState !== 'background' && nextState !== 'inactive') return;
      void saveFnRef.current?.();
    };
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [isEditing]);

  // Cleanup timers on unmount.
  useEffect(() => {
    return () => {
      clearTimeout(geoDebounceRef.current);
      clearTimeout(contentUndoTimerRef.current);
    };
  }, []);

  const mapLocation = useMemo(() => {
    // In edit mode, if the user has dragged the map, use the edited location.
    // Otherwise fall back to the existing entry's location (edit) or the GPS
    // location (create).
    return state.editLocation ?? existingEntry?.location ?? state.currentLocation;
  }, [state.editLocation, existingEntry?.location, state.currentLocation]);

  const mapCenter: [number, number] | undefined = useMemo(() => {
    if (!mapLocation) return undefined;
    return [mapLocation.longitude, mapLocation.latitude];
  }, [mapLocation]);

  /**
   * Reverse geocodes a lat/lng pair with a timeout to avoid hanging.
   *
   * @param lat - Latitude.
   * @param lng - Longitude.
   *
   * @returns The address string, or undefined on failure/timeout.
   */
  const reverseGeocodeWithTimeout = useCallback(
    async (lat: number, lng: number): Promise<string | undefined> => {
      try {
        let timeoutId: ReturnType<typeof setTimeout>;
        const geocodePromise = ExpoLocation.reverseGeocodeAsync({
          latitude: lat,
          longitude: lng,
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('timeout')), GEOCODE_TIMEOUT_MS);
        });
        const geos = await Promise.race([geocodePromise, timeoutPromise]);
        // Clear the timeout if the geocode resolved first — prevents the
        // timer from firing uselessly after the race is over.
        clearTimeout(timeoutId!);
        if (geos && geos.length > 0) {
          return formatAddress(geos[0]);
        }
      } catch {
        // timeout or other error — return undefined
      }
      return undefined;
    },
    [],
  );

  /**
   * Re-centers the map to the device's current GPS location.
   *
   * Checks permission (without prompting if already decided), then fetches the current
   * position with a 10 s timeout and reverse-geocodes it. Sets the resulting location
   * into state and marks the entry dirty.
   */
  const handleRecenter = useCallback(async () => {
    // Synchronous guard: prevent concurrent re-center calls from rapid
    // double-taps. The disabled prop on the button provides a visual hint,
    // but setState is batched so a second press within the same render
    // cycle would see the stale isFetchingLocation=false. The ref is set
    // synchronously and cleared in every exit path (finally-style).
    if (recenterInProgressRef.current) return;
    recenterInProgressRef.current = true;

    try {
      const existingPerm = await ExpoLocation.getForegroundPermissionsAsync();
      let granted = existingPerm.granted;
      if (!granted && existingPerm.canAskAgain) {
        const perm = await ExpoLocation.requestForegroundPermissionsAsync();
        granted = perm.status === 'granted';
      }
      if (!granted) {
        setState(draft => {
          draft.error = 'Location permission not granted.';
        });
        return;
      }

      setState(draft => {
        draft.isFetchingLocation = true;
        draft.locError = null;
      });

      // Fetch position with timeout.
      let positionTimeoutId: ReturnType<typeof setTimeout>;
      const positionPromise = ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.High,
      });
      const positionTimeout = new Promise<never>((_, reject) => {
        positionTimeoutId = setTimeout(
          () => reject(new Error('position_timeout')),
          POSITION_TIMEOUT_MS,
        );
      });
      let pos: ExpoLocation.LocationObject | null = null;
      try {
        pos = await Promise.race([positionPromise, positionTimeout]);
      } catch (err) {
        // Log the error to aid diagnostics if re-center fails in the
        // emulator. Suppressed in tests to keep output clean (mocked
        // location APIs reject during unit tests).
        if (process.env.NODE_ENV !== 'test') {
          console.warn('[EntryEditor] Re-center location fetch failed:', err);
        }
        // getCurrentPositionAsync failed or timed out — try the cached
        // last-known position as a fallback. This is useful when a fresh
        // GPS fix isn't available (e.g. indoors, emulator without mock GPS,
        // or weak signal). The fallback runs unconditionally (including in
        // tests) so the balanced-accuracy path is exercised; only the
        // warning output is silenced.
        try {
          // Fallback 1: Try a Balanced accuracy fetch first.
          // Balanced accuracy (network/Wi-Fi positioning) is much faster and
          // more reliable on emulators/indoor devices than High accuracy
          // (GPS-only) when satellite locks are missing.
          try {
            const positionPromiseBalanced = ExpoLocation.getCurrentPositionAsync({
              accuracy: ExpoLocation.Accuracy.Balanced,
            });
            let positionTimeoutIdBalanced: ReturnType<typeof setTimeout>;
            const positionTimeoutBalanced = new Promise<never>((_, reject) => {
              positionTimeoutIdBalanced = setTimeout(
                () => reject(new Error('position_timeout_balanced')),
                5000,
              );
            });
            pos = await Promise.race([positionPromiseBalanced, positionTimeoutBalanced]);
            clearTimeout(positionTimeoutIdBalanced!);
          } catch (balancedErr) {
            if (process.env.NODE_ENV !== 'test') {
              console.warn(
                '[EntryEditor] Balanced accuracy fallback also failed on re-center:',
                balancedErr,
              );
            }
          }

          // Fallback 2: If we still do not have a position, try the cached
          // last-known position.
          if (!pos) {
            const lastKnown = await ExpoLocation.getLastKnownPositionAsync();
            if (lastKnown) {
              pos = lastKnown;
            }
          }
        } catch {
          // getLastKnownPositionAsync also failed — pos stays null.
        }
      } finally {
        clearTimeout(positionTimeoutId!);
      }

      if (!pos) {
        // Both getCurrentPositionAsync and getLastKnownPositionAsync
        // returned null/failed — show the error.
        setState(draft => {
          draft.locError = 'Could not get your location. GPS may be unavailable.';
          draft.isFetchingLocation = false;
        });
        return;
      }

      // Reverse geocode with timeout.
      let address: string | undefined;
      try {
        address = await reverseGeocodeWithTimeout(pos.coords.latitude, pos.coords.longitude);
      } catch {
        // ignore
      }

      const elevation = typeof pos.coords.altitude === 'number' ? pos.coords.altitude : 0;
      const loc: JournalEntry['location'] = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        elevation,
        accuracy: pos.coords.accuracy ?? undefined,
        address,
      };

      // In edit mode write to editLocation; in create mode write to
      // currentLocation.
      const locationField = isEditing ? 'editLocation' : 'currentLocation';
      setState(draft => {
        draft[locationField] = loc;
        draft.isFetchingLocation = false;
      });
      dirtyRef.current = true;
    } catch {
      setState(draft => {
        draft.error = 'Failed to update location.';
        draft.isFetchingLocation = false;
      });
    } finally {
      // Always clear the guard ref so a subsequent tap is allowed.
      recenterInProgressRef.current = false;
    }
  }, [isEditing, setState, reverseGeocodeWithTimeout]);

  /**
   * Called when the map region finishes changing after a user gesture. Updates the
   * target location to the new centre coordinate and manages the outer ScrollView
   * scroll lock: while the user is actively dragging (userInteraction is true),
   * scrolling is disabled imperatively via setNativeProps so map gestures are not
   * stolen by the parent ScrollView. The lock is released directly when a
   * non-user-driven (programmatic) region change arrives, signalling the gesture has
   * ended — no debounce timer is needed.
   *
   * In MapLibre v11, the event payload is a `ViewStateChangeEvent` delivered via
   * `event.nativeEvent`, replacing the v10 GeoJSON Feature payload. The new center is
   * in `nativeEvent.center` as `[longitude, latitude]` and the user-interaction flag is
   * `nativeEvent.userInteraction` (was `feature.properties.isUserInteraction`).
   *
   * In edit mode, updates `editLocation` so the change can be persisted on save. In
   * create mode, updates `currentLocation` as before.
   *
   * @param event - Native synthetic event whose `nativeEvent` contains the new view
   *   state including `center`, `zoom`, `userInteraction`, etc.
   */
  const handleRegionDidChange = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      const { center, userInteraction } = event.nativeEvent;
      // Imperatively toggle the outer ScrollView scroll lock WITHOUT going
      // through React state. Holding this flag in a ref (instead of state)
      // avoids re-rendering the ScrollView + TextInput subtree on every map
      // gesture event, which was the root cause of the scroll-offset reset
      // that made the outer scroll jump up and obscure the map during a drag.
      //
      // userInteraction === true  → user is actively dragging → lock scroll.
      // userInteraction === false  → programmatic move (gesture ended) → unlock.
      if (userInteraction) {
        lockScroll();
      } else {
        unlockScroll();
      }

      // Only react to user-driven gestures, not programmatic camera moves.
      if (!userInteraction) return;

      const [newLng, newLat] = center;

      // The location field to update depends on whether we are in edit or create mode.
      // In edit mode, we write to editLocation so the original entry location is
      // preserved until the user saves; in create mode, we write to currentLocation.
      const locationField = isEditing ? 'editLocation' : 'currentLocation';

      // Update coordinates immediately so the save uses the right location.
      // Elevation is reset to 0 because there is no elevation API for arbitrary
      // coordinates — only the initial GPS fetch provides real altitude data.
      setState(draft => {
        if (draft[locationField]) {
          draft[locationField] = {
            ...draft[locationField]!,
            latitude: newLat,
            longitude: newLng,
            elevation: 0,
          };
        } else {
          // First drag on the map — create a location from the current map center.
          draft[locationField] = {
            latitude: newLat,
            longitude: newLng,
            elevation: 0,
          };
        }
      });
      // Mark the entry as dirty so flushSaveRef persists the location change on
      // back navigation. Without this, a location-only change (no content edit)
      // would be silently lost because the autosave effect only watches content.
      dirtyRef.current = true;

      pendingGeocodeRef.current += 1;
      const geocodeId = pendingGeocodeRef.current;

      // Debounce the reverse-geocode so a continuous drag does not fire a
      // request on every region-change event. Only the final resting position
      // is geocoded.
      clearTimeout(geoDebounceRef.current);

      geoDebounceRef.current = setTimeout(async () => {
        try {
          const address = await reverseGeocodeWithTimeout(newLat, newLng);
          // Ignore stale results if the user dragged again while geocoding.
          if (geocodeId === pendingGeocodeRef.current) {
            setState(draft => {
              if (draft[locationField]) {
                draft[locationField] = {
                  ...draft[locationField]!,
                  latitude: newLat,
                  longitude: newLng,
                  address,
                };
              }
            });
          }
        } catch {
          // ignore geocode errors or timeouts during a drag
        }
      }, GEOCODE_DEBOUNCE_MS);
    },
    [isEditing, reverseGeocodeWithTimeout, setState, lockScroll, unlockScroll],
  );

  /**
   * Locks the outer ScrollView the instant the user touches the map, before any
   * region-change event fires. Done via the ref (not state) so the ScrollView subtree
   * is not re-rendered.
   */
  const handleMapTouchStart = useCallback(() => {
    lockScroll();
  }, [lockScroll]);

  /**
   * Releases the lock when the touch lifts. A subsequent programmatic
   * `onRegionDidChange` (`userInteraction: false`) would also release it, but releasing
   * here covers the case where no region change fires (e.g. a tap without a drag).
   */
  const handleMapTouchEnd = useCallback(() => {
    unlockScroll();
  }, [unlockScroll]);

  /**
   * Releases the lock when the touch is cancelled (e.g. interrupted by a system
   * gesture). Same semantics as `handleMapTouchEnd`.
   */
  const handleMapTouchCancel = useCallback(() => {
    unlockScroll();
  }, [unlockScroll]);

  // Ref to hold the latest flush-save function (without router.back) so the
  // beforeRemove listener always calls the current version without stale closures.
  // flushSaveRef is reassigned every render so it closes over the latest state.
  const flushSaveRef = useRef<() => Promise<void>>(undefined);

  flushSaveRef.current = async () => {
    // Flush any pending edits for edit mode.
    // Use dirtyRef to cover content, tag-only, datetime-only, and
    // location-only mutations — all of which set dirtyRef but none of which
    // schedule a debounced autosave anymore (the debounce was removed to fix
    // a scroll-jump bug).
    if (isEditing && resolvedEntryId && dirtyRef.current && state.content.trim()) {
      // If a save is already in-flight, wait for it to finish. This
      // avoids a concurrent write to the same entry when the user presses
      // back while a save is pending.
      if (saveInFlightRef.current) {
        await saveInFlightRef.current;
      }
      // After awaiting the in-flight save, check again whether a save is still
      // needed — the in-flight save may have already handled everything.
      if (dirtyRef.current && state.content.trim()) {
        await doEditSaveRef.current?.();
      }
    }

    // For create mode, save if there is content
    if (!isEditing && state.content.trim()) {
      try {
        await actions.createEntry(state.content.trim(), state.datetime, state.tags, mapLocation);
      } catch {
        // silently fail; still proceed
      }
    }
  };

  /**
   * Intercepts the default back navigation to flush any pending save before allowing
   * the navigation to proceed. This ensures that unsaved changes (autosave in edit
   * mode, or new entries in create mode) are persisted before the screen is dismissed.
   *
   * A guard ref prevents infinite loops: once we start processing a back press,
   * subsequent beforeRemove events (e.g., from the dispatched action) are allowed
   * through.
   */
  const isLeavingRef = useRef(false);
  // Short-circuit the beforeRemove save-flush when the user explicitly deletes the
  // entry. Deleting already removes the row from the database; attempting to save
  // afterwards would recreate it or race against the deletion.
  const isDeletingRef = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (isLeavingRef.current || isDeletingRef.current) return;
      e.preventDefault();
      isLeavingRef.current = true;
      /** Flush save and then dispatch the original back navigation action. */
      const run = async () => {
        await flushSaveRef.current?.();
        navigation.dispatch(e.data.action);
      };
      void run();
    });
    return unsubscribe;
  }, [navigation]);

  /**
   * Adds a tag to the entry if it is not already present.
   *
   * Shared by the tag-input plus button and the autocomplete suggestion tap so both
   * paths apply identical bookkeeping for the new-tag case: push an undo snapshot, mark
   * the entry dirty, append the (deduplicated) tag, and clear the tag input.
   *
   * Returns true when the tag was added and false when it was already present, so each
   * caller can decide how to handle the duplicate case (the plus button leaves the
   * input intact so the user can edit it; the suggestion tap clears the input to
   * dismiss the dropdown).
   *
   * @param tagName - The tag name to add. Assumed already trimmed by the caller.
   *
   * @returns True if the tag was newly added, false if it was already present.
   */
  const addTagIfNew = useCallback(
    (tagName: string): boolean => {
      if (state.tags.includes(tagName)) return false;
      pushUndoState(state);
      dirtyRef.current = true;
      setState(draft => {
        draft.tags.push(tagName);
        draft.tagInput = '';
      });
      return true;
    },
    [state, setState, pushUndoState],
  );

  /**
   * Adds the current tag input value as a new tag on the entry.
   *
   * Trims whitespace from the input. Duplicate tags are silently ignored and the input
   * is left intact so the user can edit it (e.g. fix a typo). After adding a new tag,
   * the tag input is cleared so the user can type another tag.
   */
  const handleAddTag = useCallback(() => {
    const trimmedTag = state.tagInput.trim();
    if (trimmedTag) {
      // addTagIfNew returns false on duplicate — input is intentionally left
      // intact so the user can edit the text rather than re-typing it.
      addTagIfNew(trimmedTag);
    }
  }, [state.tagInput, addTagIfNew]);

  /**
   * Adds a tag selected from the autocomplete suggestions dropdown.
   *
   * Delegates to the shared `addTagIfNew` helper for the new-tag case. When the tag is
   * already present (defensive — the dropdown excludes already-added tags, but a race
   * could make one appear), the input is still cleared so the dropdown dismisses.
   *
   * @param tagName - The tag name selected from the suggestions dropdown.
   */
  const handleAddTagFromSuggestion = useCallback(
    (tagName: string) => {
      const added = addTagIfNew(tagName);
      if (!added) {
        // Tag already present — clear the input to dismiss the dropdown.
        setState(draft => {
          draft.tagInput = '';
        });
      }
    },
    [addTagIfNew, setState],
  );

  /**
   * Removes a tag from the entry.
   *
   * @param tagToRemove - The name of the tag to remove.
   */
  const handleRemoveTag = useCallback(
    (tagToRemove: string) => {
      pushUndoState(state);
      dirtyRef.current = true;
      setState(draft => {
        draft.tags = draft.tags.filter(tag => tag !== tagToRemove);
      });
    },
    [state, setState, pushUndoState],
  );

  /**
   * Updates entry content with timer-based keystroke coalescing for undo/redo.
   *
   * Fast consecutive content changes (within CONTENT_UNDO_COALESCE_MS) are collapsed
   * into a single undo entry so the user can undo an entire burst of typing in one
   * step. Each keystroke restarts the coalesce window.
   *
   * @param newContent - The updated content string.
   */
  const updateContent = useCallback(
    (newContent: string) => {
      // If we are not currently in a coalescing window, push an undo snapshot
      // before the first keystroke of this burst. Subsequent keystrokes within
      // CONTENT_UNDO_COALESCE_MS are coalesced into this single undo entry so
      // the user can undo an entire burst of typing in one step.
      if (!isContentUndoCoalescingRef.current) {
        pushUndoState(state);
        isContentUndoCoalescingRef.current = true;
      }
      // Reset the coalesce window timer: each keystroke restarts the window.
      clearTimeout(contentUndoTimerRef.current);
      contentUndoTimerRef.current = setTimeout(() => {
        isContentUndoCoalescingRef.current = false;
      }, CONTENT_UNDO_COALESCE_MS);

      // Mark the entry dirty so the back-navigation / AppState flush paths
      // persist the content change. The previous debounced autosave effect
      // set this flag; it is now set here directly.
      dirtyRef.current = true;

      setState(draft => {
        draft.content = newContent;
      });
    },
    [state, setState, pushUndoState],
  );

  const handleUndo = useCallback(() => {
    const undoStack = undoStackRef.current;
    if (undoStack.length === 0) return;
    // Push current undo-able state to redo stack so redo can reverse this undo.
    redoStackRef.current.push({
      content: state.content,
      datetime: state.datetime,
      tags: state.tags,
    });
    const snapshot = undoStack.pop()!;
    // Restore only the undo-able fields — transient UI state is untouched.
    setState(draft => {
      draft.content = snapshot.content;
      draft.datetime = snapshot.datetime;
      draft.tags = snapshot.tags;
    });
    setCanUndo(undoStack.length > 0);
    setCanRedo(true);
    // Reset coalescing state so the next keystroke starts a fresh undo entry.
    isContentUndoCoalescingRef.current = false;
    clearTimeout(contentUndoTimerRef.current);
  }, [state, setState]);

  const handleRedo = useCallback(() => {
    const redoStack = redoStackRef.current;
    if (redoStack.length === 0) return;
    // Push current undo-able state to undo stack so undo can reverse this redo.
    undoStackRef.current.push({
      content: state.content,
      datetime: state.datetime,
      tags: state.tags,
    });
    const snapshot = redoStack.pop()!;
    // Restore only the undo-able fields.
    setState(draft => {
      draft.content = snapshot.content;
      draft.datetime = snapshot.datetime;
      draft.tags = snapshot.tags;
    });
    setCanRedo(redoStack.length > 0);
    setCanUndo(true);
    // Reset coalescing state so the next keystroke starts a fresh undo entry.
    isContentUndoCoalescingRef.current = false;
    clearTimeout(contentUndoTimerRef.current);
  }, [state, setState]);

  /**
   * Opens the delete confirmation dialog.
   *
   * The actual deletion is deferred until the user confirms, preventing accidental data
   * loss from an accidental tap on the destructive header action.
   */
  const handleDeletePress = useCallback(() => {
    setDeleteDialogVisible(true);
  }, []);

  /** Closes the delete confirmation dialog without deleting the entry. */
  const handleCancelDelete = useCallback(() => {
    setDeleteDialogVisible(false);
  }, []);

  /**
   * Confirms deletion of the current entry.
   *
   * Sets a guard ref before navigating back so the shared `beforeRemove` listener does
   * not attempt to flush a pending autosave after the entry has been deleted. If
   * deletion fails, the dialog closes and the existing snackbar surfaces the ViewModel
   * error.
   */
  const handleConfirmDelete = useCallback(async () => {
    if (!resolvedEntryId) return;
    const success = await actions.deleteEntry(resolvedEntryId);
    setDeleteDialogVisible(false);
    if (success) {
      isDeletingRef.current = true;
      navigation.goBack();
    }
  }, [resolvedEntryId, actions, navigation]);

  /**
   * Handles a new date chosen in the date picker.
   *
   * The time-of-day (hours, minutes, seconds, and milliseconds) from the previously
   * selected datetime is preserved so that tapping the date widget only changes the
   * calendar day, not the clock time. A snapshot is pushed to the undo stack and the
   * dirty flag is set so the change is persisted on back navigation.
   *
   * @param param - Object containing the selected date from the modal.
   */
  const handleDateChange = useCallback(
    ({ date }: { date?: Date }) => {
      setDatePickerVisible(false);
      if (!date) return;

      const prev = state.datetime;
      const next = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        prev.getHours(),
        prev.getMinutes(),
        prev.getSeconds(),
        prev.getMilliseconds(),
      );

      pushUndoState(state);
      dirtyRef.current = true;
      setState(draft => {
        draft.datetime = next;
      });
    },
    [state, setState, pushUndoState],
  );

  /**
   * Handles a new time chosen in the time picker.
   *
   * The calendar date (year, month, day) plus seconds and milliseconds from the
   * previously selected datetime are preserved so that tapping the time widget only
   * changes the clock hours and minutes, not the day or sub-minute precision. A
   * snapshot is pushed to the undo stack and the dirty flag is set so the change is
   * persisted on back navigation.
   *
   * @param param - Object containing the selected hours and minutes from the modal.
   *   Either field may be undefined when the user dismisses without choosing; in that
   *   case the handler is a no-op.
   */
  const handleTimeChange = useCallback(
    ({ hours, minutes }: { hours?: number; minutes?: number }) => {
      setTimePickerVisible(false);
      // Guard: the modal may invoke onConfirm with no values when the user
      // cancels mid-selection. Treat that as a no-op so the existing time is
      // preserved and no undo snapshot is pushed.
      if (hours === undefined || minutes === undefined) return;

      const prev = state.datetime;
      // Keep seconds/ms intact so editing the clock doesn't silently zero out
      // sub-minute precision the user never touched.
      const next = new Date(
        prev.getFullYear(),
        prev.getMonth(),
        prev.getDate(),
        hours,
        minutes,
        prev.getSeconds(),
        prev.getMilliseconds(),
      );

      pushUndoState(state);
      dirtyRef.current = true;
      setState(draft => {
        draft.datetime = next;
      });
    },
    [state, setState, pushUndoState],
  );

  return (
    <SafeAreaView
      testID="entry-editor-root"
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={['top', 'bottom', 'left', 'right']}
    >
      <Appbar.Header statusBarHeight={0} testID="appbar-header">
        <Appbar.BackAction onPress={() => navigation.goBack()} />
        <Appbar.Content title={isEditing ? 'Edit Entry' : 'New Entry'} />
        <Appbar.Action
          icon="undo"
          testID="undo-button"
          accessibilityLabel="Undo"
          onPress={handleUndo}
          disabled={!canUndo}
        />
        <Appbar.Action
          icon="redo"
          testID="redo-button"
          accessibilityLabel="Redo"
          onPress={handleRedo}
          disabled={!canRedo}
        />
        {isEditing && (
          <Appbar.Action
            icon="trash-can"
            testID="delete-entry-button"
            accessibilityLabel="Delete entry"
            onPress={handleDeletePress}
          />
        )}
      </Appbar.Header>

      <ScrollView
        ref={scrollViewRef}
        style={styles.content}
        keyboardShouldPersistTaps="handled"
        testID="entry-scroll-view"
      >
        <TextInput
          testID="entry-content-input"
          accessibilityLabel="Journal entry content"
          label="What's on your mind?"
          value={state.content}
          onChangeText={updateContent}
          multiline
          numberOfLines={10}
          style={styles.contentInput}
          mode="outlined"
          placeholder="Start writing your journal entry..."
        />

        <Surface style={styles.tagsSection}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Tags
          </Text>

          <TextInput
            testID="tag-input"
            label="Add tags"
            value={state.tagInput}
            onChangeText={text =>
              setState(draft => {
                draft.tagInput = text;
              })
            }
            onSubmitEditing={handleAddTag}
            mode="outlined"
            style={styles.tagInput}
            right={
              <TextInput.Icon
                icon="plus"
                testID="add-tag-icon"
                onPress={handleAddTag}
                disabled={!state.tagInput.trim()}
              />
            }
          />

          {/* Tag autocomplete dropdown. Shown only when the tag input is
              non-empty and there are matching existing tags not already added
              to the entry. Tapping a suggestion adds it via the same logic as
              handleAddTag (trim, deduplicate, push undo, mark dirty, clear
              input). The dropdown dismisses when the input is cleared or a
              suggestion is tapped. */}
          {tagSuggestions.length > 0 && (
            <Surface testID="tag-suggestions" style={styles.tagSuggestions}>
              {tagSuggestions.map(suggestion => (
                <Chip
                  key={suggestion}
                  testID={`tag-suggestion-${suggestion}`}
                  accessibilityLabel={`Add tag ${suggestion}`}
                  accessibilityHint="Adds this tag to the entry"
                  onPress={() => handleAddTagFromSuggestion(suggestion)}
                  style={styles.tagSuggestion}
                  textStyle={styles.tagSuggestionText}
                >
                  {suggestion}
                </Chip>
              ))}
            </Surface>
          )}

          <View style={styles.tagsContainer}>
            {state.tags.map((tag, index) => (
              <Chip
                key={index}
                onClose={() => handleRemoveTag(tag)}
                style={styles.tag}
                textStyle={styles.tagText}
              >
                {tag}
              </Chip>
            ))}
          </View>
        </Surface>

        {/* Two independent buttons: one for the calendar date, one for the
            clock time. Splitting them lets the user change only the time
            without touching the date (and vice versa) — the time picker is
            skippable by default; if the user never taps it, the existing
            time-of-day is preserved. */}
        <View style={styles.dateTimeRow}>
          <Button
            mode="outlined"
            icon="calendar-edit"
            testID="entry-date-button"
            accessibilityLabel="Entry date"
            onPress={() => setDatePickerVisible(true)}
            textColor={theme.colors.primary}
            style={styles.dateButton}
          >
            <Text
              testID="entry-date-text"
              variant="bodySmall"
              style={[styles.dateText, { color: theme.colors.primary }]}
            >
              {state.datetime.toLocaleDateString()}
            </Text>
          </Button>

          <Button
            mode="outlined"
            icon="clock-outline"
            testID="entry-time-button"
            accessibilityLabel="Entry time"
            onPress={() => setTimePickerVisible(true)}
            textColor={theme.colors.primary}
            style={styles.timeButton}
          >
            <Text
              testID="entry-time-text"
              variant="bodySmall"
              style={[styles.dateText, { color: theme.colors.primary }]}
            >
              {state.datetime.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </Button>
        </View>

        <Surface style={styles.locationSection}>
          <View style={styles.locationHeader}>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              Location
            </Text>
            <IconButton
              icon="crosshairs-gps"
              testID="recenter-button"
              accessibilityLabel="Re-center to current location"
              size={20}
              onPress={handleRecenter}
              disabled={state.isFetchingLocation}
            />
          </View>
          {isEditing && !existingEntry?.location && !state.editLocation && (
            <Text
              variant="bodySmall"
              style={[styles.locationHint, { color: theme.colors.onSurfaceVariant }]}
            >
              No location was recorded for this entry.
            </Text>
          )}

          {!isEditing && state.locDenied && (
            <Text
              variant="bodySmall"
              style={[styles.locationHint, { color: theme.colors.onSurfaceVariant }]}
            >
              Location permission not granted. You can still save the entry without a location.
            </Text>
          )}

          {state.locError && (
            <Text
              variant="bodySmall"
              testID="location-error-text"
              style={[styles.locationHint, { color: theme.colors.error }]}
            >
              {state.locError}
            </Text>
          )}

          {/* Show spinner only when actively fetching a GPS position and no
              map center is available yet. In edit mode with no saved location
              and no active fetch, the spinner must not appear (Goal 2). */}
          {!mapCenter && state.isFetchingLocation && !state.locDenied && (
            <View style={styles.mapLoading}>
              <ActivityIndicator animating={true} />
              <Text
                variant="bodySmall"
                style={[styles.locationHint, { color: theme.colors.onSurfaceVariant }]}
              >
                Loading map…
              </Text>
            </View>
          )}

          {mapCenter && mapLocation && (
            <View
              style={styles.mapContainer}
              testID="map-container"
              onTouchStart={handleMapTouchStart}
              onTouchEnd={handleMapTouchEnd}
              onTouchCancel={handleMapTouchCancel}
            >
              {/* Geocoded location text above the map */}
              {mapLocation.address ? (
                <Text
                  variant="bodySmall"
                  testID="location-address-text"
                  style={[styles.locationAddressText, { color: theme.colors.onSurfaceVariant }]}
                >
                  {mapLocation.address}
                </Text>
              ) : (
                <Text
                  variant="bodySmall"
                  testID="location-coordinates-text"
                  style={[styles.locationAddressText, { color: theme.colors.onSurfaceVariant }]}
                >
                  {mapLocation.latitude.toFixed(4)}, {mapLocation.longitude.toFixed(4)}
                </Text>
              )}
              <Map
                testID="entry-location-map"
                mapStyle={MAP_STYLE_URL}
                style={styles.map}
                dragPan={true}
                touchZoom={true}
                touchRotate={false}
                touchPitch={false}
                onRegionDidChange={handleRegionDidChange}
              >
                {/* duration provides an animated transition when the center prop
                    changes (e.g. after re-center), rather than an instant snap. */}
                <Camera center={mapCenter} zoom={15} duration={500} />
              </Map>
              {/*
                Fixed centre pin rendered over the map.
                pointerEvents="none" lets touch gestures pass through to the
                map underneath.
              */}
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <View style={styles.markerContainer}>
                  <View style={styles.markerDot} />
                </View>
              </View>
            </View>
          )}
        </Surface>
      </ScrollView>

      {state.autoSaving && (
        <Text
          testID="autosave-indicator"
          variant="bodySmall"
          style={[styles.autoSaveText, { color: theme.colors.onSurfaceVariant }]}
        >
          Auto-saving...
        </Text>
      )}
      {isEditing && state.lastSaved && (
        <Text
          variant="bodySmall"
          testID="saved-indicator"
          accessibilityLabel="Saved"
          style={[styles.autoSaveText, { color: theme.colors.onSurfaceVariant }]}
        >
          Saved {state.lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      )}

      <Snackbar
        visible={!!state.error}
        onDismiss={() =>
          setState(draft => {
            draft.error = null;
          })
        }
        duration={3000}
        action={{
          label: 'Dismiss',
          onPress: () =>
            setState(draft => {
              draft.error = null;
            }),
        }}
      >
        {state.error}
      </Snackbar>

      <Portal>
        <Dialog
          visible={deleteDialogVisible}
          onDismiss={handleCancelDelete}
          testID="delete-entry-dialog"
        >
          <Dialog.Title>Delete entry?</Dialog.Title>
          <Dialog.Content>
            <Text>This action cannot be undone.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              onPress={handleCancelDelete}
              testID="delete-entry-cancel-button"
              accessibilityLabel="Cancel delete"
            >
              Cancel
            </Button>
            <Button
              onPress={handleConfirmDelete}
              testID="delete-entry-confirm-button"
              accessibilityLabel="Confirm delete"
            >
              Delete
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {datePickerVisible && (
        <View testID="date-picker-modal">
          <DatePickerModal
            locale="en"
            mode="single"
            visible={datePickerVisible}
            onDismiss={() => setDatePickerVisible(false)}
            date={state.datetime}
            onConfirm={handleDateChange}
          />
        </View>
      )}

      {timePickerVisible && (
        <View testID="time-picker-modal">
          <TimePickerModal
            locale="en"
            visible={timePickerVisible}
            onDismiss={() => setTimePickerVisible(false)}
            onConfirm={handleTimeChange}
            hours={state.datetime.getHours()}
            minutes={state.datetime.getMinutes()}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  contentInput: {
    marginBottom: 16,
    minHeight: 400,
  },
  tagsSection: {
    padding: 16,
    marginBottom: 16,
    borderRadius: 8,
  },
  sectionTitle: {
    marginBottom: 12,
  },
  tagInput: {
    marginBottom: 12,
  },
  tagSuggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 8,
    marginBottom: 12,
    borderRadius: 8,
    elevation: 2,
  },
  tagSuggestion: {
    marginRight: 8,
    marginBottom: 4,
  },
  tagSuggestionText: {
    fontSize: 12,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  tag: {
    marginRight: 8,
    marginBottom: 4,
  },
  tagText: {
    fontSize: 12,
  },
  dateButton: {
    alignSelf: 'center',
  },
  timeButton: {
    alignSelf: 'center',
    marginLeft: 8,
  },
  dateTimeRow: {
    flexDirection: 'row',
    // Wrap so the time button drops below the date button on narrow screens or
    // long locale strings (e.g. German weekday+month) instead of clipping.
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateText: {
    textAlign: 'center',
  },
  autoSaveText: {
    textAlign: 'center',
    marginTop: 4,
  },
  locationSection: {
    padding: 16,
    borderRadius: 8,
    marginTop: 16,
    marginBottom: 24,
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  locationHint: {
    marginBottom: 8,
  },
  mapContainer: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  map: {
    width: '100%',
    height: 200,
  },
  mapLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 200,
  },
  markerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#e74c3c',
    borderWidth: 2,
    borderColor: '#fff',
  },
  locationAddressText: {
    marginBottom: 4,
    textAlign: 'center',
  },
});
