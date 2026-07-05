import React from 'react';
import { render, screen } from '@testing-library/react-native';

/**
 * Mock Pressable so the headerRight child-function is invoked with pressed=true,
 * exercising the pressed-state style branch in TabLayout.
 */
jest.mock('react-native/Libraries/Components/Pressable/Pressable', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');

  /**
   * Mock Pressable that always renders its child function in the pressed state.
   *
   * @param props - The Pressable props.
   * @param props.children - Either a React node or a render function.
   *
   * @returns The rendered pressable content.
   */
  function MockPressable(props: {
    children: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }) {
    const child =
      typeof props.children === 'function' ? props.children({ pressed: true }) : props.children;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { children, ...rest } = props;
    return React.createElement(View, rest, child);
  }
  MockPressable.displayName = 'MockPressable';

  return {
    __esModule: true,
    default: jest.fn(MockPressable),
  };
});

/**
 * Mock FontAwesome to avoid vector icon native state updates in the Jest environment
 * and to render a predictable text marker for each icon.
 */
jest.mock('react-native/Libraries/Components/Pressable/Pressable', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');

  /**
   * Mock Pressable that always renders its child function in the pressed state.
   *
   * @param props - The Pressable props.
   * @param props.children - Either a React node or a render function.
   * @param props.onPress - Optional press handler.
   *
   * @returns The rendered pressable content.
   */
  function MockPressable(props: {
    children: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
    onPress?: () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }) {
    const child =
      typeof props.children === 'function' ? props.children({ pressed: true }) : props.children;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { children, ...rest } = props;
    return React.createElement(View, rest, child);
  }
  MockPressable.displayName = 'MockPressable';

  return {
    __esModule: true,
    default: jest.fn(MockPressable),
  };
});

/**
 * Mock FontAwesome to avoid vector icon native state updates in the Jest environment
 * and to render a predictable text marker for each icon.
 */
jest.mock('@expo/vector-icons/FontAwesome', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');

  /**
   * Mock FontAwesome icon that renders its name as text.
   *
   * @param props - The component props.
   * @param props.name - The FontAwesome icon name.
   *
   * @returns The rendered mock icon.
   */
  function MockFontAwesomeIcon(props: { name: string }) {
    return React.createElement('Text', null, `Icon:${props.name}`);
  }

  MockFontAwesomeIcon.displayName = 'MockFontAwesomeIcon';

  return {
    __esModule: true,
    default: jest.fn(MockFontAwesomeIcon),
  };
});

/**
 * Mock for expo-router's Tabs navigator.
 *
 * Renders its children and provides a Tabs.Screen mock that displays the tab title and
 * any headerRight element so tests can assert on tab configuration.
 */
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text, View } = require('react-native');

  /**
   * Mock Tabs navigator that renders its children.
   *
   * @param props - The component props.
   * @param props.children - The child screen components.
   *
   * @returns The rendered mock tabs container.
   */
  function MockTabs({ children }: { children: React.ReactNode }) {
    return React.createElement(View, { testID: 'tabs' }, children);
  }
  MockTabs.displayName = 'MockTabs';

  /**
   * Mock Tabs.Screen component that renders the tab title, optional headerRight, and
   * tabBarIcon so that icon rendering branches are exercised.
   *
   * @param props - The component props.
   * @param props.name - The route name for the tab.
   * @param props.options - Screen options including title, headerRight, and tabBarIcon.
   * @param props.options.title - The tab title.
   * @param props.options.headerRight - Function returning the header right element.
   * @param props.options.tabBarIcon - Function returning the tab bar icon.
   *
   * @returns The rendered mock screen.
   */
  function MockTabsScreen(props: {
    name: string;
    options?: {
      title?: string;
      headerRight?: () => React.ReactNode;
      tabBarIcon?: (props: { color: string }) => React.ReactNode;
    };
  }) {
    return React.createElement(
      View,
      { testID: `tab-screen-${props.name}` },
      React.createElement(Text, null, props.options?.title ?? props.name),
      props.options?.tabBarIcon?.({ color: '#000' }),
      props.options?.headerRight?.(),
    );
  }
  MockTabsScreen.displayName = 'MockTabsScreen';
  MockTabs.Screen = MockTabsScreen;

  /**
   * Mock Link component that renders its children.
   *
   * @param props - The component props.
   * @param props.children - The child elements to render inside the link.
   *
   * @returns The rendered mock link.
   */
  function MockLink({ children }: { children: React.ReactNode }) {
    return React.createElement(View, { testID: 'link' }, children);
  }
  MockLink.displayName = 'MockLink';

  return {
    Tabs: MockTabs,
    Link: MockLink,
  };
});

/** Mock useClientOnlyValue so the navigator config can render deterministically. */
jest.mock('../useClientOnlyValue', () => ({
  useClientOnlyValue: jest.fn(() => true),
}));

/** Mock react-native-paper's useTheme to provide stable colors for the layout. */
jest.mock('react-native-paper', () => ({
  useTheme: jest.fn(() => ({
    colors: {
      primary: '#000000',
      onBackground: '#ffffff',
    },
  })),
}));

import TabLayout from '../TabLayout';

/**
 * Test suite for TabLayout. Verifies the tab navigator renders, exposes the expected
 * tabs, and includes the headerRight link for creating entries.
 */
describe('TabLayout', () => {
  /** Tests that the tab navigator renders without crashing. */
  it('renders without crashing', () => {
    render(<TabLayout />);

    expect(screen.getByTestId('tabs')).toBeTruthy();
  });

  /**
   * Tests that the Journal, Settings, and Lock tabs are configured with their expected
   * titles.
   */
  it('configures Journal, Settings, and Lock tabs', () => {
    render(<TabLayout />);

    expect(screen.getByTestId('tab-screen-index')).toBeTruthy();
    expect(screen.getByTestId('tab-screen-Settings')).toBeTruthy();
    expect(screen.getByTestId('tab-screen-lock')).toBeTruthy();

    expect(screen.getByText('Journal')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText('Lock')).toBeTruthy();
  });

  /**
   * Tests that the Journal tab no longer renders a headerRight link (the screen now
   * renders its own custom Appbar.Header).
   */
  it('does not render a headerRight link for the Journal tab', () => {
    render(<TabLayout />);

    expect(screen.queryByTestId('link')).toBeNull();
  });

  /** Tests that the tab bar icons are rendered for each configured tab. */
  it('renders tab bar icons for each tab', () => {
    render(<TabLayout />);

    expect(screen.getByText('Icon:book')).toBeTruthy();
    expect(screen.getByText('Icon:cog')).toBeTruthy();
    expect(screen.getByText('Icon:lock')).toBeTruthy();
  });
});
