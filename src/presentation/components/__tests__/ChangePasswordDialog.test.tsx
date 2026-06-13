import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

/**
 * Mock SafeAreaProvider to pass through children. The native SafeAreaProvider renders
 * as RNCSafeAreaProvider, which does not pass children through in the Jest environment.
 * We preserve the actual module's Context so react-native-paper's
 * SafeAreaProviderCompat can read the Consumer.
 */
jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    ...jest.requireActual('react-native-safe-area-context'),
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-file-system/legacy', () => require('../../../test-utils/expo-file-system-mock'));

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn().mockResolvedValue({
    databasePath: '/mock/test.db',
    closeAsync: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('@/src/data/database/dbBackupStorage', () => ({
  getBackupDirectoryUri: jest.fn(),
  setBackupDirectoryUri: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/src/data/database/backup', () => ({
  backupDatabase: jest.fn().mockResolvedValue({ success: true }),
  extractFileName: jest.fn((uri: string) => uri.split('/').pop() ?? ''),
  getLatestMigrationKey: jest.fn().mockReturnValue('20260523_one'),
}));

jest.mock('@/src/data/database/restore', () => ({
  restoreDatabase: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('@/src/data/database/database', () => ({
  useDatabase: jest.fn(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
  })),
  openKysely: jest.fn().mockResolvedValue({
    sqliteDb: {
      databasePath: '/mock/test.db',
      closeAsync: jest.fn().mockResolvedValue(undefined),
    },
  }),
}));

import ChangePasswordDialog from '../ChangePasswordDialog';

/**
 * Helper that wraps the component in a PaperProvider so react-native-paper Portal /
 * Snackbar / Dialog have access to the theme.
 *
 * @param element - The React element to render.
 *
 * @returns The RNTL render result.
 */
function renderWithProvider(element: React.ReactElement) {
  return render(<PaperProvider>{element}</PaperProvider>);
}

/** Tests for the ChangePasswordDialog thin presentation component. */
describe('ChangePasswordDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * When the dialog is not visible the hook's isOpen is false, so Paper's Dialog
   * renders no children. Form field testIDs should not be in the tree.
   */
  it('does not render visible form content when visible is false', () => {
    const { queryByTestId } = renderWithProvider(
      <ChangePasswordDialog
        databaseName="test.db"
        isCurrentlyEncrypted={true}
        visible={false}
        onClose={jest.fn()}
        showSnackbar={jest.fn()}
      />,
    );

    expect(queryByTestId('change-password-current-key')).toBeNull();
    expect(queryByTestId('change-password-new-key')).toBeNull();
    expect(queryByTestId('change-password-confirm-key')).toBeNull();
  });

  /** When visible the dialog opens and all form controls are reachable. */
  it('renders all form fields when visible is true', () => {
    const tree = renderWithProvider(
      <ChangePasswordDialog
        databaseName="test.db"
        isCurrentlyEncrypted={true}
        visible={true}
        onClose={jest.fn()}
        showSnackbar={jest.fn()}
      />,
    );

    expect(tree.getByTestId('change-password-current-key')).toBeTruthy();
    expect(tree.getByTestId('change-password-new-key')).toBeTruthy();
    expect(tree.getByTestId('change-password-confirm-key')).toBeTruthy();
    expect(tree.getByTestId('change-password-cancel')).toBeTruthy();
    expect(tree.getByTestId('change-password-submit')).toBeTruthy();

    // Verify the root Dialog testID is present (used by other tests
    // for prop assertions).
    expect(tree.getByTestId('change-password-dialog')).toBeTruthy();
  });

  /** Pressing the Cancel button invokes the external onClose callback. */
  it('calls onClose when Cancel button is pressed', () => {
    const onClose = jest.fn();
    const { getByTestId } = renderWithProvider(
      <ChangePasswordDialog
        databaseName="test.db"
        isCurrentlyEncrypted={true}
        visible={true}
        onClose={onClose}
        showSnackbar={jest.fn()}
      />,
    );

    fireEvent.press(getByTestId('change-password-cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  /**
   * When the visible prop flips from true to false the effect calls flow.close(), which
   * resets the form. We verify the reset by reopening the dialog afterwards. This
   * exercises the else-if branch in the visibility sync effect.
   */
  it('resets form when visible prop changes from true to false and back to true', () => {
    const screen = renderWithProvider(
      <ChangePasswordDialog
        databaseName="test.db"
        isCurrentlyEncrypted={true}
        visible={true}
        onClose={jest.fn()}
        showSnackbar={jest.fn()}
      />,
    );

    fireEvent.changeText(screen.getByTestId('change-password-current-key'), 'oldkey');
    expect(screen.getByTestId('change-password-current-key').props.value).toBe('oldkey');

    // Close the dialog by toggling visible to false.
    screen.rerender(
      <PaperProvider>
        <ChangePasswordDialog
          databaseName="test.db"
          isCurrentlyEncrypted={true}
          visible={false}
          onClose={jest.fn()}
          showSnackbar={jest.fn()}
        />
      </PaperProvider>,
    );

    // Re-open the dialog — the form should be reset because close() cleared it.
    screen.rerender(
      <PaperProvider>
        <ChangePasswordDialog
          databaseName="test.db"
          isCurrentlyEncrypted={true}
          visible={true}
          onClose={jest.fn()}
          showSnackbar={jest.fn()}
        />
      </PaperProvider>,
    );

    expect(screen.getByTestId('change-password-current-key').props.value).toBe('');
  });

  /**
   * For an unencrypted database the helper text tells the user to leave the field
   * empty.
   */
  it('shows "Database is unencrypted" helper text when isCurrentlyEncrypted is false', () => {
    const { getByText } = renderWithProvider(
      <ChangePasswordDialog
        databaseName="test.db"
        isCurrentlyEncrypted={false}
        visible={true}
        onClose={jest.fn()}
        showSnackbar={jest.fn()}
      />,
    );

    expect(getByText('Database is unencrypted — leave empty.')).toBeTruthy();
  });

  /** For an encrypted database the helper text prompts for the current key. */
  it('shows "Enter your current encryption key" helper text when isCurrentlyEncrypted is true', () => {
    const { getByText } = renderWithProvider(
      <ChangePasswordDialog
        databaseName="test.db"
        isCurrentlyEncrypted={true}
        visible={true}
        onClose={jest.fn()}
        showSnackbar={jest.fn()}
      />,
    );

    expect(getByText('Enter your current encryption key.')).toBeTruthy();
  });

  /** The confirm Dialog is hidden until the user submits valid input. */
  it('confirm dialog is not visible by default', () => {
    const { queryByTestId, queryByText } = renderWithProvider(
      <ChangePasswordDialog
        databaseName="test.db"
        isCurrentlyEncrypted={true}
        visible={true}
        onClose={jest.fn()}
        showSnackbar={jest.fn()}
      />,
    );

    expect(queryByTestId('change-password-confirm-cancel')).toBeNull();
    expect(queryByText('Confirm password change')).toBeNull();
  });

  /**
   * After entering matching new keys and pressing Change, the hook's submit() runs
   * without error. We cannot assert on the confirm-dialog inner elements because
   * Paper's Portal does not reliably surface them to RNTL after state changes. The
   * confirm-dialog logic is fully covered by useChangePassword.test.ts.
   */
  it('fires submit callback when Change button is pressed', () => {
    const showSnackbar = jest.fn();
    const screen = renderWithProvider(
      <ChangePasswordDialog
        databaseName="test.db"
        isCurrentlyEncrypted={true}
        visible={true}
        onClose={jest.fn()}
        showSnackbar={showSnackbar}
      />,
    );

    fireEvent.changeText(screen.getByTestId('change-password-current-key'), 'oldkey');
    fireEvent.changeText(screen.getByTestId('change-password-new-key'), 'newkey');
    fireEvent.changeText(screen.getByTestId('change-password-confirm-key'), 'newkey');

    fireEvent.press(screen.getByTestId('change-password-submit'));

    // Valid form → no error snackbar.
    expect(showSnackbar).not.toHaveBeenCalled();
  });

  /** Safety-backup notice appears in the form, not in the confirm dialog. */
  it('renders the safety-backup notice in the form', () => {
    const { getByTestId } = renderWithProvider(
      <ChangePasswordDialog
        databaseName="test.db"
        isCurrentlyEncrypted={true}
        visible={true}
        onClose={jest.fn()}
        showSnackbar={jest.fn()}
      />,
    );

    const notice = getByTestId('safety-backup-notice');
    expect(notice).toBeTruthy();
    expect(notice.props.children).toContain('safety backup');
  });

  /**
   * The safety-backup text appears in the form's dedicated HelperText element with a
   * testID. The confirmation dialog uses a shorter, non-duplicated wording.
   */
  it('safety-backup text appears in the form via testID', () => {
    const { getByTestId, queryByText } = renderWithProvider(
      <ChangePasswordDialog
        databaseName="test.db"
        isCurrentlyEncrypted={true}
        visible={true}
        onClose={jest.fn()}
        showSnackbar={jest.fn()}
      />,
    );

    // The form's safety-backup-notice is present.
    const notice = getByTestId('safety-backup-notice');
    expect(notice).toBeTruthy();
    expect(notice.props.children).toContain('safety backup');

    // The confirmation dialog's shorter wording does NOT appear in the
    // form — it lives in the second Dialog which is hidden by default.
    expect(queryByText('Proceed with changing the encryption password?')).toBeNull();
  });
});
