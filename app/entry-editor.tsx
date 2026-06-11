import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Platform, ScrollView, StyleSheet, View, type NativeSyntheticEvent } from 'react-native';
import {
  Appbar,
  Chip,
  IconButton,
  Snackbar,
  Surface,
  Text,
  TextInput,
  ActivityIndicator,
} from 'react-native-paper';
import { useLocalSearchParams } from 'expo-router';
import { useNavigation } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Map, Camera, type ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import * as ExpoLocation from 'expo-location';
import { useImmer } from 'use-immer';

import { useJournalViewModel } from '@/src/presentation/viewmodels/JournalViewModel';
import type { JournalEntry } from '@/src/domain/entities/JournalEntry';

const AUTOSAVE_DELAY_MS = 500;
const MAX_HISTORY_LENGTH = 50;
const GEOCODE_DEBOUNCE_MS = 600;
const GEOCODE_TIMEOUT_MS = 3000;
/** Timeout for getCurrentPositionAsync (does not accept a timeout option). */
const POSITION_TIMEOUT_MS = 15000;
/** Timeout for the reverseGeocodeAsync call during the initial location fetch. */
const INITIAL_GEOCODE_TIMEOUT_MS = 15000;
const CONTENT_UNDO_COALESCE_MS = 500;
/**
 * How long to keep the outer ScrollView locked after the last user-driven map region
 * change. Subsequent onRegionDidChange events with userInteraction reset this timer, so
 * rapid drags keep scrolling disabled until the user pauses.
 */
