import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import LockScreen from '../lock';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Mock useDatabaseInfo to provide test database state and reset callback. */
jest.mock('@/src/domain/repositories/DatabaseContext', () => ({
  useDatabaseInfo: jest.fn(),
}));

import { useDatabaseInfo } from '@/src/domain/repositories/DatabaseContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  (useDatabaseInfo as jest.Mock).mockReturnValue({
    sqliteDb,
    resetDatabase,
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

/**
 * Test suite for the Lock screen. Covers rendering, lock behavior, null database
 * handling, best-effort close error handling, and loading state.
 */
describe('LockScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** Tests that the screen renders with the lock button. */
  it('renders with the lock button', async () => {
    setupDatabaseMock(null, jest.fn());

    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('lock-screen')).toBeTruthy();
      expect(getByTestId('lock-journal-button')).toBeTruthy();
      expect(
        getByText('Tap below to lock the journal and return to the login screen.'),
      ).toBeTruthy();
    });
  });

  /** Tests that pressing the lock button closes the DB and calls resetDatabase. */
  it('closes the database and calls resetDatabase when the lock button is pressed', async () => {
    const closeAsync = jest.fn().mockResolvedValue(undefined);
    const resetDatabase = jest.fn();
    setupDatabaseMock({ closeAsync }, resetDatabase);

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('lock-journal-button')).toBeTruthy();
    });

    fireEvent.press(getByTestId('lock-journal-button'));

    await waitFor(() => {
      expect(closeAsync).toHaveBeenCalled();
      expect(resetDatabase).toHaveBeenCalled();
    });
  });

  /** Tests that resetDatabase is still called when sqliteDb is null. */
  it('calls resetDatabase when sqliteDb is null', async () => {
    const resetDatabase = jest.fn();
    setupDatabaseMock(null, resetDatabase);

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('lock-journal-button')).toBeTruthy();
    });

    fireEvent.press(getByTestId('lock-journal-button'));

    await waitFor(() => {
      expect(resetDatabase).toHaveBeenCalled();
    });
  });

  /** Tests that a closeAsync failure does not block resetDatabase. */
  it('calls resetDatabase even when closeAsync fails', async () => {
    const closeAsync = jest.fn().mockRejectedValue(new Error('Close failed'));
    const resetDatabase = jest.fn();
    setupDatabaseMock({ closeAsync }, resetDatabase);

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('lock-journal-button')).toBeTruthy();
    });

    fireEvent.press(getByTestId('lock-journal-button'));

    await waitFor(() => {
      expect(closeAsync).toHaveBeenCalled();
      expect(resetDatabase).toHaveBeenCalled();
    });
  });

  /**
   * Tests that the lock button shows a loading/disabled state while the async close
   * operation is in progress.
   */
  it('disables the lock button while locking', async () => {
    /** Resolves the pending closeAsync promise. */
    let resolveClose: () => void = () => {};
    const closePromise = new Promise<void>(resolve => {
      resolveClose = resolve;
    });
    const closeAsync = jest.fn().mockReturnValue(closePromise);
    const resetDatabase = jest.fn();
    setupDatabaseMock({ closeAsync }, resetDatabase);

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('lock-journal-button')).toBeTruthy();
    });

    fireEvent.press(getByTestId('lock-journal-button'));

    await waitFor(() => {
      const lockButton = getByTestId('lock-journal-button');
      expect(lockButton.props.accessibilityState.disabled).toBe(true);
    });

    resolveClose();

    await waitFor(() => {
      expect(closeAsync).toHaveBeenCalled();
      expect(resetDatabase).toHaveBeenCalled();
    });
  });
});
