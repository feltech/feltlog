import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import LockScreen from '../LockScreen';

/** Mocks useDatabaseInfo to isolate the component from the database context. */
jest.mock('@/src/domain/repositories/DatabaseContext', () => ({
  useDatabaseInfo: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useDatabaseInfo } = require('@/src/domain/repositories/DatabaseContext') as {
  useDatabaseInfo: jest.Mock;
};

/**
 * Renders the LockScreen inside a PaperProvider.
 *
 * @returns The render result from testing-library.
 */
function renderScreen() {
  return render(
    <PaperProvider>
      <LockScreen />
    </PaperProvider>,
  );
}

/**
 * Sets up the useDatabaseInfo mock with the given database handle and reset function.
 *
 * @param sqliteDb - The SQLite database handle, or null for the no-database case.
 * @param resetDatabase - Mock reset callback.
 */
function setupDatabaseMock(sqliteDb: { closeAsync: jest.Mock } | null, resetDatabase: jest.Mock) {
  useDatabaseInfo.mockReturnValue({
    sqliteDb,
    resetDatabase,
  });
}

/**
 * Test suite for the LockScreen component. Covers rendering, locking behaviour, loading
 * state, error handling, and disabled state.
 */
describe('LockScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** Tests that the lock screen and lock button are rendered. */
  it('renders the lock button', () => {
    setupDatabaseMock(null, jest.fn());

    const { getByTestId, getAllByText } = renderScreen();

    expect(getByTestId('lock-screen')).toBeTruthy();
    expect(getByTestId('lock-journal-button')).toBeTruthy();
    // "Lock Journal" appears once as the card title and once as the button label.
    expect(getAllByText('Lock Journal')).toHaveLength(2);
  });

  /** Tests that pressing the lock button closes the database and resets state. */
  it('triggers the lock flow when the lock button is pressed', async () => {
    const closeAsync = jest.fn().mockResolvedValue(undefined);
    const resetDatabase = jest.fn();
    setupDatabaseMock({ closeAsync }, resetDatabase);

    const { getByTestId } = renderScreen();

    fireEvent.press(getByTestId('lock-journal-button'));

    await waitFor(() => {
      expect(closeAsync).toHaveBeenCalledTimes(1);
      expect(resetDatabase).toHaveBeenCalledTimes(1);
    });
  });

  /** Tests that the lock button is disabled while the lock flow runs. */
  it('disables the lock button while locking', async () => {
    let resolveClose: () => void = jest.fn();
    const closePromise = new Promise<void>(resolve => {
      resolveClose = resolve;
    });
    const closeAsync = jest.fn().mockReturnValue(closePromise);
    const resetDatabase = jest.fn();
    setupDatabaseMock({ closeAsync }, resetDatabase);

    const { getByTestId } = renderScreen();

    const buttonBefore = getByTestId('lock-journal-button');
    expect(buttonBefore.props.accessibilityState?.disabled).toBe(false);

    fireEvent.press(getByTestId('lock-journal-button'));

    await waitFor(() => {
      const buttonDuring = getByTestId('lock-journal-button');
      expect(buttonDuring.props.accessibilityState?.disabled).toBe(true);
    });

    resolveClose();

    await waitFor(() => {
      expect(closeAsync).toHaveBeenCalledTimes(1);
      expect(resetDatabase).toHaveBeenCalledTimes(1);
      const buttonAfter = getByTestId('lock-journal-button');
      expect(buttonAfter.props.accessibilityState?.disabled).toBe(false);
    });
  });

  /** Tests that resetDatabase is called even when closeAsync throws. */
  it('calls resetDatabase even if closeAsync throws', async () => {
    const closeAsync = jest.fn().mockRejectedValue(new Error('close failed'));
    const resetDatabase = jest.fn();
    setupDatabaseMock({ closeAsync }, resetDatabase);

    const { getByTestId } = renderScreen();

    fireEvent.press(getByTestId('lock-journal-button'));

    await waitFor(() => {
      expect(closeAsync).toHaveBeenCalledTimes(1);
      expect(resetDatabase).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Tests that the lock button shows a loading (disabled) state while the async close
   * operation is in progress.
   */
  it('shows loading state while locking', async () => {
    let resolveClose: () => void = jest.fn();
    const closePromise = new Promise<void>(resolve => {
      resolveClose = resolve;
    });
    const closeAsync = jest.fn().mockReturnValue(closePromise);
    setupDatabaseMock({ closeAsync }, jest.fn());

    const { getByTestId } = renderScreen();

    fireEvent.press(getByTestId('lock-journal-button'));

    await waitFor(() => {
      const button = getByTestId('lock-journal-button');
      expect(button.props.accessibilityState?.disabled).toBe(true);
    });

    resolveClose();

    await waitFor(() => {
      expect(closeAsync).toHaveBeenCalledTimes(1);
    });
  });
});
