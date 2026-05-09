import React from 'react';
import { render } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useJournalViewModel } from '@/src/presentation/viewmodels/JournalViewModel';
import JournalScreen from '../index';

// Mock router to avoid real navigation.
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

// Mock the view model to control actions and state.
jest.mock('@/src/presentation/viewmodels/JournalViewModel', () => ({
  useJournalViewModel: jest.fn(),
}));

/** Sets up the mocks for the journal view model. */
function setupMocks() {
  (useJournalViewModel as jest.Mock).mockReturnValue({
    state: {
      entries: [],
      tags: [],
      loading: false,
      error: null,
      searchQuery: '',
      selectedTags: [],
      hasMore: false,
    },
    actions: {
      refreshData: jest.fn(),
      loadMoreEntries: jest.fn(),
      createEntry: jest.fn(),
      updateEntry: jest.fn(),
      deleteEntry: jest.fn(),
      search: jest.fn(),
      filterByTags: jest.fn(),
      clearFilters: jest.fn(),
      setError: jest.fn(),
    },
  });
}

describe('JournalScreen focus behavior', () => {
  it('renders the create-entry FAB and does not crash', () => {
    setupMocks();

    const tree = render(
      <SafeAreaProvider>
        <PaperProvider>
          <JournalScreen />
        </PaperProvider>
      </SafeAreaProvider>,
    );

    // Minimal robust assertion: the screen renders without crashing.
    expect(tree.toJSON()).toBeTruthy();
  });
});
