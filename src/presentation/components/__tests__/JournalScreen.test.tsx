import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import JournalScreen from '../JournalScreen';
import { useJournalViewModel } from '@/src/presentation/viewmodels/JournalViewModel';
import type { JournalEntry } from '@/src/domain/entities/JournalEntry';

const mockPush = jest.fn();

/**
 * Captured useFocusEffect callback so tests can invoke focus-based refresh explicitly
 * without depending on React effect timing.
 */
let focusEffectCallback: (() => void) | undefined;

jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useFocusEffect: jest.fn((cb: () => void) => {
    focusEffectCallback = cb;
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useRouter } = require('expo-router') as { useRouter: jest.Mock };

jest.mock('@/src/presentation/viewmodels/JournalViewModel', () => ({
  useJournalViewModel: jest.fn(),
}));

jest.mock('react-native-paper', () => {
  const actual = jest.requireActual('react-native-paper');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { lightTheme } = require('@/src/presentation/theme/appTheme');
  return {
    ...actual,
    useTheme: jest.fn(() => lightTheme),
  };
});

/**
 * Mock SafeAreaProvider to pass through children. The native SafeAreaProvider renders
 * as RNCSafeAreaProvider, which does not pass children through in the Jest
 * environment.
 */
jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    ...jest.requireActual('react-native-safe-area-context'),
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SafeAreaConsumer: jest.fn(),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

/** Default state for the mock view model. */
const DEFAULT_STATE = {
  entries: [] as JournalEntry[],
  tags: [],
  loading: false,
  error: null as string | null,
  searchQuery: '',
  selectedTags: [] as string[],
  hasMore: false,
};

/** Default actions for the mock view model. */
const DEFAULT_ACTIONS = {
  refreshData: jest.fn(),
  loadMoreEntries: jest.fn(),
  createEntry: jest.fn(),
  updateEntry: jest.fn(),
  deleteEntry: jest.fn(),
  search: jest.fn(),
  filterByTags: jest.fn(),
  clearFilters: jest.fn(),
  setError: jest.fn(),
  getEntryById: jest.fn(),
  loadDefaultTags: jest.fn(),
};

/**
 * Sets up the mocks for the journal view model with optional overrides.
 *
 * @param overrides - Optional partial overrides for state and actions.
 * @param overrides.state - Partial state overrides.
 * @param overrides.actions - Partial action overrides.
 */
function setupMocks(overrides?: {
  state?: Partial<typeof DEFAULT_STATE>;
  actions?: Partial<typeof DEFAULT_ACTIONS>;
}) {
  (useJournalViewModel as jest.Mock).mockReturnValue({
    state: { ...DEFAULT_STATE, ...overrides?.state },
    actions: { ...DEFAULT_ACTIONS, ...overrides?.actions },
  });
}

/**
 * Renders the JournalScreen inside required providers.
 *
 * @returns The render result.
 */
function renderScreen() {
  return render(
    <PaperProvider>
      <JournalScreen />
    </PaperProvider>,
  );
}

/**
 * Creates a sample journal entry for testing.
 *
 * @param id - The entry ID.
 * @param content - The entry content.
 *
 * @returns A sample journal entry.
 */
function makeEntry(id: string, content: string = 'Test content'): JournalEntry {
  return {
    id,
    content,
    datetime: new Date('2025-01-15T12:00:00Z'),
    created_at: new Date('2025-01-15T12:00:00Z'),
    modified_at: new Date('2025-01-15T12:00:00Z'),
    tags: [],
  };
}

/**
 * Test suite for the JournalScreen component. Covers rendering, navigation, error
 * snackbar handling, focus-based refresh, and loading state propagation.
 */
describe('JournalScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    focusEffectCallback = undefined;
    useRouter.mockReturnValue({ push: mockPush, back: jest.fn() });
  });

  /** Tests that the JournalList receives entries from the ViewModel. */
  it('renders JournalList with entries from the ViewModel', () => {
    const entries = [makeEntry('entry-1', 'First entry'), makeEntry('entry-2', 'Second entry')];
    setupMocks({ state: { entries } });

    const { getByText } = renderScreen();

    expect(getByText('First entry')).toBeTruthy();
    expect(getByText('Second entry')).toBeTruthy();
  });

  /** Tests that the FAB is rendered and navigates to the entry editor on press. */
  it('navigates to the entry editor when the FAB is pressed', () => {
    setupMocks();

    const { getByTestId } = renderScreen();
    fireEvent.press(getByTestId('create-entry-fab'));

    expect(mockPush).toHaveBeenCalledWith('/entry-editor');
  });

  /** Tests that pressing a journal entry navigates to the entry editor with the id. */
  it('navigates to entry editor when a journal entry is pressed', () => {
    const entries = [makeEntry('entry-1', 'Press me')];
    setupMocks({ state: { entries } });

    const { getByText } = renderScreen();
    fireEvent.press(getByText('Press me'));

    expect(mockPush).toHaveBeenCalledWith('/entry-editor?entryId=entry-1');
  });

  /** Tests that the Snackbar displays when the ViewModel reports an error. */
  it('shows the Snackbar when state.error is set', async () => {
    setupMocks({ state: { error: 'Something went wrong' } });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Something went wrong')).toBeTruthy();
    });
  });

  /** Tests that dismissing the Snackbar clears the ViewModel error. */
  it('calls setError(null) when the Snackbar dismiss action is pressed', async () => {
    const setError = jest.fn();
    setupMocks({
      state: { error: 'Error message' },
      actions: { setError },
    });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Error message')).toBeTruthy();
    });

    fireEvent.press(getByText('Dismiss'));
    expect(setError).toHaveBeenCalledWith(null);
  });

  /** Tests that the focus effect refreshes data when the screen gains focus. */
  it('refreshes data via useFocusEffect when the screen gains focus', () => {
    const refreshData = jest.fn();
    setupMocks({ actions: { refreshData } });

    renderScreen();

    expect(focusEffectCallback).toBeDefined();
    focusEffectCallback!();
    expect(refreshData).toHaveBeenCalled();
  });

  /** Tests that the loading state is propagated from the ViewModel to JournalList. */
  it('propagates loading state to JournalList', () => {
    setupMocks({ state: { loading: true } });

    const { UNSAFE_root } = renderScreen();

    // Find the RefreshControl and assert it reports refreshing=true.
    const refreshControl = UNSAFE_root.findByProps({ refreshing: true });
    expect(refreshControl).toBeTruthy();
  });
});
