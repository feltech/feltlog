/* eslint-disable @typescript-eslint/no-require-imports */
// Define environment variables
process.env.EXPO_OS = 'android';
process.env.EXPO_ROUTER = 'false';
process.env.EXPO_DEV_CLIENT = 'false';

// Mocks for native modules not available in Jest environment
jest.mock('@maplibre/maplibre-react-native', () => {
  const RN = require('react-native');
  const React = require('react');

  /**
   * Mock for the MapView component.
   *
   * @param props - The component props.
   *
   * @returns The rendered mock view.
   */
  const MockMapView = props => {
    // eslint-disable-next-line react/prop-types
    const { defaultSettings, children, ...rest } = props;
    void defaultSettings;
    return React.createElement(RN.View, rest, children);
  };
  MockMapView.displayName = 'MockMapView';

  /**
   * Mock for the Camera component.
   *
   * @param props - The component props.
   *
   * @returns The rendered mock view.
   */
  const MockCamera = props => React.createElement(RN.View, props);
  MockCamera.displayName = 'MockCamera';

  /**
   * Mock for the MarkerView component.
   *
   * @param props - The component props.
   *
   * @returns The rendered mock view.
   */
  const MockMarkerView = props => React.createElement(RN.View, props);
  MockMarkerView.displayName = 'MockMarkerView';

  return {
    __esModule: true,
    MapView: MockMapView,
    Camera: MockCamera,
    MarkerView: MockMarkerView,
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
  const RN = require('react-native');
  const React = require('react');

  /**
   * Mock for the Markdown component.
   *
   * @param props - The component props.
   * @param props.children - The children to render.
   *
   * @returns The rendered mock markdown text.
   */
  const MockMarkdown = props => React.createElement(RN.Text, null, props.children);
  return {
    __esModule: true,
    default: MockMarkdown,
  };
});
