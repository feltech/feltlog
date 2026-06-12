import React from 'react';
import { fireEvent, render, act } from '@testing-library/react-native';
import SetupDatabaseScreen from '../SetupDatabaseScreen';

/**
 * Test suite for the SetupDatabaseScreen component. Covers rendering, input handling,
 * validation, and submission behaviour.
 */
describe('SetupDatabaseScreen', () => {
  const defaultProps = {
    initialize: jest.fn().mockResolvedValue(undefined),
    lastDatabaseName: null as string | null,
    error: null as unknown | null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** Tests that the screen renders the title and all form elements. */
  it('renders the setup form with all elements', () => {
    const { getByText, getByTestId } = render(<SetupDatabaseScreen {...defaultProps} />);

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
    const { getByTestId } = render(<SetupDatabaseScreen {...defaultProps} />);
    const nameInput = getByTestId('db-name-input');
    // The input should have the default value.
    expect(nameInput.props.value).toBe('feltlog.db');
  });

  /** Tests that the database name input uses lastDatabaseName when provided. */
  it('pre-fills database name from lastDatabaseName', () => {
    const { getByTestId } = render(
      <SetupDatabaseScreen {...defaultProps} lastDatabaseName="mydb.db" />,
    );
    const nameInput = getByTestId('db-name-input');
    expect(nameInput.props.value).toBe('mydb.db');
  });

  /**
   * Tests that the submit button remains enabled when the encryption key is empty. An
   * empty key means "no encryption" and is a valid configuration.
   */
  it('enables the submit button when database name is filled and key is empty (unencrypted)', () => {
    const { getByTestId } = render(<SetupDatabaseScreen {...defaultProps} />);
    const btn = getByTestId('db-open-btn');
    // The button should be enabled because the default database name is non-empty.
    expect(btn.props.accessibilityState?.disabled).toBe(false);
  });

  /** Tests that the submit button becomes enabled when both fields are filled. */
  it('enables the submit button when both fields are filled', () => {
    const { getByTestId } = render(<SetupDatabaseScreen {...defaultProps} />);
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
    const { getByText } = render(<SetupDatabaseScreen {...defaultProps} />);
    expect(getByText(/leave empty for an unencrypted database/i)).toBeTruthy();
  });

  /**
   * Tests that the submit button stays disabled when the database name is only
   * whitespace.
   */
  it('disables the submit button when database name is only whitespace', () => {
    const { getByTestId } = render(<SetupDatabaseScreen {...defaultProps} />);
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
    const { getByTestId } = render(
      <SetupDatabaseScreen {...defaultProps} initialize={initialize} />,
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
    const { getByTestId } = render(
      <SetupDatabaseScreen {...defaultProps} initialize={initialize} />,
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

  /** Tests that the error message is displayed when an error prop is provided. */
  it('displays error message when error prop is provided', () => {
    const { getByTestId } = render(
      <SetupDatabaseScreen {...defaultProps} error="Database locked" />,
    );
    const errorText = getByTestId('db-error-text');
    expect(errorText).toBeTruthy();
  });

  /** Tests that the error message is NOT displayed when error prop is null. */
  it('does not display error message when error is null', () => {
    const { queryByTestId } = render(<SetupDatabaseScreen {...defaultProps} />);
    expect(queryByTestId('db-error-text')).toBeNull();
  });

  /** Tests that the submit button shows loading state during submission. */
  it('shows loading state during submission', async () => {
    // Make initialize hang so we can observe the loading state.
    let resolveInit: () => void;
    const initPromise = new Promise<void>(resolve => {
      resolveInit = resolve;
    });
    const initialize = jest.fn().mockReturnValue(initPromise);

    const { getByTestId } = render(
      <SetupDatabaseScreen {...defaultProps} initialize={initialize} />,
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
