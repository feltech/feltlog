import {render, waitFor} from '@testing-library/react-native';
import DatabaseTestComponent from '../__mocks__/DatabaseTestComponent';
import { DatabaseInitializer } from '@/src/infrastructure/database/DatabaseInitializer';
import { DatabaseConnection } from '@/src/data/database/connection';

describe('Database Initialization', () => {
  beforeEach(async () => {
    // Reset database state before each test
    DatabaseInitializer.reset();
  });

  afterEach(async () => {
    const dbConnection = DatabaseConnection.getInstance();
    try {
      await dbConnection.close();
    } catch (error) {
      // Ignore close errors in tests
    }
    DatabaseInitializer.reset();
  });

  it('should initialize the database without errors', async () => {
    const {getByText} = render(<DatabaseTestComponent encryptionKey="test-key"/>);
    await waitFor(() => expect(getByText('Database initialized')).toBeTruthy(), { timeout: 5000 });
  });

  it('should initialize the database without encryption key', async () => {
    const {getByText} = render(<DatabaseTestComponent />);
    await waitFor(() => expect(getByText('Database initialized')).toBeTruthy(), { timeout: 5000 });
  });
});
