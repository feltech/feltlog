import React from 'react';
import { ScrollView } from 'react-native';
import { Button, Dialog, HelperText, Portal, TextInput } from 'react-native-paper';
import {
  useChangePassword,
  UseChangePasswordInput,
  useChangePasswordDeps,
} from './useChangePassword';

/** Props for the {@link ChangePasswordDialog} component. */
export interface ChangePasswordDialogProps {
  /** The currently active database name. */
  databaseName: string;
  /** Whether the DB is currently encrypted. */
  isCurrentlyEncrypted: boolean;
  /** Whether the dialog is visible (controlled externally). */
  visible: boolean;
  /** Callback to close the dialog. */
  onClose: () => void;
  /** Callback to show a snackbar message. */
  showSnackbar: (message: string, isError: boolean) => void;
}

/**
 * A thin Paper Dialog component that renders the change-password form and the safety
 * backup confirmation dialog.
 *
 * State and logic are delegated to {@link useChangePassword}; this component is a thin
 * presentation layer.
 *
 * @param props - The component props.
 * @param props.databaseName - The currently active database name.
 * @param props.isCurrentlyEncrypted - Whether the DB is currently encrypted.
 * @param props.visible - Whether the dialog is visible.
 * @param props.onClose - Callback to close the dialog.
 * @param props.showSnackbar - Callback to show a snackbar message.
 *
 * @returns The rendered dialog elements.
 */
export default function ChangePasswordDialog({
  databaseName,
  isCurrentlyEncrypted,
  visible,
  onClose,
  showSnackbar,
}: ChangePasswordDialogProps) {
  const input: UseChangePasswordInput = { databaseName, isCurrentlyEncrypted };
  const deps = useChangePasswordDeps(showSnackbar);
  const flow = useChangePassword(input, deps);

  // Sync external visibility with the hook's open/close state.
  React.useEffect(() => {
    if (visible && !flow.isOpen) {
      flow.open();
    } else if (!visible && flow.isOpen) {
      flow.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // When the hook closes itself (e.g. after a successful change), propagate to parent.
  React.useEffect(() => {
    if (!flow.isOpen && visible) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.isOpen]);

  return (
    <Portal>
      <Dialog visible={flow.isOpen} onDismiss={onClose} testID="change-password-dialog">
        <Dialog.Title>Change encryption password</Dialog.Title>
        <Dialog.ScrollArea>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Dialog.Content>
              <TextInput
                testID="change-password-current-key"
                label="Current key"
                placeholder={isCurrentlyEncrypted ? 'Current encryption key' : 'Leave empty'}
                value={flow.currentKey}
                onChangeText={flow.setCurrentKey}
                secureTextEntry
              />
              <HelperText type="info">
                {isCurrentlyEncrypted
                  ? 'Enter your current encryption key.'
                  : 'Database is unencrypted — leave empty.'}
              </HelperText>

              <TextInput
                testID="change-password-new-key"
                label="New key"
                placeholder="Leave empty to remove encryption"
                value={flow.newKey}
                onChangeText={flow.setNewKey}
                secureTextEntry
              />

              <TextInput
                testID="change-password-confirm-key"
                label="Confirm new key"
                placeholder="Re-enter the new key"
                value={flow.confirmKey}
                onChangeText={flow.setConfirmKey}
                secureTextEntry
              />
            </Dialog.Content>
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={onClose} testID="change-password-cancel">
            Cancel
          </Button>
          <Button onPress={flow.submit} testID="change-password-submit" disabled={flow.submitting}>
            Change
          </Button>
        </Dialog.Actions>
      </Dialog>

      <Dialog
        visible={flow.showConfirmDialog}
        onDismiss={flow.cancelProceed}
        testID="change-password-confirm-dialog"
      >
        <Dialog.Title>Confirm password change</Dialog.Title>
        <Dialog.Content>
          <HelperText type="info">
            A safety backup of the current database will be saved to the configured backup location
            before changing the password.
          </HelperText>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={flow.cancelProceed} testID="change-password-confirm-cancel">
            Cancel
          </Button>
          <Button
            onPress={flow.confirmProceed}
            testID="change-password-confirm-proceed"
            disabled={flow.submitting}
            loading={flow.submitting}
          >
            Continue
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
