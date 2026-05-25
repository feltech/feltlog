import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import {
  Appbar,
  Chip,
  Snackbar,
  Surface,
  Text,
  TextInput,
  ActivityIndicator,
} from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MapView, Camera } from '@maplibre/maplibre-react-native';
import * as ExpoLocation from 'expo-location';
import { useImmer } from 'use-immer';

import { useJournalViewModel } from '@/src/presentation/viewmodels/JournalViewModel';
import type { JournalEntry } from '@/src/domain/entities/JournalEntry';

const AUTOSAVE_DELAY_MS = 500;
const MAX_HISTORY_LENGTH = 50;
const GEOCODE_DEBOUNCE_MS = 600;
const GEOCODE_TIMEOUT_MS = 3000;
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
  /** Whether location permission was denied. */
  locDenied: boolean;
  /** Whether a reverse-geocode is in progress. */
  isUpdatingLocation: boolean;
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
  const router = useRouter();
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
    locDenied: false,
    isUpdatingLocation: false,
  });

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingSaveRef = useRef(false);
  // Tracks whether a save API call is currently in-flight to prevent stacking.
  const savingRef = useRef(false);
  // Ref to a stable autosave function that always has access to latest state.
  // Avoids re-running the debounce effect when non-content deps (like actions)
  // change.
  const autosaveFnRef = useRef<() => Promise<void>>(undefined);

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

  // Timer-based keystroke coalescing for undo/redo: fast consecutive content
  // changes are collapsed into a single undo entry so the user can undo an
  // entire burst of typing in one step.
  const contentUndoTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isContentUndoCoalescingRef = useRef(false);

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
        draft.content = existingEntry.content;
        draft.datetime = existingEntry.datetime;
        draft.tags = existingEntry.tags;
      });
    }
  }, [existingEntry, setState]);

  // On create (not editing), request permission and fetch current location
  useEffect(() => {
    let cancelled = false;
    /** Fetches the current location and reverse geocodes it. */
    const fetchLocation = async () => {
      if (isEditing) return; // Only for new entries
      try {
        setState(draft => {
          draft.locDenied = false;
        });
        const perm = await ExpoLocation.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          if (!cancelled) {
            setState(draft => {
              draft.locDenied = true;
            });
          }
          return;
        }
        const pos = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        });
        // Reverse geocode is optional; keep fast path. Attempt but ignore
        // failure. Disable the back button during the geocode so the user
        // isn't tempted to leave before the address resolves.
        let address: string | undefined = undefined;
        try {
          setState(draft => {
            draft.isUpdatingLocation = true;
          });
          const geos = await ExpoLocation.reverseGeocodeAsync({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
          if (geos && geos.length > 0) {
            address = formatAddress(geos[0]);
          }
        } catch {
          // ignore reverse geocode errors
        } finally {
          setState(draft => {
            draft.isUpdatingLocation = false;
          });
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
          });
        }
      } catch {
        if (!cancelled) {
          setState(draft => {
            draft.locDenied = true;
          });
        }
      } finally {
        if (!cancelled) {
          // fetchLocation finished
        }
      }
    };
    void fetchLocation();
    return () => {
      cancelled = true;
    };
  }, [isEditing, setState]);

  // Stable autosave fn — reassigned every render to close over latest state.
  // Only called from the debounce timeout, never during render.
  autosaveFnRef.current = async () => {
    if (!isEditing || !resolvedEntryId || !state.content.trim()) return;
    if (savingRef.current) {
      pendingSaveRef.current = true;
      return;
    }
    savingRef.current = true;
    pendingSaveRef.current = false;
    setState(draft => {
      draft.autoSaving = true;
    });
    try {
      await actions.updateEntry(resolvedEntryId, {
        content: state.content.trim(),
        datetime: state.datetime,
        tags: state.tags,
      });
      setState(draft => {
        draft.lastSaved = new Date();
      });
    } catch {
      // silently fail autosave
    } finally {
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

  // Autosave: debounced save after content changes (edit mode only).
  useEffect(() => {
    if (!isEditing || !state.content.trim()) return;
    pendingSaveRef.current = true;
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
    };
  }, []);

  const mapLocation = useMemo(() => {
    return existingEntry?.location ?? state.currentLocation;
  }, [existingEntry?.location, state.currentLocation]);

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
   * Called when the map region finishes changing after a user gesture. Updates the
   * target location to the new centre coordinate.
   *
   * @param feature - GeoJSON feature containing the new region payload.
   */
  const handleRegionDidChange = useCallback(
    (feature: GeoJSON.Feature) => {
      if (isEditing) return;

      const props = feature.properties as { isUserInteraction?: boolean } | null;
      // Only react to user-driven gestures, not programmatic camera moves.
      if (!props?.isUserInteraction) return;

      const geom = feature.geometry;
      if (geom.type !== 'Point') return;
      const [newLng, newLat] = (geom as GeoJSON.Point).coordinates;

      // Update coordinates immediately so the save uses the right location.
      // Elevation is reset to 0 because there is no elevation API for arbitrary
      // coordinates — only the initial GPS fetch provides real altitude data.
      setState(draft => {
        if (draft.currentLocation) {
          draft.currentLocation = {
            ...draft.currentLocation,
            latitude: newLat,
            longitude: newLng,
            elevation: 0,
          };
        }
      });

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
            // If currentLocation is undefined (e.g. permission was denied and the
            // map never loaded), we drop the update — the map wouldn't be visible
            // anyway, so there's nothing to geocode.
            setState(draft => {
              if (draft.currentLocation) {
                draft.currentLocation = {
                  ...draft.currentLocation,
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

  /**
   * Persists the entry and navigates back. For edit mode, flushes any pending autosave.
   * For create mode, creates the entry if there is content.
   *
   * The back button is disabled while a geocode is in-flight, but if this function is
   * somehow called during that window (e.g. via a hardware back gesture), we still save
   * whatever data we have and navigate back — the coordinates are already updated in
   * currentLocation from the last handleRegionDidChange call, so only the address might
   * be stale. This is much safer than silently discarding data.
   */
  const handleSaveAndClose = useCallback(async () => {
    // Flush any pending autosave for edit mode
    clearTimeout(autosaveTimerRef.current);
    if (isEditing && resolvedEntryId && pendingSaveRef.current && state.content.trim()) {
      try {
        await actions.updateEntry(resolvedEntryId, {
          content: state.content.trim(),
          datetime: state.datetime,
          tags: state.tags,
        });
      } catch {
        // silently fail; navigate back anyway
      }
    }

    // For create mode, save if there is content
    if (!isEditing && state.content.trim()) {
      try {
        await actions.createEntry(state.content.trim(), state.datetime, state.tags, mapLocation);
      } catch {
        // silently fail; still navigate back
      }
    }

    router.back();
  }, [
    isEditing,
    resolvedEntryId,
    state.content,
    state.datetime,
    state.tags,
    mapLocation,
    actions,
    router,
  ]);

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
    <SafeAreaView style={styles.container}>
      <Appbar.Header>
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
        <Appbar.BackAction
          testID="back"
          accessibilityLabel="Go back"
          onPress={handleSaveAndClose}
          disabled={state.isUpdatingLocation}
        />
        <Appbar.Content title={isEditing ? 'Edit Entry' : 'New Entry'} />
      </Appbar.Header>

      {state.isUpdatingLocation && (
        <Text variant="bodySmall" style={styles.locationUpdatingHint}>
          Looking up address, please wait…
        </Text>
      )}

      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
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
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Location
          </Text>
          {isEditing && !existingEntry?.location && (
            <Text variant="bodySmall" style={styles.locationHint}>
              No location was recorded for this entry.
            </Text>
          )}

          {!isEditing && state.locDenied && (
            <Text variant="bodySmall" style={styles.locationHint}>
              Location permission not granted. You can still save the entry without a location.
            </Text>
          )}

          {!mapCenter && !state.locDenied && (
            <View style={styles.mapLoading}>
              <ActivityIndicator animating={true} />
              <Text variant="bodySmall" style={styles.locationHint}>
                Loading map…
              </Text>
            </View>
          )}

          {mapCenter && mapLocation && (
            <View style={styles.mapContainer}>
              <MapView
                testID="entry-location-map"
                mapStyle={MAP_STYLE_URL}
                style={styles.map}
                scrollEnabled={!isEditing}
                zoomEnabled={!isEditing}
                rotateEnabled={false}
                pitchEnabled={false}
                onRegionDidChange={handleRegionDidChange}
              >
                <Camera
                  defaultSettings={{
                    centerCoordinate: mapCenter,
                    zoomLevel: 15,
                  }}
                />
              </MapView>
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
});
