import React from 'react';
import { render } from '@testing-library/react-native';
import JournalEntryModal from '../modal';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaperProvider } from 'react-native-paper';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ back: jest.fn() }),
}));

jest.mock('@maplibre/maplibre-react-native', () => ({
  __esModule: true,
  MapView: 'MapView',
  Camera: 'Camera',
  MarkerView: 'MarkerView',
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: { latitude: 0, longitude: 0, altitude: 0, accuracy: 5 },
  }),
  reverseGeocodeAsync: jest.fn().mockResolvedValue([]),
  Accuracy: { Balanced: 3 },
}));

describe('JournalEntryModal', () => {
  it('renders without error', () => {
    const result = render(
      <SafeAreaProvider>
        <PaperProvider>
          <JournalEntryModal />
        </PaperProvider>
      </SafeAreaProvider>,
    );

    expect(result.toJSON()).toBeTruthy();
  });
});
