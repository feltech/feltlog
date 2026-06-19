import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { RepositoryProvider, useRepository } from '../RepositoryContext';
import type { JournalRepository } from '../JournalRepository';

/**
 * Test suite for RepositoryContext. Covers the provider rendering, hook returning the
 * injected repository, and the error thrown when no provider is present.
 */
describe('RepositoryContext', () => {
  /**
   * Creates a minimal mock repository for testing.
   *
   * @returns A mock JournalRepository.
   */
  function makeMockRepo(): JournalRepository {
    return {
      createEntry: jest.fn(),
      updateEntry: jest.fn(),
      deleteEntry: jest.fn(),
      getEntry: jest.fn(),
      getAllEntries: jest.fn(),
      searchEntries: jest.fn(),
      getEntriesByTags: jest.fn(),
      getAllTags: jest.fn(),
      createTag: jest.fn(),
      getOrCreateTag: jest.fn(),
      deleteTag: jest.fn(),
      getTagsForEntry: jest.fn(),
      getMostRecentEntryTags: jest.fn(),
    };
  }

  /** Tests that the RepositoryProvider renders its children. */
  it('renders children', () => {
    const mockRepo = makeMockRepo();
    const { getByText } = render(
      <RepositoryProvider repository={mockRepo}>
        <Text>Child content</Text>
      </RepositoryProvider>,
    );
    expect(getByText('Child content')).toBeTruthy();
  });

  /** Tests that useRepository returns the repository provided by the context. */
  it('returns the provided repository via useRepository', () => {
    const mockRepo = makeMockRepo();
    let receivedRepo: JournalRepository | null = null;

    /**
     * Harness component to capture the repository from the hook.
     *
     * @returns Null.
     */
    function Harness() {
      receivedRepo = useRepository();
      return null;
    }

    render(
      <RepositoryProvider repository={mockRepo}>
        <Harness />
      </RepositoryProvider>,
    );

    expect(receivedRepo).toBe(mockRepo);
  });

  /** Tests that useRepository throws when no RepositoryProvider is in the tree. */
  it('throws when useRepository is called outside a RepositoryProvider', () => {
    // Suppress console.error for this expected error.
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    /**
     * Harness component that calls useRepository without a provider.
     *
     * @returns Null.
     */
    function Harness() {
      useRepository();
      return null;
    }

    expect(() => render(<Harness />)).toThrow(/JournalRepository not provided/);

    consoleSpy.mockRestore();
  });
});
