import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { DatabaseInfoProvider, useDatabaseInfo } from '../DatabaseContext';
import type { DatabaseInfo } from '../DatabaseContext';

/**
 * Test suite for DatabaseContext. Covers the provider rendering and the hook returning
 * the injected database info.
 */
describe('DatabaseContext', () => {
  /** Tests that the DatabaseInfoProvider renders its children. */
  it('renders children', () => {
    const { getByText } = render(
      <DatabaseInfoProvider
        value={{
          databaseName: 'test.db',
          databasePath: null,
          isCurrentlyEncrypted: true,
          sqliteDb: null,
          resetDatabase: jest.fn(),
        }}
      >
        <Text>Child content</Text>
      </DatabaseInfoProvider>,
    );
    expect(getByText('Child content')).toBeTruthy();
  });

  /** Tests that useDatabaseInfo returns the value provided by the context. */
  it('returns the provided database info via useDatabaseInfo', () => {
    let receivedInfo: DatabaseInfo | null = null;

    /**
     * Harness component to capture the database info from the hook.
     *
     * @returns Null.
     */
    function Harness() {
      receivedInfo = useDatabaseInfo();
      return null;
    }

    render(
      <DatabaseInfoProvider
        value={{
          databaseName: 'test.db',
          databasePath: '/data/test.db',
          isCurrentlyEncrypted: true,
          sqliteDb: null,
          resetDatabase: jest.fn(),
        }}
      >
        <Harness />
      </DatabaseInfoProvider>,
    );

    expect(receivedInfo).toEqual({
      databaseName: 'test.db',
      databasePath: '/data/test.db',
      isCurrentlyEncrypted: true,
      sqliteDb: null,
      resetDatabase: expect.any(Function),
    });
  });

  /** Tests that useDatabaseInfo returns default null values with no provider. */
  it('returns default null values when called outside a DatabaseInfoProvider', () => {
    let receivedInfo: DatabaseInfo | null = null;

    /**
     * Harness component that calls useDatabaseInfo without a provider.
     *
     * @returns Null.
     */
    function Harness() {
      receivedInfo = useDatabaseInfo();
      return null;
    }

    render(<Harness />);

    expect(receivedInfo).toEqual({
      databaseName: null,
      databasePath: null,
      isCurrentlyEncrypted: true,
      sqliteDb: null,
      resetDatabase: expect.any(Function),
    });
  });
});
