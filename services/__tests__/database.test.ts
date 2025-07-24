import { initDatabase } from '../database';

describe('Database Initialization', () => {
  it('should initialize the database without errors', async () => {
    await expect(initDatabase('test-key')).resolves.not.toThrow();
  });
});
