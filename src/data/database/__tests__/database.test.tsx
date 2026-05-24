import { act, renderHook } from '@testing-library/react-native';
import { useDatabase } from '../database';

describe('useDatabase', () => {
  /**
   * Generates a unique, random database filename for tests to avoid collisions.
   *
   * @returns A random database file name string.
   */
  const makeDbName = () => `test_${Date.now()}_${Math.random()}.db`;

  it('should initialize the database with an encryption key', async () => {
    const { result } = renderHook(() => useDatabase());

    await act(async () => {
      await result.current.initialize({
        encryptionKey: 'test-key',
        databaseName: makeDbName(),
      });
    });

    expect(result.current.ready).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.db).not.toBeNull();
  });

  it('should initialize the database without an explicit encryption key', async () => {
    const { result } = renderHook(() => useDatabase());

    await act(async () => {
      await result.current.initialize({
        encryptionKey: 'test-key',
        databaseName: makeDbName(),
      });
    });

    expect(result.current.ready).toBe(true);
    expect(result.current.db).not.toBeNull();
  });
});
