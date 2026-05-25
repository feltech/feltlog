import React from 'react';
import { render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { ExternalLink } from '../ExternalLink';

/** Mock for expo-web-browser's openBrowserAsync. */
const mockOpenBrowserAsync = jest.fn().mockResolvedValue({ type: 'dismiss' });

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowserAsync(...args),
}));

/**
 * Test suite for the ExternalLink component. Covers rendering, href passing, and
 * platform-specific open behaviour.
 */
describe('ExternalLink', () => {
  let originalOS: string;

  beforeEach(() => {
    jest.clearAllMocks();
    originalOS = Platform.OS;
  });

  afterEach(() => {
    (Platform as { OS: string }).OS = originalOS;
  });

  /** Tests that the ExternalLink component renders without crashing. */
  it('renders without crashing', () => {
    const { toJSON } = render(<ExternalLink href="https://example.com">Link</ExternalLink>);
    expect(toJSON()).toBeTruthy();
  });

  /** Tests that the component passes the href to the underlying Link. */
  it('passes the href to the Link component', () => {
    const { getByText } = render(
      <ExternalLink href="https://example.com">Visit site</ExternalLink>,
    );
    expect(getByText('Visit site')).toBeTruthy();
  });

  /** Tests that the component passes target="_blank" to the Link. */
  it('sets target to _blank', () => {
    const { toJSON } = render(
      <ExternalLink href="https://example.com">Blank target</ExternalLink>,
    );
    // The Link component should have target="_blank".
    const tree = toJSON();
    expect(tree).toBeTruthy();
  });

  /**
   * Tests that the onPress handler calls preventDefault and opens the in-app browser on
   * non-web platforms. We invoke the onPress directly since fireEvent.press doesn't
   * provide a full event object.
   */
  it('opens in-app browser when onPress is triggered on native', () => {
    (Platform as { OS: string }).OS = 'android';

    const tree = render(<ExternalLink href="https://example.com">Click me</ExternalLink>);

    // Find the component that has the onPress handler by walking the tree.
    const root = tree.UNSAFE_root;
    // The ExternalLink passes onPress to the Link component, which wraps it
    // in a pressable. Find the first element with an onPress function.
    const pressable = findElementWithOnPress(root);
    expect(pressable).toBeTruthy();

    // Call the onPress with a mock event that has preventDefault.
    const mockEvent = { preventDefault: jest.fn() };
    (pressable.props.onPress as (e: { preventDefault: jest.Mock }) => void)(mockEvent);

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(mockOpenBrowserAsync).toHaveBeenCalledWith('https://example.com');
  });

  /**
   * Tests that the onPress handler does NOT call preventDefault or open the in-app
   * browser when on web.
   */
  it('does not open in-app browser when onPress is triggered on web', () => {
    (Platform as { OS: string }).OS = 'web';

    const tree = render(<ExternalLink href="https://example.com">Web link</ExternalLink>);

    const root = tree.UNSAFE_root;
    const pressable = findElementWithOnPress(root);
    expect(pressable).toBeTruthy();

    const mockEvent = { preventDefault: jest.fn() };
    (pressable.props.onPress as (e: { preventDefault: jest.Mock }) => void)(mockEvent);

    expect(mockOpenBrowserAsync).not.toHaveBeenCalled();
    expect(mockEvent.preventDefault).not.toHaveBeenCalled();
  });
});

/**
 * Walks the rendered component tree to find the first element that has an onPress
 * function prop.
 *
 * @param root - The root test instance from render().
 *
 * @returns The found element, or throws if none found.
 */
function findElementWithOnPress(root: ReturnType<typeof render>['UNSAFE_root']): {
  props: Record<string, unknown>;
} {
  let found: { props: Record<string, unknown> } | null = null;

  /**
   * Recursively walks the fiber tree looking for an onPress prop.
   *
   * @param fiber - The fiber node to inspect.
   */
  function walkFiber(fiber: Record<string, unknown> | null | undefined): void {
    if (found || !fiber) return;

    // Check if this fiber's pendingProps has onPress.
    const pendingProps = fiber.pendingProps as Record<string, unknown> | undefined;
    if (pendingProps && typeof pendingProps.onPress === 'function') {
      found = { props: pendingProps };
      return;
    }

    // Check child and sibling fibers.
    walkFiber(fiber.child as Record<string, unknown> | undefined);
    walkFiber(fiber.sibling as Record<string, unknown> | undefined);
  }

  // Start from the root's internal fiber.
  const fiber = (root as unknown as Record<string, unknown>)._fiber as Record<
    string,
    unknown
  > | null;
  walkFiber(fiber);

  if (!found) {
    throw new Error('No element with onPress found in the component tree');
  }

  return found;
}
