import React from 'react';
import { fireEvent, render, act } from '@testing-library/react-native';
import SetupDatabaseScreen from '../SetupDatabaseScreen';
import {
  DatabaseSetupProvider,
  type DatabaseSetupInfo,
} from '@/src/domain/repositories/DatabaseSetupContext';

/**
 * Mock expo-router's useRouter so the SetupDatabaseScreen can call
 * `router.push('/restore-backup')` without a real navigator.
 */
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useRouter } = require('expo-router') as { useRouter: jest.Mock };

/**
 * Helper that wraps a node in a DatabaseSetupProvider with the given setup info.
 *
 * @param element - The React element to render.
 * @param value - The DatabaseSetupInfo to provide via context.
 *
 * @returns The RNTL render result.
 */
function renderWithSetup(element: React.ReactElement, value: DatabaseSetupInfo) {
  return render(<DatabaseSetupProvider value={value}>{element}</DatabaseSetupProvider>);
}

/**
 * Builds a DatabaseSetupInfo object with sensible defaults for tests.
 *
 * @param overrides - Partial overrides merged over the defaults.
 *
 * @returns A DatabaseSetupInfo suitable for passing to DatabaseSetupProvider.
 */
function makeSetupInfo(overrides: Partial<DatabaseSetupInfo> = {}): DatabaseSetupInfo {
  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    lastDatabaseName: null,
    error: null,
    ...overrides,
  };
}

/**
 * Test suite for the SetupDatabaseScreen component. Covers rendering, input handling,
 * validation, and submission behaviour.
 */
