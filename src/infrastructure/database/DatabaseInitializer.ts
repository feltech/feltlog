import { DatabaseConnection } from '../../data/database/connection';
import { up } from '../../data/database/migrations';

export class DatabaseInitializer {
  private static initialized = false;

  public static async initialize(encryptionKey?: string, databaseName?: string): Promise<void> {
    if (DatabaseInitializer.initialized) {
      return;
    }

    const dbConnection = DatabaseConnection.getInstance();
    const db = await dbConnection.initialize(encryptionKey, databaseName);

    // Run migrations
    await up(db);

    DatabaseInitializer.initialized = true;
  }

  public static isInitialized(): boolean {
    return DatabaseInitializer.initialized;
  }

  public static reset(): void {
    DatabaseInitializer.initialized = false;
  }
}