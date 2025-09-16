import React, {createContext, useContext} from 'react';
import type {JournalRepository} from './JournalRepository';

/**
 * React context for providing a JournalRepository instance across the app.
 *
 * We prefer explicit prop passing, but this context allows wiring the
 * repository at the application root without constructing it in leaf
 * components. Components may still accept a `repository` prop and fall
 * back to this context when the prop is not provided.
 */
const RepositoryContext = createContext<JournalRepository | null>(null);

export interface RepositoryProviderProps {
  repository: JournalRepository;
  children: React.ReactNode;
}

/**
 * Provider to supply a concrete JournalRepository instance to descendants.
 */
export function RepositoryProvider({repository, children}: RepositoryProviderProps) {
  return (
    <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>
  );
}

/**
 * Hook to access the repository from context.
 *
 * Throws a clear error if no repository was provided.
 */
export function useRepository(): JournalRepository {
  const repo = useContext(RepositoryContext);
  if (!repo) {
    throw new Error('JournalRepository not provided. Wrap your app in RepositoryProvider.');
  }
  return repo;
}
