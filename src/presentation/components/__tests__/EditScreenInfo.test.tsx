import React from 'react';
import { render } from '@testing-library/react-native';

/** Mock ExternalLink to avoid expo-web-browser dependency in tests. */
jest.mock('@/src/presentation/components/ExternalLink', () => ({
  ExternalLink: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import EditScreenInfo from '../EditScreenInfo';

/**
 * Test suite for the EditScreenInfo component. Verifies rendering and interaction
 * elements such as links and text content.
 */
describe('EditScreenInfo', () => {
  /** Tests that the component renders without crashing. */
  it('renders without crashing', () => {
    const { toJSON } = render(<EditScreenInfo path="app/index.tsx" />);
    expect(toJSON()).toBeTruthy();
  });

  /** Tests that the component displays the provided path. */
  it('displays the provided path', () => {
    const { getByText } = render(<EditScreenInfo path="app/test.tsx" />);
    expect(getByText('app/test.tsx')).toBeTruthy();
  });

  /** Tests that the instructional text is rendered. */
  it('renders instructional text', () => {
    const { getByText } = render(<EditScreenInfo path="app/index.tsx" />);
    expect(getByText('Open up the code for this screen:')).toBeTruthy();
  });

  /** Tests that the help link text is rendered. */
  it('renders the help link text', () => {
    const { getByText } = render(<EditScreenInfo path="app/index.tsx" />);
    expect(
      getByText("Tap here if your app doesn't automatically update after making changes"),
    ).toBeTruthy();
  });

  /** Tests that the update hint text is rendered. */
  it('renders the update hint text', () => {
    const { getByText } = render(<EditScreenInfo path="app/index.tsx" />);
    expect(
      getByText(
        'Change any of the text, save the file, and your app will automatically update!!!',
      ),
    ).toBeTruthy();
  });
});
