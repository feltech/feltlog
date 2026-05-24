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

/**
 * Mock @expo/vector-icons to avoid `setState` warnings during tests.
 *
 * The real Icon component calls setState during construction (for font loading /
 * glyph-map initialization), which triggers React act() warnings in the test
 * environment. Replacing it with a View avoids the issue.
 */
jest.mock('@expo/vector-icons', () => {
  const RN = require('react-native');
  const React = require('react');

  /**
   * Mock Icon component rendering as a View that displays its name.
   *
   * @param props - The component props.
   * @param props.name - The icon name.
   * @param props.size - The icon size (unused in mock).
   * @param props.color - The icon color (unused in mock).
   *
   * @returns The rendered mock view.
   */
  const MockIcon = props => {
    const { name, size, color, ...rest } = props;
    void size;
    void color;
    return React.createElement(RN.View, { ...rest, 'data-icon-name': name }, null);
  };
  MockIcon.displayName = 'MockIcon';

  /**
   * Factory that returns the mock Icon component.
   *
   * @returns The mock Icon component.
   */
  const createIconSet = () => MockIcon;

  return {
    __esModule: true,
    default: MockIcon,
    createIconSet,
    createIconSetFromFontAwesome5: createIconSet,
    createIconSetFromFontAwesome6: createIconSet,
    createIconSetFromFontello: createIconSet,
    createIconSetFromIcoMoon: createIconSet,
  };
});

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

/**
 * Mock the MaterialCommunityIcons icon set used by react-native-paper.
 *
 * React Native Paper internally requires this module to render its icons. The real
 * component calls setState during construction (for glyph-map loading), which triggers
 * React act() warnings in the test environment.
 */
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  const RN = require('react-native');
  const React = require('react');

  /**
   * Mock icon component that renders as a View.
   *
   * @param props - The component props.
   *
   * @returns The rendered mock view.
   */
  const MockIcon = props => React.createElement(RN.View, props);
  MockIcon.displayName = 'MockMaterialCommunityIcon';
  return {
    __esModule: true,
    default: MockIcon,
  };
});
