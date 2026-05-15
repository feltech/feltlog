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
import { MapView, Camera, MarkerView } from '@maplibre/maplibre-react-native';
import * as ExpoLocation from 'expo-location';

import { useJournalViewModel } from '@/src/presentation/viewmodels/JournalViewModel';
import type { JournalEntry } from '@/src/domain/entities/JournalEntry';

const AUTOSAVE_DELAY_MS = 500;
const MAX_HISTORY_LENGTH = 50;
const MAP_STYLE_URL = 'https://demotiles.maplibre.org/style.json';

/**
 * Modal screen for creating or editing a journal entry.
 *
 * @returns The rendered modal screen.
 */
export default function JournalEntryModal() {
  const router = useRouter();
  const { entryId } = useLocalSearchParams();
  const { state, actions } = useJournalViewModel();

  const [content, setContent] = useState('');
  const [datetime, setDatetime] = useState(new Date());
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [autoSaving, setAutoSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const pendingSaveRef = useRef(false);
  // Tracks whether a save API call is currently in-flight to prevent stacking.
  const savingRef = useRef(false);
  // Ref to a stable autosave function that always has access to latest state.
  // Avoids re-running the debounce effect when non-content deps (like actions) change.
  const autosaveFnRef = useRef<() => Promise<void>>();

  // Undo/redo history stack
  const [history, setHistory] = useState<string[]>(['']);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Location state for map rendering when creating a new entry.
  const [currentLocation, setCurrentLocation] = useState<JournalEntry['location'] | undefined>(
    undefined,
  );
  const [locDenied, setLocDenied] = useState(false);

  const existingEntry = entryId ? state.entries.find(e => e.id === entryId) : null;
  const isEditing = !!existingEntry;

  useEffect(() => {
    if (existingEntry) {
      setContent(existingEntry.content);
      setDatetime(existingEntry.datetime);
      setTags(existingEntry.tags);
    }
  }, [existingEntry]);

  // On create (not editing), request permission and fetch current location
  useEffect(() => {
    let cancelled = false;
    /** Fetches the current location and reverse geocodes it. */
    const fetchLocation = async () => {
      if (isEditing) return; // Only for new entries
      try {
        setLocDenied(false);
        const perm = await ExpoLocation.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          if (!cancelled) setLocDenied(true);
          return;
        }
        const pos = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        });
        // Reverse geocode is optional; keep fast path. Attempt but ignore failure.
        let address: string | undefined = undefined;
        try {
          const geos = await ExpoLocation.reverseGeocodeAsync({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
          if (geos && geos.length > 0) {
            const g = geos[0];
            address = [g.name, g.street, g.city, g.region, g.postalCode, g.country]
              .filter(Boolean)
              .join(', ');
          }
        } catch {
          // ignore reverse geocode errors
        }
        const elevation = typeof pos.coords.altitude === 'number' ? (pos.coords.altitude ?? 0) : 0;
        const loc: JournalEntry['location'] = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          elevation: elevation,
          accuracy: pos.coords.accuracy ?? undefined,
          address,
        };
        if (!cancelled) setCurrentLocation(loc);
      } catch {
        if (!cancelled) setLocDenied(true);
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
  }, [isEditing]);

  // Stable autosave fn — reassigned every render to close over latest state.
  // Only called from the debounce timeout, never during render.
  autosaveFnRef.current = async () => {
    if (!isEditing || !entryId || !content.trim()) return;
    if (savingRef.current) {
      pendingSaveRef.current = true;
      return;
    }
    savingRef.current = true;
    pendingSaveRef.current = false;
    setAutoSaving(true);
    try {
      await actions.updateEntry(entryId, {
        content: content.trim(),
        datetime,
        tags,
      });
      setLastSaved(new Date());
    } catch {
      // silently fail autosave
    } finally {
      setAutoSaving(false);
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
    if (!isEditing || !content.trim()) return;
    pendingSaveRef.current = true;
    clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveFnRef.current?.();
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(autosaveTimerRef.current);
    // NOTE: intentionally omit actions/date/tags from deps – the ref closure
    // always reads latest values, and only content changes should trigger a save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, content]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => clearTimeout(autosaveTimerRef.current);
  }, []);

  const mapLocation = useMemo(() => {
    return existingEntry?.location ?? currentLocation;
  }, [existingEntry?.location, currentLocation]);

  const mapCenter: [number, number] | undefined = useMemo(() => {
    if (!mapLocation) return undefined;
    return [mapLocation.longitude, mapLocation.latitude];
  }, [mapLocation]);

  /**
   * Persists the entry and navigates back. For edit mode, flushes any pending autosave.
   * For create mode, creates the entry if there is content.
   */
  const handleSaveAndClose = useCallback(async () => {
    // Flush any pending autosave for edit mode
    clearTimeout(autosaveTimerRef.current);
    if (isEditing && entryId && pendingSaveRef.current && content.trim()) {
      try {
        await actions.updateEntry(entryId, {
          content: content.trim(),
          datetime,
          tags,
        });
      } catch {
        // silently fail; navigate back anyway
      }
    }

    // For create mode, save if there is content
    if (!isEditing && content.trim()) {
      try {
        await actions.createEntry(content.trim(), datetime, tags, mapLocation);
      } catch {
        // silently fail; still navigate back
      }
    }

    router.back();
  }, [isEditing, entryId, content, datetime, tags, mapLocation, actions, router]);

  /** Adds a new tag to the entry. */
  const handleAddTag = () => {
    const trimmedTag = tagInput.trim();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      setTags([...tags, trimmedTag]);
      setTagInput('');
    }
  };

  /**
   * Removes a tag from the entry.
   *
   * @param tagToRemove - The name of the tag to remove.
   */
  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  // Update content and maintain undo/redo history
  const updateContent = useCallback(
    (newContent: string) => {
      setContent(newContent);
      setHistory(prev => {
        const newHistory = prev.slice(0, historyIndex + 1);
        newHistory.push(newContent);
        if (newHistory.length > MAX_HISTORY_LENGTH) {
          newHistory.shift();
          return newHistory;
        }
        return newHistory;
      });
      setHistoryIndex(prev => Math.min(prev + 1, MAX_HISTORY_LENGTH - 1));
    },
    [historyIndex],
  );

  // Undo action
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(prev => prev - 1);
      setContent(history[historyIndex - 1]);
    }
  }, [historyIndex, history]);

  // Redo action
  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(prev => prev + 1);
      setContent(history[historyIndex + 1]);
    }
  }, [historyIndex, history]);

  // Check if undo/redo available
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

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
        />
        <Appbar.Content title={isEditing ? 'Edit Entry' : 'New Entry'} />
      </Appbar.Header>

      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          testID="entry-content-input"
          accessibilityLabel="Journal entry content"
          label="What's on your mind?"
          value={content}
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
            value={tagInput}
            onChangeText={setTagInput}
            onSubmitEditing={handleAddTag}
            mode="outlined"
            style={styles.tagInput}
            right={
              <TextInput.Icon
                icon="plus"
                testID="add-tag-icon"
                onPress={handleAddTag}
                disabled={!tagInput.trim()}
              />
            }
          />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tagsContainer}
          >
            {tags.map((tag, index) => (
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
          {datetime.toLocaleDateString()}{' '}
          {datetime.toLocaleTimeString([], {
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

          {!isEditing && locDenied && (
            <Text variant="bodySmall" style={styles.locationHint}>
              Location permission not granted. You can still save the entry without a location.
            </Text>
          )}

          {!mapCenter && !locDenied && (
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
                scrollEnabled={false}
                zoomEnabled={false}
                rotateEnabled={false}
                pitchEnabled={false}
              >
                <Camera
                  defaultSettings={{
                    centerCoordinate: mapCenter,
                    zoomLevel: 15,
                  }}
                />
                <MarkerView coordinate={mapCenter}>
                  <View style={styles.markerDot} />
                </MarkerView>
              </MapView>
            </View>
          )}
        </Surface>
      </ScrollView>

      {autoSaving && (
        <Text variant="bodySmall" style={styles.autoSaveText}>
          Auto-saving...
        </Text>
      )}
      {isEditing && lastSaved && (
        <Text
          variant="bodySmall"
          testID="saved-indicator"
          accessibilityLabel="Saved"
          style={styles.autoSaveText}
        >
          Saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      )}

      <Snackbar
        visible={!!error}
        onDismiss={() => setError(null)}
        duration={3000}
        action={{
          label: 'Dismiss',
          onPress: () => setError(null),
        }}
      >
        {error}
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
  markerDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#e74c3c',
    borderWidth: 2,
    borderColor: '#fff',
  },
});
