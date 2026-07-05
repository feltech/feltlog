import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Appbar,
  Button,
  IconButton,
  Surface,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { DatePickerModal } from 'react-native-paper-dates';

import type { JournalFilterDraft } from '@/src/presentation/viewmodels/JournalViewModel';

/** Props for the JournalFilterPanel component. */
export interface JournalFilterPanelProps {
  /** The current draft filter values shown in the panel. */
  draft: JournalFilterDraft;
  /** Callback to update a single draft field. Pass undefined to clear a date. */
  onUpdateDraft: (patch: Partial<JournalFilterDraft>) => void;
  /** Callback invoked when the user presses the clear button. */
  onClear: () => void;
  /** Callback invoked when the user presses the OK (apply) button. */
  onApply: () => void;
}

/**
 * Resolves the initial date shown by the picker for an unset field.
 *
 * When the start-date picker is opened and the start date is unset, the picker defaults
 * to the currently selected end date (if any). When the end-date picker is opened and
 * the end date is unset, it defaults to the currently selected start date (if any). If
 * neither date is set, it defaults to today. This keeps the picker anchored to the
 * existing range rather than jumping to the current day when the user is mid-edit.
 *
 * @param which - Which picker is open: 'start' or 'end'.
 * @param draft - The current draft filter values.
 *
 * @returns The Date to pass to the DatePickerModal `date` prop.
 */
export function resolvePickerDate(which: 'start' | 'end', draft: JournalFilterDraft): Date {
  if (which === 'start') {
    if (draft.startDate !== undefined) return draft.startDate;
    if (draft.endDate !== undefined) return draft.endDate;
    return new Date();
  }
  if (draft.endDate !== undefined) return draft.endDate;
  if (draft.startDate !== undefined) return draft.startDate;
  return new Date();
}

/**
 * Collapsible filter panel shown above the journal list.
 *
 * Renders start/end date picker triggers (with clear buttons), a phrase text input, a
 * clear-all button, and an OK button to apply the filter. Uses the same
 * `react-native-paper-dates` `DatePickerModal` as the entry editor.
 *
 * @param props - Component props.
 * @param props.draft - The current draft filter values.
 * @param props.onUpdateDraft - Callback to update draft fields.
 * @param props.onClear - Callback to clear the draft.
 * @param props.onApply - Callback to apply the draft.
 *
 * @returns The rendered filter panel.
 */
export function JournalFilterPanel({
  draft,
  onUpdateDraft,
  onClear,
  onApply,
}: JournalFilterPanelProps) {
  const theme = useTheme();
  // Controls which date picker modal is open: 'start', 'end', or none.
  const [pickerOpen, setPickerOpen] = useState<'start' | 'end' | null>(null);

  /**
   * Handles a date selection from the DatePickerModal.
   *
   * @param param - The modal confirmation payload.
   * @param param.date - The selected date, or undefined if dismissed.
   */
  const handleDateConfirm = ({ date }: { date?: Date }) => {
    const which = pickerOpen;
    setPickerOpen(null);
    if (!date) return;
    // Normalise to start-of-day for the start bound and end-of-day for the end
    // bound so the filter is inclusive of the whole selected day.
    const normalised = new Date(date);
    if (which === 'start') {
      normalised.setHours(0, 0, 0, 0);
      onUpdateDraft({ startDate: normalised });
    } else if (which === 'end') {
      normalised.setHours(23, 59, 59, 999);
      onUpdateDraft({ endDate: normalised });
    }
  };

  return (
    <Surface
      testID="filter-panel"
      style={[styles.container, { backgroundColor: theme.colors.surface }]}
      elevation={1}
    >
      <View style={styles.row}>
        <Text variant="titleSmall" style={styles.title}>
          Filter
        </Text>
        <View style={styles.actions}>
          <Appbar.Action
            icon="backup-restore"
            testID="filter-clear-button"
            accessibilityLabel="Clear filter"
            onPress={onClear}
          />
          <Appbar.Action
            icon="check"
            testID="filter-ok-button"
            accessibilityLabel="Apply filter"
            onPress={onApply}
          />
        </View>
      </View>

      <View style={styles.datesRow}>
        <Button
          mode="outlined"
          icon="calendar-start"
          testID="filter-start-date-button"
          accessibilityLabel="Filter start date"
          onPress={() => setPickerOpen('start')}
          textColor={theme.colors.primary}
          style={styles.dateButton}
        >
          {draft.startDate ? draft.startDate.toLocaleDateString() : 'Start date'}
        </Button>
        {draft.startDate !== undefined && (
          <IconButton
            icon="close-circle"
            testID="filter-start-date-clear"
            accessibilityLabel="Clear start date"
            size={18}
            onPress={() => onUpdateDraft({ startDate: undefined })}
          />
        )}
      </View>

      <View style={styles.datesRow}>
        <Button
          mode="outlined"
          icon="calendar-end"
          testID="filter-end-date-button"
          accessibilityLabel="Filter end date"
          onPress={() => setPickerOpen('end')}
          textColor={theme.colors.primary}
          style={styles.dateButton}
        >
          {draft.endDate ? draft.endDate.toLocaleDateString() : 'End date'}
        </Button>
        {draft.endDate !== undefined && (
          <IconButton
            icon="close-circle"
            testID="filter-end-date-clear"
            accessibilityLabel="Clear end date"
            size={18}
            onPress={() => onUpdateDraft({ endDate: undefined })}
          />
        )}
      </View>

      <TextInput
        testID="filter-phrase-input"
        label="Exact phrase"
        value={draft.phrase}
        onChangeText={text => onUpdateDraft({ phrase: text })}
        mode="outlined"
        style={styles.phraseInput}
        placeholder="Search for an exact phrase…"
      />

      {pickerOpen !== null && (
        <View testID="filter-date-picker-modal">
          <DatePickerModal
            locale="en"
            mode="single"
            visible={true}
            onDismiss={() => setPickerOpen(null)}
            date={resolvePickerDate(pickerOpen, draft)}
            onConfirm={handleDateConfirm}
          />
        </View>
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  title: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
  },
  datesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  dateButton: {
    flex: 1,
  },
  phraseInput: {
    marginTop: 4,
  },
});
