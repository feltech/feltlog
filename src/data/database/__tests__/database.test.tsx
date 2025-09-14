import {render, waitFor} from '@testing-library/react-native';
import DatabaseTestComponent from '../__mocks__/DatabaseTestComponent';

describe('Database Initialization', () => {
  it('should initialize the database without errors', async () => {
    const {getByText} = render(<DatabaseTestComponent encryptionKey="test-key"/>);
    await waitFor(() => expect(getByText('Database initialized')).toBeTruthy(), { timeout: 5000 });
  });

  it('should initialize the database without encryption key', async () => {
    const {getByText} = render(<DatabaseTestComponent />);
    await waitFor(() => expect(getByText('Database initialized')).toBeTruthy(), { timeout: 5000 });
  });
});
