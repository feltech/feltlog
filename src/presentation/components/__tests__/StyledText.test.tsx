import React from 'react';
import { render } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';
import { MonoText } from '../StyledText';

/**
 * Test suite for the StyledText component. Verifies that MonoText applies the SpaceMono
 * font family.
 */
describe('StyledText', () => {
  beforeEach(() => {
    (useColorScheme as jest.Mock).mockReturnValue('light');
  });

  /** Tests that MonoText renders its children correctly. */
  it('renders children text', () => {
    const { getByText } = render(<MonoText>Mono text content</MonoText>);
    expect(getByText('Mono text content')).toBeTruthy();
  });

  /**
   * Tests that MonoText applies the SpaceMono font family by checking the style array
   * for the fontFamily property.
   */
  it('applies the SpaceMono font family', () => {
    const { getByText } = render(<MonoText>Font test</MonoText>);
    const textEl = getByText('Font test');
    // Flatten nested style arrays to find fontFamily.
    const flatStyles = flattenStyle(textEl.props.style);
    expect(flatStyles).toEqual(expect.objectContaining({ fontFamily: 'SpaceMono' }));
  });

  /** Tests that MonoText merges custom styles with the monospace font. */
  it('merges custom styles with the monospace font', () => {
    const { getByText } = render(<MonoText style={{ fontSize: 18 }}>Styled mono</MonoText>);
    const textEl = getByText('Styled mono');
    const flatStyles = flattenStyle(textEl.props.style);
    expect(flatStyles).toEqual(expect.objectContaining({ fontFamily: 'SpaceMono' }));
    expect(flatStyles).toEqual(expect.objectContaining({ fontSize: 18 }));
  });
});

/**
 * Recursively flattens a React Native style value (which can be nested arrays) into a
 * single plain object.
 *
 * @param style - The style value from a component's props.
 *
 * @returns A flattened style object.
 */
function flattenStyle(style: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  /**
   * Recursively collects style properties from nested arrays and objects.
   *
   * @param s - The style value to process.
   */
  function collect(s: unknown): void {
    if (Array.isArray(s)) {
      s.forEach(collect);
    } else if (s && typeof s === 'object') {
      Object.assign(result, s);
    }
  }

  collect(style);
  return result;
}
