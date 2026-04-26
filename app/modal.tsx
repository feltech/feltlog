import React, {useEffect, useMemo, useState} from 'react';
import {StatusBar} from 'expo-status-bar';
import {Platform, ScrollView, StyleSheet, View} from 'react-native';
import {Appbar, Chip, Snackbar, Surface, Text, TextInput, ActivityIndicator} from 'react-native-paper';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {SafeAreaView} from 'react-native-safe-area-context';
import MapView, {Marker, PROVIDER_GOOGLE, Region} from 'react-native-maps';
import * as ExpoLocation from 'expo-location';

import {useJournalViewModel} from '@/src/presentation/viewmodels/JournalViewModel';
import type {JournalEntry} from '@/src/domain/entities/JournalEntry';

export default function JournalEntryModal() {
  const router = useRouter();
  const {entryId} = useLocalSearchParams<{ entryId?: string }>();
  const {state, actions} = useJournalViewModel();

  const [content, setContent] = useState('');
  const [datetime, setDatetime] = useState(new Date());
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Location state for map rendering when creating a new entry.
  const [currentLocation, setCurrentLocation] = useState<JournalEntry['location'] | undefined>(undefined);
  const [locLoading, setLocLoading] = useState(false);
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
    const fetchLocation = async () => {
      if (isEditing) return; // Only for new entries
      try {
        setLocLoading(true);
        setLocDenied(false);
        const perm = await ExpoLocation.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          if (!cancelled) setLocDenied(true);
          return;
        }
        const pos = await ExpoLocation.getCurrentPositionAsync({accuracy: ExpoLocation.Accuracy.Balanced});
        // Reverse geocode is optional; keep fast path. Attempt but ignore failure.
        let address: string | undefined = undefined;
        try {
          const geos = await ExpoLocation.reverseGeocodeAsync({latitude: pos.coords.latitude, longitude: pos.coords.longitude});
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
      } catch (e) {
        if (!cancelled) setLocDenied(true);
      } finally {
        if (!cancelled) setLocLoading(false);
      }
    };
    void fetchLocation();
    return () => { cancelled = true; };
  }, [isEditing]);

  const mapLocation = useMemo(() => {
    return existingEntry?.location ?? currentLocation;
  }, [existingEntry?.location, currentLocation]);

  const mapRegion: Region | undefined = useMemo(() => {
    if (!mapLocation) return undefined;
    return {
      latitude: mapLocation.latitude,
      longitude: mapLocation.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }, [mapLocation]);

  const handleSave = async () => {
    if (!content.trim()) {
      setError('Content cannot be empty');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (isEditing && entryId) {
        await actions.updateEntry(entryId, {
          content: content.trim(),
          datetime,
          tags,
        });
      } else {
        await actions.createEntry(
          content.trim(),
          datetime,
          tags,
          mapLocation
        );
      }
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save entry');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddTag = () => {
    const trimmedTag = tagInput.trim();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      setTags([...tags, trimmedTag]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  const handleClose = () => {
    router.back();
  };

  return (
    <SafeAreaView style={styles.container}>
      <Appbar.Header>
        <Appbar.BackAction onPress={handleClose}/>
        <Appbar.Content title={isEditing ? 'Edit Entry' : 'New Entry'}/>
        <Appbar.Action
          icon="check"
          testID="save-entry-button"
          accessibilityLabel="Save entry"
          onPress={handleSave}
          disabled={isLoading || !content.trim()}
        />
      </Appbar.Header>

      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          testID="entry-content-input"
          accessibilityLabel="Journal entry content"
          label="What's on your mind?"
          value={content}
          onChangeText={setContent}
          multiline
          numberOfLines={10}
          style={styles.contentInput}
          mode="outlined"
          placeholder="Start writing your journal entry..."
        />

        <Surface style={styles.tagsSection}>
          <Text variant="titleMedium" style={styles.sectionTitle}>Tags</Text>

          <TextInput
            label="Add tags"
            value={tagInput}
            onChangeText={setTagInput}
            onSubmitEditing={handleAddTag}
            mode="outlined"
            style={styles.tagInput}
            right={
              <TextInput.Icon
                icon="plus"
                onPress={handleAddTag}
                disabled={!tagInput.trim()}
              />
            }
          />

          <ScrollView horizontal showsHorizontalScrollIndicator={false}
                      style={styles.tagsContainer}>
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
          {datetime.toLocaleDateString()} {datetime.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        })}
        </Text>

        <Surface style={styles.locationSection}>
          <Text variant="titleMedium" style={styles.sectionTitle}>Location</Text>
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

          {!mapRegion && !locDenied && (
            <View style={styles.mapLoading}>
              <ActivityIndicator animating={true} />
              <Text variant="bodySmall" style={styles.locationHint}>Loading map…</Text>
            </View>
          )}

          {mapRegion && mapLocation && (
            <MapView
              testID="entry-location-map"
              provider={PROVIDER_GOOGLE}
              style={styles.map}
              initialRegion={mapRegion}
              pointerEvents="none"
            >
              <Marker coordinate={{latitude: mapLocation.latitude, longitude: mapLocation.longitude}} />
            </MapView>
          )}
        </Surface>
      </ScrollView>

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

      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'}/>
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
  map: {
    width: '100%',
    height: 200,
    borderRadius: 8,
  },
  mapLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 200,
  },
});
