import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { DatabaseSetupProvider, useDatabaseSetup } from '../DatabaseSetupContext';

/**
 * A consumer component that reads from the DatabaseSetupContext and renders the
 * lastDatabaseName so tests can assert what the context provides.
 *
 * @returns A Text element displaying the current lastDatabaseName.
 */
function Consumer() {
  const { lastDatabaseName } = useDatabaseSetup();
  return <Text>{lastDatabaseName ?? 'null'}</Text>;
}

describe('DatabaseSetupContext', () => {
  /** The provider passes its value through to consuming descendants. */
  it('provides the value to consumers', () => {
    const { getByText } = render(
      <DatabaseSetupProvider
        value={{
          initialize: jest.fn().mockResolvedValue(undefined),
          lastDatabaseName: 'provided.db',
          error: null,
        }}
      >
        <Consumer />
      </DatabaseSetupProvider>,
    );
    expect(getByText('provided.db')).toBeTruthy();
  });

  /**
   * The default context value (used when no provider is mounted) exposes an initialize
   * that rejects with a misuse error. This guards against accidental use outside the
   * root layout.
   */
  it('default initialize rejects with a misuse error when consumed without a provider', async () => {
    const setup = renderHookWithoutProvider();
    await expect(setup.initialize({ encryptionKey: '', databaseName: 'x.db' })).rejects.toThrow(
      'DatabaseSetupProvider not mounted.',
    );
  });
});

/**
 * Renders the Consumer without a provider so the default context value is used, then
 * returns the hook result.
 *
 * @returns The DatabaseSetupInfo captured from the default context value.
 */
function renderHookWithoutProvider() {
  let captured: ReturnType<typeof useDatabaseSetup> | null = null;
  /**
   * Capture component that reads the default context value.
   *
   * @returns Null.
   */
  const Capture = () => {
    captured = useDatabaseSetup();
    return null;
  };
  render(<Capture />);
  // The default value is stable; captured is non-null after render.
  return captured as unknown as ReturnType<typeof useDatabaseSetup>;
}
