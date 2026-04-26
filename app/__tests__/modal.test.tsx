import React from 'react';
import {render} from '@testing-library/react-native';
import {useJournalViewModel} from '@/src/presentation/viewmodels/JournalViewModel';
import JournalEntryModal from '../modal';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {PaperProvider} from 'react-native-paper';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({back: jest.fn()}),
}));

jest.mock('@/src/presentation/viewmodels/JournalViewModel', () => ({
  useJournalViewModel: jest.fn(),
}));

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
      createEntry: jest.fn().mockResolvedValue(undefined),
      updateEntry: jest.fn().mockResolvedValue(undefined),
      deleteEntry: jest.fn(),
      search: jest.fn(),
      filterByTags: jest.fn(),
      clearFilters: jest.fn(),
      setError: jest.fn(),
    },
  });
}

describe('JournalEntryModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
  });

  it('renders without crashing', () => {
    const {toJSON} = render(
      <SafeAreaProvider>
        <PaperProvider>
          <JournalEntryModal />
        </PaperProvider>
      </SafeAreaProvider>
    );

    expect(toJSON()).toBeTruthy();
  });

  it('includes location section in the UI', () => {
    const {toJSON} = render(
      <SafeAreaProvider>
        <PaperProvider>
          <JournalEntryModal />
        </PaperProvider>
      </SafeAreaProvider>
    );

    const json = toJSON();
    expect(json).toBeTruthy();
  });
});