import { useColorScheme } from '../useColorScheme';

/**
 * Test suite for the useColorScheme re-export hook. Verifies that the module correctly
 * re-exports the useColorScheme function from react-native.
 */
describe('useColorScheme', () => {
  /** Tests that the hook is exported and is a function. */
  it('re-exports useColorScheme from react-native', () => {
    expect(useColorScheme).toBeDefined();
    expect(typeof useColorScheme).toBe('function');
  });
});
