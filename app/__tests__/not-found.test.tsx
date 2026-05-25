import React from 'react';
import { render } from '@testing-library/react-native';

/** Mock expo-router components used by NotFoundScreen. */
jest.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options: { title: string } }) => <>{options.title}</>,
  },
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import NotFoundScreen from '@/app/+not-found';

/**
 * Test suite for the NotFoundScreen component. Verifies that the 404 screen renders
 * correctly and displays the expected message and navigation link.
 */
describe('NotFoundScreen', () => {
  /** Tests that the component renders without crashing. */
  it('renders without crashing', () => {
    const { toJSON } = render(<NotFoundScreen />);
    expect(toJSON()).toBeTruthy();
  });

  /** Tests that the not found message is displayed. */
  it('displays a not found message', () => {
    const { getByText } = render(<NotFoundScreen />);
    expect(getByText("This screen doesn't exist.")).toBeTruthy();
  });

  /** Tests that the home screen link is displayed. */
  it('displays a link to the home screen', () => {
    const { getByText } = render(<NotFoundScreen />);
    expect(getByText('Go to home screen!')).toBeTruthy();
  });
});
