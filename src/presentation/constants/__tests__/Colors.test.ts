import Colors from '../Colors';

/**
 * Test suite for the Colors constant object. Verifies that both light and dark theme
 * palettes are present and contain the expected color values.
 */
describe('Colors', () => {
  /** Tests that the Colors object exports both light and dark themes. */
  it('has light and dark properties', () => {
    expect(Colors).toHaveProperty('light');
    expect(Colors).toHaveProperty('dark');
  });

  /** Tests that the light theme contains all expected color keys. */
  it('light theme has expected color keys', () => {
    expect(Colors.light).toHaveProperty('text');
    expect(Colors.light).toHaveProperty('background');
    expect(Colors.light).toHaveProperty('tint');
    expect(Colors.light).toHaveProperty('tabIconDefault');
    expect(Colors.light).toHaveProperty('tabIconSelected');
  });

  /** Tests that the dark theme contains all expected color keys. */
  it('dark theme has expected color keys', () => {
    expect(Colors.dark).toHaveProperty('text');
    expect(Colors.dark).toHaveProperty('background');
    expect(Colors.dark).toHaveProperty('tint');
    expect(Colors.dark).toHaveProperty('tabIconDefault');
    expect(Colors.dark).toHaveProperty('tabIconSelected');
  });

  /** Tests specific color values in the light theme. */
  it('light theme has correct color values', () => {
    expect(Colors.light.text).toBe('#000');
    expect(Colors.light.background).toBe('#fff');
    expect(Colors.light.tint).toBe('#2f95dc');
    expect(Colors.light.tabIconDefault).toBe('#ccc');
    expect(Colors.light.tabIconSelected).toBe('#2f95dc');
  });

  /** Tests specific color values in the dark theme. */
  it('dark theme has correct color values', () => {
    expect(Colors.dark.text).toBe('#fff');
    expect(Colors.dark.background).toBe('#000');
    expect(Colors.dark.tint).toBe('#fff');
    expect(Colors.dark.tabIconDefault).toBe('#ccc');
    expect(Colors.dark.tabIconSelected).toBe('#fff');
  });
});
