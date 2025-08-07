import * as SQLite from 'expo-sqlite';
import { Kysely } from 'kysely';
import { Database } from './schema';
import { ExpoSQLiteDialect } from './ExpoSQLiteDialect';

export class DatabaseConnection {
  private static instance: DatabaseConnection;
  private db: Kysely<Database> | null = null;
  private sqliteDb: SQLite.SQLiteDatabase | null = null;

  private constructor() {}

  public static getInstance(): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection();
    }
    return DatabaseConnection.instance;
  }

  public async initialize(encryptionKey?: string, databaseName?: string): Promise<Kysely<Database>> {
    if (this.db) {
      return this.db;
    }

    const dbName = databaseName || 'feltlog.db';
    this.sqliteDb = await SQLite.openDatabaseAsync(dbName);
    
    if (encryptionKey) {
      await this.sqliteDb.execAsync(`PRAGMA key='${encryptionKey}'`);
    }

    this.db = new Kysely<Database>({
      dialect: new ExpoSQLiteDialect({
        database: this.sqliteDb,
      }),
    });

    return this.db;
  }

  public getDb(): Kysely<Database> {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  public async close(): Promise<void> {
    if (this.sqliteDb) {
      await this.sqliteDb.closeAsync();
      this.sqliteDb = null;
    }
    this.db = null;
  }
}