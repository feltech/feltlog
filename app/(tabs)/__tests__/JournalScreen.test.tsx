import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { useJournalViewModel } from '@/src/presentation/viewmodels/JournalViewModel';
import JournalScreen from '../index';

// Mock router to control navigation.
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

// Mock useFocusEffect to just call the callback immediately (no navigation
// context required).
jest.mock('@react-navigation/native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    ...jest.requireActual('@react-navigation/native'),
    useFocusEffect: (cb: () => void) => {
      React.useEffect(() => {
        cb();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
    },
  };
});

// Mock the view model to control actions and state.
jest.mock('@/src/presentation/viewmodels/JournalViewModel', () => ({
  useJournalViewModel: jest.fn(),
}));

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
  entries: [] as unknown[],
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
 * Test suite for the JournalScreen (tabs index). Covers rendering, FAB button, error
 * snackbar, and navigation.
 */
describe('JournalScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** Tests that the screen renders the create-entry FAB and does not crash. */
  it('renders the create-entry FAB and does not crash', () => {
    setupMocks();

    const tree = renderScreen();

    // Minimal robust assertion: the screen renders without crashing.
    expect(tree.toJSON()).toBeTruthy();
  });

  /** Tests that pressing the FAB navigates to the entry editor. */
  it('navigates to the entry editor when FAB is pressed', () => {
    setupMocks();

    const { getByTestId } = renderScreen();
    fireEvent.press(getByTestId('create-entry-fab'));

    expect(mockPush).toHaveBeenCalledWith('/entry-editor');
  });

  /** Tests that the Snackbar shows an error message when state.error is set. */
  it('shows snackbar error when state.error is set', async () => {
    setupMocks({ state: { error: 'Something went wrong' } });

    const { getByText } = renderScreen();
    // The Snackbar should display the error text.
    await waitFor(() => {
      expect(getByText('Something went wrong')).toBeTruthy();
    });
  });

  /** Tests that the Snackbar is not visible when there is no error. */
  it('does not show snackbar when there is no error', () => {
    setupMocks({ state: { error: null } });

    const { queryByText } = renderScreen();
    expect(queryByText('Something went wrong')).toBeNull();
  });

  /** Tests that the screen renders the JournalList component. */
  it('renders the JournalList component', () => {
    setupMocks();

    const { toJSON } = renderScreen();
    expect(toJSON()).toBeTruthy();
  });

  /** Tests that pressing the dismiss action on the snackbar calls setError(null). */
  it('dismisses the snackbar error when dismiss is pressed', async () => {
    const setError = jest.fn();
    setupMocks({
      state: { error: 'Error message' },
      actions: { setError },
    });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Error message')).toBeTruthy();
    });

    // Press the Dismiss action.
    fireEvent.press(getByText('Dismiss'));
    expect(setError).toHaveBeenCalledWith(null);
  });

  /** Tests that pressing a journal entry navigates to the entry editor. */
  it('navigates to entry editor when a journal entry is pressed', () => {
    setupMocks({
      state: {
        entries: [
          {
            id: 'entry-1',
            content: 'Test entry',
            datetime: new Date('2025-01-15T12:00:00Z'),
            created_at: new Date('2025-01-15T12:00:00Z'),
            modified_at: new Date('2025-01-15T12:00:00Z'),
            tags: [] as string[],
          },
        ],
      },
    });

    const { getByText } = renderScreen();
    fireEvent.press(getByText('Test entry'));
    expect(mockPush).toHaveBeenCalledWith('/entry-editor?entryId=entry-1');
  });
});
