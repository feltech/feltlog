import React from 'react';
import { View, Text } from 'react-native';

// Define environment variables
process.env.EXPO_OS = 'android';
process.env.EXPO_ROUTER = 'false';
process.env.EXPO_DEV_CLIENT = 'false';

// Mocks for native modules not available in Jest environment
jest.mock('react-native-maps', () => {
  const MockMapView = React.forwardRef((props, ref) =>
    React.createElement(View, { ref, ...props }),
  );
  MockMapView.displayName = 'MockMapView';

  /**
   * Mock for the Marker component.
   *
   * @param props - The component props.
   *
   * @returns The rendered mock marker.
   */
  const MockMarker = props => React.createElement(View, props);
  return {
    __esModule: true,
    default: MockMapView,
    Marker: MockMarker,
    PROVIDER_GOOGLE: 'google',
  };
});

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: {
      latitude: 0,
      longitude: 0,
      altitude: 0,
      accuracy: 5,
    },
  })),
  reverseGeocodeAsync: jest.fn(async () => []),
  Accuracy: { Balanced: 3 },
}));

jest.mock('react-native-markdown-renderer', () => {
  /**
   * Mock for the Markdown component.
   *
   * @param props - The component props.
   *
   * @returns The rendered mock markdown text.
   */
  const MockMarkdown = props => React.createElement(Text, null, props.children);
  return {
    __esModule: true,
    default: MockMarkdown,
  };
});
