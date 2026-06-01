/* eslint-disable @typescript-eslint/no-require-imports */
// Define environment variables
process.env.EXPO_OS = 'android';
process.env.EXPO_ROUTER = 'false';
process.env.EXPO_DEV_CLIENT = 'false';

// Mocks for native modules not available in Jest environment

/**
 * Mock react-native-reanimated to avoid native module issues in the Jest environment.
 * Reanimated v4 requires worklet runtime support that doesn't exist in Node.js.
 */
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock('@maplibre/maplibre-react-native', () => {
  const RN = require('react-native');
  const React = require('react');

  /**
   * Mock for the Map component (renamed from MapView in MapLibre v11).
   *
   * @param props - The component props.
   *
   * @returns The rendered mock view.
   */
  const MockMap = props => {
    // eslint-disable-next-line react/prop-types
    const { initialViewState, children, ...rest } = props;
    void initialViewState;
    return React.createElement(RN.View, rest, children);
  };
  MockMap.displayName = 'MockMap';

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
    Map: MockMap,
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
 * Mock the React Native getDevServer module and expo/devtools to prevent repeated
 * "Failed to initialize devtools client" tracebacks during tests.
 *
 * When expo-sqlite opens a database, it calls registerDatabaseForDevToolsAsync(), which
 * calls getDevToolsPluginClientAsync() from expo/devtools. This in turn calls
 * getDevServer() from react-native, which reads
 * NativeSourceCode.getConstants().scriptURL and calls .match() on it. In Jest, the
 * NativeSourceCode module returns null for scriptURL, causing: TypeError: Cannot read
 * properties of null (reading 'match') The devtools client catches this and
 * console.warns the full traceback once per database open (52 times across all test
 * suites).
 *
 * Two mocks work together:
 *
 * 1. Mock getDevServer to return a valid URL so getConnectionInfo doesn't crash.
 * 2. Mock getDevToolsPluginClientAsync to return a no-op client so the WebSocket
 *    connection attempt doesn't fail with an unresolvable error and traceback.
 */

jest.mock(
  'react-native/Libraries/Core/Devtools/getDevServer',
  () => ({
    __esModule: true,
    default: () => ({
      url: 'http://localhost:8081/',
      fullBundleUrl: 'http://localhost:8081/index.bundle?platform=android',
      bundleLoadedFromServer: true,
    }),
  }),
  { virtual: true },
);

/**
 * No-op DevTools client mock that satisfies the expo-sqlite SQLiteDevToolsClient
 * interface. All message methods are stubbed because the devtools server is not running
 * in the test environment.
 */
const mockDevToolsClient = {
  addMessageListener: jest.fn(),
  sendMessage: jest.fn(),
  isConnected: jest.fn().mockReturnValue(false),
  closeAsync: jest.fn().mockResolvedValue(undefined),
};

jest.mock('expo/devtools', () => ({
  getDevToolsPluginClientAsync: jest.fn().mockResolvedValue(mockDevToolsClient),
}));

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