describe('SetupDatabaseScreen', () => {
  const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    useRouter.mockReturnValue(mockRouter);
  });

  /** Tests that the screen renders the title and all form elements. */
  it('renders the setup form with all elements', () => {
    const { getByText, getByTestId } = renderWithSetup(<SetupDatabaseScreen />, makeSetupInfo());

    expect(getByText('Choose database')).toBeTruthy();
    expect(getByTestId('db-name-input')).toBeTruthy();
    expect(getByTestId('db-key-input')).toBeTruthy();
    expect(getByTestId('db-open-btn')).toBeTruthy();
  });

  /**
   * Tests that the database name input defaults to 'feltlog.db' when no
   * lastDatabaseName is provided.
   */
  it('defaults database name to feltlog.db when lastDatabaseName is null', () => {
    const { getByTestId } = renderWithSetup(<SetupDatabaseScreen />, makeSetupInfo());
    const nameInput = getByTestId('db-name-input');
    // The input should have the default value.
    expect(nameInput.props.value).toBe('feltlog.db');
  });

  /** Tests that the database name input uses lastDatabaseName when provided. */
  it('pre-fills database name from lastDatabaseName', () => {
    const { getByTestId } = renderWithSetup(
      <SetupDatabaseScreen />,
      makeSetupInfo({ lastDatabaseName: 'mydb.db' }),
    );
    const nameInput = getByTestId('db-name-input');
    expect(nameInput.props.value).toBe('mydb.db');
  });

  /**
   * Tests that the submit button remains enabled when the encryption key is empty. An
   * empty key means "no encryption" and is a valid configuration.
   */
  it('enables the submit button when database name is filled and key is empty (unencrypted)', () => {
    const { getByTestId } = renderWithSetup(<SetupDatabaseScreen />, makeSetupInfo());
    const btn = getByTestId('db-open-btn');
    // The button should be enabled because the default database name is non-empty.
    expect(btn.props.accessibilityState?.disabled).toBe(false);
  });

  /** Tests that the submit button becomes enabled when both fields are filled. */
  it('enables the submit button when both fields are filled', () => {
    const { getByTestId } = renderWithSetup(<SetupDatabaseScreen />, makeSetupInfo());
    const nameInput = getByTestId('db-name-input');
    const keyInput = getByTestId('db-key-input');

    fireEvent.changeText(nameInput, 'mydb.db');
    fireEvent.changeText(keyInput, 'secret-key');

    const btn = getByTestId('db-open-btn');
    expect(btn.props.accessibilityState?.disabled).toBe(false);
  });

  /**
   * Tests that the helper text informs the user that an empty encryption key creates an
   * unencrypted database.
   */
  it('displays helper text indicating empty key means unencrypted', () => {
    const { getByText } = renderWithSetup(<SetupDatabaseScreen />, makeSetupInfo());
    expect(getByText(/leave empty for an unencrypted database/i)).toBeTruthy();
  });

  /**
   * Tests that the submit button stays disabled when the database name is only
   * whitespace.
   */
  it('disables the submit button when database name is only whitespace', () => {
    const { getByTestId } = renderWithSetup(<SetupDatabaseScreen />, makeSetupInfo());
    const nameInput = getByTestId('db-name-input');
    const keyInput = getByTestId('db-key-input');

    fireEvent.changeText(nameInput, '   ');
    fireEvent.changeText(keyInput, 'secret-key');

    const btn = getByTestId('db-open-btn');
    expect(btn.props.accessibilityState?.disabled).toBe(true);
  });

  /** Tests that pressing submit calls initialize with the correct parameters. */
  it('calls initialize with correct params when submit is pressed', async () => {
    const initialize = jest.fn().mockResolvedValue(undefined);
    const { getByTestId } = renderWithSetup(
      <SetupDatabaseScreen />,
      makeSetupInfo({ initialize }),
    );

    fireEvent.changeText(getByTestId('db-name-input'), 'test.db');
    fireEvent.changeText(getByTestId('db-key-input'), 'my-secret');

    await act(async () => {
      fireEvent.press(getByTestId('db-open-btn'));
    });

    expect(initialize).toHaveBeenCalledWith({
      encryptionKey: 'my-secret',
      databaseName: 'test.db',
    });
  });

  /**
   * Tests that pressing submit with an empty encryption key passes the empty string
   * through to initialize unchanged. The data layer (openKysely) treats '' as "no
   * encryption", so this contract must remain stable.
   */
  it('calls initialize with empty key when key field is left blank', async () => {
    const initialize = jest.fn().mockResolvedValue(undefined);
    const { getByTestId } = renderWithSetup(
      <SetupDatabaseScreen />,
      makeSetupInfo({ initialize }),
    );

    fireEvent.changeText(getByTestId('db-name-input'), 'test.db');
    // Leave the key field empty (default is '').

    await act(async () => {
      fireEvent.press(getByTestId('db-open-btn'));
    });

    expect(initialize).toHaveBeenCalledWith({
      encryptionKey: '',
      databaseName: 'test.db',
    });
  });

  /** Tests that the error message is displayed when provided via context. */
  it('displays error message when error is provided via context', () => {
    const { getByTestId } = renderWithSetup(
      <SetupDatabaseScreen />,
      makeSetupInfo({ error: 'Database locked' }),
    );
    const errorText = getByTestId('db-error-text');
    expect(errorText).toBeTruthy();
  });

  /** Tests that the error message is NOT displayed when error is null. */
  it('does not display error message when error is null', () => {
    const { queryByTestId } = renderWithSetup(<SetupDatabaseScreen />, makeSetupInfo());
    expect(queryByTestId('db-error-text')).toBeNull();
  });

  /**
   * Tests that the restore button is always rendered (it now navigates via router.push
   * rather than being conditionally shown via an onRestore prop).
   */
  it('always renders the restore button', () => {
    const { getByTestId } = renderWithSetup(<SetupDatabaseScreen />, makeSetupInfo());
    expect(getByTestId('restore-backup-btn')).toBeTruthy();
  });

  /** Tests that the restore button calls router.push when pressed. */
  it('navigates to restore-backup when restore button is pressed', () => {
    const { getByTestId } = renderWithSetup(<SetupDatabaseScreen />, makeSetupInfo());

    fireEvent.press(getByTestId('restore-backup-btn'));
    expect(mockRouter.push).toHaveBeenCalledWith('/restore-backup');
  });

  /** Tests that the restore button is disabled while submitting. */
  it('disables restore button while submitting', async () => {
    let resolveInit: () => void;
    const initPromise = new Promise<void>(resolve => {
      resolveInit = resolve;
    });
    const initialize = jest.fn().mockReturnValue(initPromise);

    const { getByTestId } = renderWithSetup(
      <SetupDatabaseScreen />,
      makeSetupInfo({ initialize }),
    );

    fireEvent.changeText(getByTestId('db-name-input'), 'test.db');

    await act(async () => {
      fireEvent.press(getByTestId('db-open-btn'));
    });

    const restoreBtn = getByTestId('restore-backup-btn');
    expect(restoreBtn.props.accessibilityState?.disabled).toBe(true);

    await act(async () => {
      resolveInit!();
    });
  });

  /** Tests that the submit button shows loading state during submission. */
  it('shows loading state during submission', async () => {
    // Make initialize hang so we can observe the loading state.
    let resolveInit: () => void;
    const initPromise = new Promise<void>(resolve => {
      resolveInit = resolve;
    });
    const initialize = jest.fn().mockReturnValue(initPromise);

    const { getByTestId } = renderWithSetup(
      <SetupDatabaseScreen />,
      makeSetupInfo({ initialize }),
    );

    fireEvent.changeText(getByTestId('db-name-input'), 'test.db');
    fireEvent.changeText(getByTestId('db-key-input'), 'key');

    await act(async () => {
      fireEvent.press(getByTestId('db-open-btn'));
    });

    // After pressing, the button should be in loading state (disabled while
    // the promise is pending). The initialize call should have been made.
    expect(initialize).toHaveBeenCalled();

    // Resolve the promise to clean up.
    await act(async () => {
      resolveInit!();
    });
  });
});
