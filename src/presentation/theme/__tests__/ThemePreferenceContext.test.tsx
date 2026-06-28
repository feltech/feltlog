import React from 'react';
import { Text, Button } from 'react-native';
import { render, act, fireEvent } from '@testing-library/react-native';
import { ThemePreferenceProvider, useThemePreference } from '../ThemePreferenceContext';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Mock dbThemeStorage to control persistence behavior. */
jest.mock('@/src/data/database/dbThemeStorage', () => ({
  getThemeMode: jest.fn(),
  setThemeMode: jest.fn(),
}));

import { getThemeMode, setThemeMode } from '@/src/data/database/dbThemeStorage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A test component that consumes the theme preference context.
 *
 * @returns The rendered test consumer.
 */
function TestConsumer() {
  const { themeMode, setThemeMode: setMode } = useThemePreference();
  return (
    <React.Fragment>
      <Text testID="theme-mode">{themeMode}</Text>
      <Button testID="set-light" title="Set Light" onPress={() => setMode('light')} />
      <Button testID="set-dark" title="Set Dark" onPress={() => setMode('dark')} />
      <Button testID="set-auto" title="Set Auto" onPress={() => setMode('auto')} />
    </React.Fragment>
  );
}

/**
 * Renders the test consumer inside a ThemePreferenceProvider.
 *
 * @returns The render result from testing-library.
 */
function renderWithProvider() {
  return render(
    <ThemePreferenceProvider>
      <TestConsumer />
    </ThemePreferenceProvider>,
  );
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ThemePreferenceContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getThemeMode as jest.Mock).mockResolvedValue('auto');
    (setThemeMode as jest.Mock).mockResolvedValue(undefined);
  });

  /** Tests that provider initializes with 'auto' by default. */
  it('initializes with "auto" by default', async () => {
    (getThemeMode as jest.Mock).mockResolvedValue('auto');
    const { getByTestId } = renderWithProvider();

    await act(async () => {
      await Promise.resolve();
    });

    expect(getByTestId('theme-mode').props.children).toBe('auto');
  });

  /** Tests that provider loads persisted theme mode. */
  it('loads persisted theme mode from storage', async () => {
    (getThemeMode as jest.Mock).mockResolvedValue('dark');
    const { getByTestId } = renderWithProvider();

    await act(async () => {
      await Promise.resolve();
    });

    expect(getByTestId('theme-mode').props.children).toBe('dark');
  });

  /** Tests that useThemePreference returns current value. */
  it('returns current themeMode and setThemeMode function', async () => {
    const { getByTestId } = renderWithProvider();

    await act(async () => {
      await Promise.resolve();
    });

    expect(getByTestId('theme-mode').props.children).toBe('auto');
    expect(getByTestId('set-light')).toBeTruthy();
    expect(getByTestId('set-dark')).toBeTruthy();
    expect(getByTestId('set-auto')).toBeTruthy();
  });

  /** Tests that setThemeMode updates value and persists. */
  it('updates themeMode and calls setThemeMode on storage', async () => {
    const { getByTestId } = renderWithProvider();

    await act(async () => {
      await Promise.resolve();
    });

    expect(getByTestId('theme-mode').props.children).toBe('auto');

    // Press "Set Dark" button
    await act(async () => {
      fireEvent.press(getByTestId('set-dark'));
      await Promise.resolve();
    });

    expect(setThemeMode).toHaveBeenCalledWith('dark');
    expect(getByTestId('theme-mode').props.children).toBe('dark');
  });

  /** Tests that multiple consumers see the same value. */
  it('multiple consumers see the same themeMode', async () => {
    /**
     * Renders a single consumer with the given id.
     *
     * @param props - Component props.
     * @param props.id - Unique identifier for this consumer.
     *
     * @returns The rendered consumer text.
     */
    function MultiConsumer({ id }: { id: string }) {
      const { themeMode } = useThemePreference();
      return <Text testID={`mode-${id}`}>{themeMode}</Text>;
    }

    /**
     * Wraps two MultiConsumer instances in a provider.
     *
     * @returns The rendered wrapper.
     */
    function MultiConsumerWrapper() {
      return (
        <ThemePreferenceProvider>
          <MultiConsumer id="1" />
          <MultiConsumer id="2" />
        </ThemePreferenceProvider>
      );
    }

    (getThemeMode as jest.Mock).mockResolvedValue('light');
    const { getByTestId } = render(<MultiConsumerWrapper />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(getByTestId('mode-1').props.children).toBe('light');
    expect(getByTestId('mode-2').props.children).toBe('light');
  });

  /** Tests that useThemePreference throws without provider. */
  it('throws when used outside provider', () => {
    /**
     * A component that uses the hook without a provider.
     *
     * @returns Should not render.
     */
    function NoProvider() {
      useThemePreference();
      return <Text>Should not render</Text>;
    }

    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<NoProvider />);
    }).toThrow('useThemePreference must be used within a ThemePreferenceProvider');

    consoleError.mockRestore();
  });

  /** Unmounting before the persisted mode loads does not update state. */
  it('handles unmount before persisted theme mode loads', async () => {
    let resolveGetThemeMode: (value: string) => void;
    (getThemeMode as jest.Mock).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveGetThemeMode = resolve;
        }),
    );

    const { unmount } = renderWithProvider();
    expect(unmount).toBeInstanceOf(Function);
    unmount();

    // Resolve the deferred promise after unmount; the cleanup should prevent a
    // state update on the unmounted component.
    await act(async () => {
      resolveGetThemeMode!('dark');
      await Promise.resolve();
    });
  });
});
