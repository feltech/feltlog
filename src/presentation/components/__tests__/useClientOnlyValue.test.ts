import { useClientOnlyValue } from '../useClientOnlyValue';

/**
 * Test suite for the useClientOnlyValue hook. On native platforms this hook should
 * always return the client value, ignoring the server value.
 */
describe('useClientOnlyValue', () => {
  /** Tests that the hook returns the client value on native. */
  it('returns the client value on native', () => {
    const serverValue = 'server';
    const clientValue = 'client';

    const result = useClientOnlyValue(serverValue, clientValue);

    expect(result).toBe(clientValue);
  });

  /** Tests that the hook ignores the server value and returns client value. */
  it('ignores the server value', () => {
    const serverValue = 42;
    const clientValue = 100;

    const result = useClientOnlyValue(serverValue, clientValue);

    expect(result).toBe(clientValue);
    expect(result).not.toBe(serverValue);
  });

  /** Tests that the hook works with various types. */
  it('works with different types', () => {
    expect(useClientOnlyValue(null, 'string')).toBe('string');
    expect(useClientOnlyValue(undefined, true)).toBe(true);
    expect(useClientOnlyValue('a', { key: 'value' })).toEqual({ key: 'value' });
  });
});
