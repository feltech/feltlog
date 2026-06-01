import React from 'react';
import { render } from '@testing-library/react-native';
import { Text as RNText, useColorScheme } from 'react-native';
import { useThemeColor, Text, View } from '../Themed';
import Colors from '@/src/presentation/constants/Colors';

/**
 * Test suite for the Themed components and useThemeColor hook. Covers light/dark theme
 * switching, custom color overrides, and component rendering.
 */
describe('Themed', () => {
  // ---------------------------------------------------------------------------
  // useThemeColor hook
  // ---------------------------------------------------------------------------

  describe('useThemeColor', () => {
    beforeEach(() => {
      // Default to light theme for most tests.
      (useColorScheme as jest.Mock).mockReturnValue('light');
    });

    /** Tests that the hook returns the light theme color when the scheme is light. */
    it('returns the light theme color when color scheme is light', () => {
      (useColorScheme as jest.Mock).mockReturnValue('light');
      let result: string | undefined;

      /**
       * Harness component to capture hook output.
       *
       * @returns Null.
       */
      function Harness() {
        result = useThemeColor({}, 'text');
        return null;
      }

      render(<Harness />);
      expect(result).toBe(Colors.light.text);
    });

    /** Tests that the hook returns the dark theme color when the scheme is dark. */
    it('returns the dark theme color when color scheme is dark', () => {
      (useColorScheme as jest.Mock).mockReturnValue('dark');
      let result: string | undefined;

      /**
       * Harness component to capture hook output.
       *
       * @returns Null.
       */
      function Harness() {
        result = useThemeColor({}, 'text');
        return null;
      }

      render(<Harness />);
      expect(result).toBe(Colors.dark.text);
    });

    /**
     * Tests that the hook returns the light theme color as fallback when useColorScheme
     * returns null.
     */
    it('defaults to light theme when color scheme is null', () => {
      (useColorScheme as jest.Mock).mockReturnValue(null);
      let result: string | undefined;

      /**
       * Harness component to capture hook output.
       *
       * @returns Null.
       */
      function Harness() {
        result = useThemeColor({}, 'background');
        return null;
      }

      render(<Harness />);
      expect(result).toBe(Colors.light.background);
    });

    /** Tests that the custom light color override is used when the theme is light. */
    it('returns custom light color override when in light mode', () => {
      (useColorScheme as jest.Mock).mockReturnValue('light');
      let result: string | undefined;

      /**
       * Harness component to capture hook output.
       *
       * @returns Null.
       */
      function Harness() {
        result = useThemeColor({ light: '#custom-light' }, 'text');
        return null;
      }

      render(<Harness />);
      expect(result).toBe('#custom-light');
    });

    /** Tests that the custom dark color override is used when the theme is dark. */
    it('returns custom dark color override when in dark mode', () => {
      (useColorScheme as jest.Mock).mockReturnValue('dark');
      let result: string | undefined;

      /**
       * Harness component to capture hook output.
       *
       * @returns Null.
       */
      function Harness() {
        result = useThemeColor({ dark: '#custom-dark' }, 'text');
        return null;
      }

      render(<Harness />);
      expect(result).toBe('#custom-dark');
    });

    /**
     * Tests that the theme default color is returned when no override matches the
     * current theme.
     */
    it('returns theme default when no matching override is provided', () => {
      (useColorScheme as jest.Mock).mockReturnValue('light');
      let result: string | undefined;

      /**
       * Harness component to capture hook output.
       *
       * @returns Null.
       */
      function Harness() {
        // Only provide dark override, but the scheme is light.
        result = useThemeColor({ dark: '#dark-only' }, 'text');
        return null;
      }

      render(<Harness />);
      expect(result).toBe(Colors.light.text);
    });

    /**
     * Tests that the hook falls back to light theme when useColorScheme returns
     * 'unspecified' (added in React Native 0.85).
     */
    it('falls back to light theme when color scheme is unspecified', () => {
      (useColorScheme as jest.Mock).mockReturnValue('unspecified');
      let result: string | undefined;

      /**
       * Harness component to capture hook output.
       *
       * @returns Null.
       */
      function Harness() {
        result = useThemeColor({}, 'text');
        return null;
      }

      render(<Harness />);
      expect(result).toBe(Colors.light.text);
    });
  });

  // ---------------------------------------------------------------------------
  // Themed Text component
  // ---------------------------------------------------------------------------

  describe('Text', () => {
    beforeEach(() => {
      (useColorScheme as jest.Mock).mockReturnValue('light');
    });

    /** Tests that the Text component renders children correctly. */
    it('renders children text', () => {
      const { getByText } = render(<Text>Hello World</Text>);
      expect(getByText('Hello World')).toBeTruthy();
    });

    /** Tests that the Text component applies the theme text color. */
    it('applies theme text color by default', () => {
      const { getByText } = render(<Text>Themed text</Text>);
      const textEl = getByText('Themed text');
      // The style should include the theme color.
      const flatStyle = Array.isArray(textEl.props.style)
        ? Object.assign({}, ...textEl.props.style.filter(Boolean))
        : textEl.props.style;
      expect(flatStyle?.color).toBe(Colors.light.text);
    });

    /** Tests that the Text component allows custom style overrides. */
    it('allows custom style overrides', () => {
      const { getByText } = render(<Text style={{ fontSize: 20 }}>Styled</Text>);
      const textEl = getByText('Styled');
      // Custom style should be merged.
      const flatStyle = Array.isArray(textEl.props.style)
        ? Object.assign({}, ...textEl.props.style.filter(Boolean))
        : textEl.props.style;
      expect(flatStyle?.fontSize).toBe(20);
    });

    /** Tests that the Text component uses custom light/dark color overrides. */
    it('uses custom lightColor in light mode', () => {
      (useColorScheme as jest.Mock).mockReturnValue('light');
      const { getByText } = render(<Text lightColor="#aaa">Custom</Text>);
      const textEl = getByText('Custom');
      const flatStyle = Array.isArray(textEl.props.style)
        ? Object.assign({}, ...textEl.props.style.filter(Boolean))
        : textEl.props.style;
      expect(flatStyle?.color).toBe('#aaa');
    });

    /** Tests that the Text component uses custom dark color overrides. */
    it('uses custom darkColor in dark mode', () => {
      (useColorScheme as jest.Mock).mockReturnValue('dark');
      const { getByText } = render(<Text darkColor="#bbb">Custom</Text>);
      const textEl = getByText('Custom');
      const flatStyle = Array.isArray(textEl.props.style)
        ? Object.assign({}, ...textEl.props.style.filter(Boolean))
        : textEl.props.style;
      expect(flatStyle?.color).toBe('#bbb');
    });
  });

  // ---------------------------------------------------------------------------
  // Themed View component
  // ---------------------------------------------------------------------------

  describe('View', () => {
    beforeEach(() => {
      (useColorScheme as jest.Mock).mockReturnValue('light');
    });

    /** Tests that the View component renders children. */
    it('renders children', () => {
      const { getByText } = render(
        <View>
          <RNText>Child text</RNText>
        </View>,
      );
      expect(getByText('Child text')).toBeTruthy();
    });

    /** Tests that the View component applies the theme background color. */
    it('applies theme background color by default', () => {
      const { toJSON } = render(<View />);
      const tree = toJSON();
      // toJSON() may return an array in some versions; handle both cases.
      // In practice View renders a single root element.
      const node = Array.isArray(tree) ? tree[0] : tree;
      // The root view should have the background color from the light theme.
      const flatStyle = Array.isArray(node?.props?.style)
        ? Object.assign({}, ...node.props.style.filter(Boolean))
        : node?.props?.style;
      expect(flatStyle?.backgroundColor).toBe(Colors.light.background);
    });

    /** Tests that the View component uses custom lightColor in light mode. */
    it('uses custom lightColor in light mode', () => {
      (useColorScheme as jest.Mock).mockReturnValue('light');
      const { toJSON } = render(<View lightColor="#light-bg" />);
      const tree = toJSON();
      const node = Array.isArray(tree) ? tree[0] : tree;
      const flatStyle = Array.isArray(node?.props?.style)
        ? Object.assign({}, ...node.props.style.filter(Boolean))
        : node?.props?.style;
      expect(flatStyle?.backgroundColor).toBe('#light-bg');
    });

    /** Tests that the View component uses custom darkColor in dark mode. */
    it('uses custom darkColor in dark mode', () => {
      (useColorScheme as jest.Mock).mockReturnValue('dark');
      const { toJSON } = render(<View darkColor="#dark-bg" />);
      const tree = toJSON();
      const node = Array.isArray(tree) ? tree[0] : tree;
      const flatStyle = Array.isArray(node?.props?.style)
        ? Object.assign({}, ...node.props.style.filter(Boolean))
        : node?.props?.style;
      expect(flatStyle?.backgroundColor).toBe('#dark-bg');
    });

    /** Tests that the View component allows custom style overrides. */
    it('allows custom style overrides', () => {
      const { toJSON } = render(<View style={{ padding: 16 }} />);
      const tree = toJSON();
      const node = Array.isArray(tree) ? tree[0] : tree;
      const flatStyle = Array.isArray(node?.props?.style)
        ? Object.assign({}, ...node.props.style.filter(Boolean))
        : node?.props?.style;
      expect(flatStyle?.padding).toBe(16);
    });
  });
});
