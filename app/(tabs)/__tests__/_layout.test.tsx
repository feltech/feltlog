import React from 'react';
import { render } from '@testing-library/react-native';

import { darkTheme, lightTheme } from '@/src/presentation/theme/appTheme';

// ---------------------------------------------------------------------------
// Mocks — hoisted before any imports below.
// ---------------------------------------------------------------------------

/** Capture screenOptions passed to the mocked Tabs navigator. */
let lastScreenOptions: Record<string, unknown> | null = null;

/** Capture icon props passed to the mocked FontAwesome icons. */
const iconProps: Array<Record<string, unknown>> = [];

/** Mock useClientOnlyValue to return the client value. */
jest.mock('@/src/presentation/components/useClientOnlyValue', () => ({
  useClientOnlyValue: jest.fn((_server: unknown, client: unknown) => client),
}));

/** Mock useTheme to return the light theme by default. */
jest.mock('react-native-paper', () => {
  const actual = jest.requireActual('react-native-paper');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { lightTheme } = require('@/src/presentation/theme/appTheme');
  return {
    ...actual,
    useTheme: jest.fn(() => lightTheme),
  };
});

/** Mock FontAwesome to avoid vector icon native issues and capture props. */
jest.mock('@expo/vector-icons/FontAwesome', () => ({
  __esModule: true,
  default: jest.fn((props: { name: string; color?: string }) => {
    iconProps.push(props);
    return <>{`Icon:${props.name}`}</>;
  }),
}));

/** Mock expo-router Tabs and Link. */
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');

  /**
   * Mock Tabs navigator component.
   *
   * @param props - Component props.
   * @param props.children - Child screen components.
   * @param props.screenOptions - Options applied to all screens.
   *
   * @returns The rendered mock tabs.
   */
  const MockTabs = ({
    children,
    screenOptions,
  }: {
    children: React.ReactNode;
    screenOptions?: Record<string, unknown>;
  }) => {
    lastScreenOptions = screenOptions ?? null;
    return <>{children}</>;
  };
  MockTabs.displayName = 'Tabs';

  /**
   * Mock Tabs.Screen component.
   *
   * @param props - Component props.
   * @param props.options - Screen options including title and headerRight.
   *
   * @returns The rendered mock screen.
   */
  MockTabs.Screen = jest.fn(({ options }: { options: Record<string, unknown> }) => {
    const title = (options?.title as string) || 'Tab';
    const headerRight = options?.headerRight as (() => React.ReactNode) | undefined;
    const tabBarIcon = options?.tabBarIcon as
      | (({ color }: { color: string }) => React.ReactNode)
      | undefined;
    return (
      <>
        <>{title}</>
        {headerRight ? headerRight() : null}
        {tabBarIcon ? tabBarIcon({ color: '#000' }) : null}
      </>
    );
  });

  return {
    Tabs: MockTabs,
    Link: jest.fn(({ children }: { children: React.ReactNode }) => <>{children}</>),
  };
});

import { useTheme } from 'react-native-paper';
import TabLayout from '@/app/(tabs)/_layout';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

/**
 * Test suite for the TabLayout component. Verifies that the tab navigator renders
 * correctly and that tab configuration (icons, titles, header right) is present.
 */
describe('TabLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastScreenOptions = null;
    iconProps.length = 0;
    (useTheme as jest.Mock).mockReturnValue(lightTheme);
  });

  /** Tests that the tab navigator renders without crashing. */
  it('renders the tab navigator', () => {
    const { toJSON } = render(<TabLayout />);
    expect(toJSON()).toBeTruthy();
  });

  /** Tests that the Journal tab title is present. */
  it('renders the Journal tab', () => {
    const { toJSON } = render(<TabLayout />);
    const json = JSON.stringify(toJSON());
    expect(json).toContain('Journal');
  });

  /** Tests that the Settings tab title is present. */
  it('renders the Settings tab', () => {
    const { toJSON } = render(<TabLayout />);
    const json = JSON.stringify(toJSON());
    expect(json).toContain('Settings');
  });

  /** Tests that the header right plus button is rendered for the Journal tab. */
  it('renders the plus button in the Journal tab header', () => {
    const { toJSON } = render(<TabLayout />);
    const json = JSON.stringify(toJSON());
    // The plus icon mock renders as "Icon:plus".
    expect(json).toContain('Icon:plus');
  });

  /** Tests that tab icons are rendered for both tabs. */
  it('renders tab icons for both tabs', () => {
    const { toJSON } = render(<TabLayout />);
    const json = JSON.stringify(toJSON());
    // Journal tab uses "book" icon, Settings uses "cog" icon.
    expect(json).toContain('Icon:book');
    expect(json).toContain('Icon:cog');
  });

  /** Tests that the tab layout uses the active tint color from the Paper theme. */
  it('uses the Paper primary color for tabBarActiveTintColor', () => {
    render(<TabLayout />);
    expect(lastScreenOptions?.tabBarActiveTintColor).toBe(lightTheme.colors.primary);
  });

  /** Tests that the plus icon uses the onBackground color from the Paper theme. */
  it('uses the Paper onBackground color for the plus icon', () => {
    render(<TabLayout />);
    const plusIcon = iconProps.find(props => props.name === 'plus');
    expect(plusIcon).toBeDefined();
    expect(plusIcon?.color).toBe(lightTheme.colors.onBackground);
  });

  /** Tests that the plus icon uses dark theme onBackground in dark mode. */
  it('uses dark theme colors when the Paper theme is dark', () => {
    (useTheme as jest.Mock).mockReturnValue(darkTheme);
    render(<TabLayout />);
    expect(lastScreenOptions?.tabBarActiveTintColor).toBe(darkTheme.colors.primary);
    const plusIcon = iconProps.find(props => props.name === 'plus');
    expect(plusIcon?.color).toBe(darkTheme.colors.onBackground);
  });

  /** Tests that the header right plus button is rendered inside a Pressable. */
  it('renders the plus button inside a Pressable', () => {
    const result = render(<TabLayout />);

    // Find the Pressable by looking for the element with accessible and
    // focusable props (how Pressable renders in the test renderer).
    const pressable = result.UNSAFE_root.findByProps({
      accessible: true,
      focusable: true,
    });
    expect(pressable).toBeTruthy();
  });
});