const MAP_INTERACTION_LOCK_MS = 300;
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
  /** Whether a reverse-geocode is in progress. */
  isUpdatingLocation: boolean;
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
function formatAddress(geocode: ExpoLocation.LocationGeocodedAddress): string | undefined {
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
export default function JournalEntryModal() {
  const { entryId } = useLocalSearchParams<{ entryId?: string }>();
  const resolvedEntryId: string | undefined = Array.isArray(entryId) ? entryId[0] : entryId;
  const { state: vmState, actions } = useJournalViewModel();

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
    isUpdatingLocation: false,
    isFetchingLocation: false,
  });

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingSaveRef = useRef(false);
  // Tracks whether any saveable field (content, tags, datetime) has changed
  // since the last successful save. Unlike pendingSaveRef (which is only set
  // by the autosave debounce for content changes), dirtyRef covers tag-only
  // and datetime-only mutations so that flushSaveRef persist them on back
  // navigation even when no autosave was scheduled.
  const dirtyRef = useRef(false);
  // Tracks whether a save API call is currently in-flight to prevent stacking.
  const savingRef = useRef(false);
  // Holds the in-flight save promise so flushSave can await it instead of
  // starting a concurrent write.
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  // Ref to a stable autosave function that always has access to latest state.
  // Avoids re-running the debounce effect when non-content deps (like actions)
  // change.
  const autosaveFnRef = useRef<() => Promise<void>>(undefined);
  // Prevents the sync effect from overwriting the user's current editing
  // content with a trimmed DB value after autosave completes. Content is
  // initialized from the existing entry once on mount only.
  //
  // NOTE: If entryId were ever to change while the modal stays mounted
  // (e.g., deep-link navigation swapping entries in-place), this ref would
  // need to be reset so the new entry's content loads. In the current Expo
  // Router model the modal is always pushed/popped, so this is not a concern.
  const contentInitializedRef = useRef(false);

  // Ref to the shared edit-save function. Reassigned every render to close over
  // the latest state. Both autosaveFnRef and flushSaveRef call this to avoid
  // duplicating the save payload and the bookkeeping around
  // savingRef / saveInFlightRef / pendingSaveRef.
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
  // Tracks whether the user is touching the map area, so the outer
  // ScrollView can disable its scroll to let map gestures through.
  const [isMapTouched, setIsMapTouched] = useState(false);
  // Timer ref for the debounce that re-enables ScrollView scrolling after
  // the last user-driven map region change. Cleared on unmount.
  const mapInteractionTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

  const existingEntry = resolvedEntryId
    ? vmState.entries.find(e => e.id === resolvedEntryId)
    : null;
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
          // Log the error to aid diagnostics if location fetch fails in the emulator.
          console.warn('[EntryEditor] Initial location fetch failed:', err);
          // getCurrentPositionAsync failed or timed out — try the cached
          // last-known position as a fallback. This is useful when a fresh
          // GPS fix isn't available (e.g. indoors, emulator without mock GPS,
          // or weak signal).
          try {
            if (process.env.NODE_ENV !== 'test') {
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
          setState(draft => {
            draft.isUpdatingLocation = true;
          });
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
        } finally {
          if (!cancelled) {
            setState(draft => {
              draft.isUpdatingLocation = false;
            });
          }
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
  // payload and bookkeeping between autosaveFnRef and flushSaveRef.
  // Reassigned every render to close over the latest state and actions.
  doEditSaveRef.current = async () => {
    if (!resolvedEntryId) return;
    savingRef.current = true;
    pendingSaveRef.current = false;
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
      // silently fail autosave
    } finally {
      saveInFlightRef.current = null;
      setState(draft => {
        draft.autoSaving = false;
      });
      savingRef.current = false;
      // If content changed while saving, debounce another save so
      // the "Saved" indicator is briefly visible between saves.
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = setTimeout(() => {
          autosaveFnRef.current?.();
        }, AUTOSAVE_DELAY_MS);
      }
    }
  };

  // Stable autosave fn — reassigned every render to close over latest state.
  // Only called from the debounce timeout, never during render.
  autosaveFnRef.current = async () => {
    if (!isEditing || !resolvedEntryId || !state.content.trim()) return;
    if (savingRef.current) {
      pendingSaveRef.current = true;
      return;
    }
    await doEditSaveRef.current?.();
  };

  // Autosave: debounced save after content changes (edit mode only).
  useEffect(() => {
    if (!isEditing || !state.content.trim()) return;
    pendingSaveRef.current = true;
    dirtyRef.current = true;
    clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveFnRef.current?.();
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(autosaveTimerRef.current);
    // NOTE: intentionally omit actions/date/tags from deps – the ref closure
    // always reads latest values, and only content changes should trigger a
    // save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, state.content]);

  // Cleanup timers on unmount.
  useEffect(() => {
    return () => {
      clearTimeout(autosaveTimerRef.current);
      clearTimeout(geoDebounceRef.current);
      clearTimeout(contentUndoTimerRef.current);
      clearTimeout(mapInteractionTimerRef.current);
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
        // Log the error to aid diagnostics if re-center fails in the emulator.
        console.warn('[EntryEditor] Re-center location fetch failed:', err);
        // getCurrentPositionAsync failed or timed out — try the cached
        // last-known position as a fallback. This is useful when a fresh
        // GPS fix isn't available (e.g. indoors, emulator without mock GPS,
        // or weak signal).
        try {
          if (process.env.NODE_ENV !== 'test') {
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
        setState(draft => {
          draft.isUpdatingLocation = true;
        });
        address = await reverseGeocodeWithTimeout(pos.coords.latitude, pos.coords.longitude);
      } catch {
        // ignore
      } finally {
        setState(draft => {
          draft.isUpdatingLocation = false;
        });
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
   * scrolling is disabled so map gestures are not stolen by the parent ScrollView. The
   * lock auto-releases after MAP_INTERACTION_LOCK_MS of inactivity.
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
      // Manage the ScrollView scroll lock based on user interaction.
      // Each user-driven region change disables scrolling and starts (or
      // restarts) a debounce timer. While the user keeps dragging, repeated
      // events keep resetting the timer, so scrolling stays disabled. Once
      // the user stops for MAP_INTERACTION_LOCK_MS, the timer fires and
      // scrolling re-enables.
      if (userInteraction) {
        setIsMapTouched(true);
        clearTimeout(mapInteractionTimerRef.current);
        mapInteractionTimerRef.current = setTimeout(() => {
          setIsMapTouched(false);
        }, MAP_INTERACTION_LOCK_MS);
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

      setState(draft => {
        draft.isUpdatingLocation = true;
      });
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
        } finally {
          // Always clear the updating flag for this geocode generation,
          // even if the component unmounted or an error occurred.
          if (geocodeId === pendingGeocodeRef.current) {
            setState(draft => {
              draft.isUpdatingLocation = false;
            });
          }
        }
      }, GEOCODE_DEBOUNCE_MS);
    },
    [isEditing, reverseGeocodeWithTimeout, setState],
  );

  // Ref to hold the latest flush-save function (without router.back) so the
  // beforeRemove listener always calls the current version without stale closures.
  // flushSaveRef is reassigned every render so it closes over the latest state.
  const flushSaveRef = useRef<() => Promise<void>>(undefined);

  flushSaveRef.current = async () => {
    // Flush any pending autosave for edit mode.
    // Use dirtyRef instead of pendingSaveRef to also cover tag-only and
    // datetime-only mutations that never trigger the content-based autosave.
    clearTimeout(autosaveTimerRef.current);
    if (isEditing && resolvedEntryId && dirtyRef.current && state.content.trim()) {
      // If an autosave is already in-flight, wait for it to finish. This
      // avoids a concurrent write to the same entry when the user presses
      // back while an autosave is pending.
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
  const navigation = useNavigation();

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (isLeavingRef.current) return;
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
   * Adds the current tag input value as a new tag on the entry.
   *
   * Trims whitespace from the input. Duplicate tags are silently ignored. After adding,
   * the tag input is cleared so the user can type another tag.
   */
  const handleAddTag = useCallback(() => {
    const trimmedTag = state.tagInput.trim();
    if (trimmedTag && !state.tags.includes(trimmedTag)) {
      pushUndoState(state);
      dirtyRef.current = true;
      setState(draft => {
        draft.tags.push(trimmedTag);
        draft.tagInput = '';
      });
    }
  }, [state, setState, pushUndoState]);

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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
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
      </Appbar.Header>

      {state.isUpdatingLocation && (
        <Text variant="bodySmall" style={styles.locationUpdatingHint}>
          Looking up address, please wait…
        </Text>
      )}

      <ScrollView
        style={styles.content}
        keyboardShouldPersistTaps="handled"
        testID="entry-scroll-view"
        scrollEnabled={!isMapTouched}
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

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tagsContainer}
          >
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
          </ScrollView>
        </Surface>

        <Text variant="bodySmall" style={styles.dateText}>
          {state.datetime.toLocaleDateString()}{' '}
          {state.datetime.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>

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
            <Text variant="bodySmall" style={styles.locationHint}>
              No location was recorded for this entry.
            </Text>
          )}

          {!isEditing && state.locDenied && (
            <Text variant="bodySmall" style={styles.locationHint}>
              Location permission not granted. You can still save the entry without a location.
            </Text>
          )}

          {state.locError && (
            <Text variant="bodySmall" style={styles.locationHint}>
              {state.locError}
            </Text>
          )}

          {/* Show spinner only when actively fetching a GPS position and no
              map center is available yet. In edit mode with no saved location
              and no active fetch, the spinner must not appear (Goal 2). */}
          {!mapCenter && state.isFetchingLocation && !state.locDenied && (
            <View style={styles.mapLoading}>
              <ActivityIndicator animating={true} />
              <Text variant="bodySmall" style={styles.locationHint}>
                Loading map…
              </Text>
            </View>
          )}

          {mapCenter && mapLocation && (
            <View
              style={styles.mapContainer}
              testID="map-container"
              onTouchStart={() => {
                setIsMapTouched(true);
              }}
              onTouchEnd={() => {
                setIsMapTouched(false);
              }}
              onTouchCancel={() => {
                setIsMapTouched(false);
              }}
            >
              {/* Geocoded location text above the map */}
              {state.isUpdatingLocation ? (
                <Text
                  variant="bodySmall"
                  testID="location-address-placeholder"
                  style={styles.locationAddressText}
                >
                  Getting address…
                </Text>
              ) : mapLocation.address ? (
                <Text
                  variant="bodySmall"
                  testID="location-address-text"
                  style={styles.locationAddressText}
                >
                  {mapLocation.address}
                </Text>
              ) : (
                <Text
                  variant="bodySmall"
                  testID="location-coordinates-text"
                  style={styles.locationAddressText}
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

          {state.isUpdatingLocation && (
            <View style={styles.locationUpdating}>
              <ActivityIndicator animating={true} size={16} />
              <Text variant="bodySmall" style={styles.locationUpdatingText}>
                Updating location…
              </Text>
            </View>
          )}
        </Surface>
      </ScrollView>

      {state.autoSaving && (
        <Text variant="bodySmall" style={styles.autoSaveText}>
          Auto-saving...
        </Text>
      )}
      {isEditing && state.lastSaved && (
        <Text
          variant="bodySmall"
          testID="saved-indicator"
          accessibilityLabel="Saved"
          style={styles.autoSaveText}
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

      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  contentInput: {
    marginBottom: 16,
    minHeight: 200,
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
  tagsContainer: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  tag: {
    marginRight: 8,
    marginBottom: 4,
  },
  tagText: {
    fontSize: 12,
  },
  dateText: {
    textAlign: 'center',
    color: '#666',
  },
  autoSaveText: {
    textAlign: 'center',
    color: '#999',
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
    color: '#666',
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
  locationUpdating: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  locationUpdatingText: {
    color: '#666',
    marginLeft: 8,
  },
  locationUpdatingHint: {
    textAlign: 'center',
    color: '#999',
    paddingVertical: 2,
  },
  locationAddressText: {
    color: '#555',
    marginBottom: 4,
    textAlign: 'center',
  },
});
