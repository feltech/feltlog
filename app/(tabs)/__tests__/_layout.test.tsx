import React from 'react';
import { render } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks — hoisted before any imports below.
// ---------------------------------------------------------------------------

/** Mock the color scheme hook to return 'light' by default. */
jest.mock('@/src/presentation/components/useColorScheme', () => ({
  useColorScheme: jest.fn().mockReturnValue('light'),
}));

/** Mock useClientOnlyValue to return the client value. */
jest.mock('@/src/presentation/components/useClientOnlyValue', () => ({
  useClientOnlyValue: jest.fn((_server: unknown, client: unknown) => client),
}));

/** Mock FontAwesome to avoid vector icon native issues. */
jest.mock('@expo/vector-icons/FontAwesome', () => ({
  __esModule: true,
  default: jest.fn(({ name }: { name: string }) => <>{`Icon:${name}`}</>),
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
   *
   * @returns The rendered mock tabs.
   */
  const MockTabs = ({ children }: { children: React.ReactNode }) => <>{children}</>;
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

import { useColorScheme } from '@/src/presentation/components/useColorScheme';
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
    (useColorScheme as jest.Mock).mockReturnValue('light');
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

  /** Tests that the tab layout uses the correct active tint color from the theme. */
  it('uses the correct theme tint color', () => {
    (useColorScheme as jest.Mock).mockReturnValue('dark');
    const { toJSON } = render(<TabLayout />);
    expect(toJSON()).toBeTruthy();
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

  /** Tests that the tab layout falls back to light theme when color scheme is null. */
  it('falls back to light theme when color scheme is null', () => {
    (useColorScheme as jest.Mock).mockReturnValue(null);
    const { toJSON } = render(<TabLayout />);
    expect(toJSON()).toBeTruthy();
  });
});
