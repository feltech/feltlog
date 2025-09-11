import {
  DatabaseConnection,
  DatabaseIntrospector,
  Dialect,
  DialectAdapter,
  Driver,
  Kysely,
  QueryCompiler,
  QueryResult,
  SelectQueryBuilder,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  TransactionSettings,
} from 'kysely';
import * as SQLite from 'expo-sqlite';

export interface ExpoSQLiteDialectConfig {
  database: SQLite.SQLiteDatabase;
}

class ExpoSQLiteDriver implements Driver {
  private config: ExpoSQLiteDialectConfig;

  constructor(config: ExpoSQLiteDialectConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    // Database is already opened in the config
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new ExpoSQLiteConnection(this.config.database);
  }

  async beginTransaction(
    connection: DatabaseConnection,
    settings: TransactionSettings
  ): Promise<void> {
    await connection.executeQuery({ sql: 'BEGIN', parameters: [] });
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery({ sql: 'COMMIT', parameters: [] });
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery({ sql: 'ROLLBACK', parameters: [] });
  }

  async releaseConnection(): Promise<void> {
    // Expo SQLite handles connection pooling
  }

  async destroy(): Promise<void> {
    // Connection will be closed when the database is closed
  }
}

class ExpoSQLiteConnection implements DatabaseConnection {
  private database: SQLite.SQLiteDatabase;

  constructor(database: SQLite.SQLiteDatabase) {
    this.database = database;
  }

  async executeQuery<O>(compiledQuery: {
    sql: string;
    parameters: readonly unknown[];
  }): Promise<QueryResult<O>> {
    try {
      const sql = compiledQuery.sql.trim();
      const upper = sql.toUpperCase();

      if (upper.startsWith('SELECT') || upper.startsWith('PRAGMA')) {
        // Read query: use getAllAsync to fetch rows.
        const rows = await this.database.getAllAsync(sql, compiledQuery.parameters as any[]);
        return {
          rows: rows as O[],
          numChangedRows: undefined,
          insertId: undefined,
        };
      } else {
        // Write query (INSERT/UPDATE/DELETE/DDL): use runAsync so the statement executes reliably.
        await this.database.runAsync(sql, ...(compiledQuery.parameters as any[]));
        // Then get changes and last insert id.
        const changes = await this.database.getAllAsync(
          'SELECT changes() as changes, last_insert_rowid() as lastInsertRowid'
        );
        return {
          rows: [] as unknown as O[],
          numChangedRows: changes[0]?.changes || 0,
          insertId: changes[0]?.lastInsertRowid || undefined,
        };
      }
    } catch (error) {
      throw error;
    }
  }

  streamQuery(): never {
    throw new Error('Streaming not supported by Expo SQLite');
  }
}

export class ExpoSQLiteDialect implements Dialect {
  private config: ExpoSQLiteDialectConfig;

  constructor(config: ExpoSQLiteDialectConfig) {
    this.config = config;
  }

  createDriver(): Driver {
    return new ExpoSQLiteDriver(this.config);
  }

  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }

  createAdapter(): DialectAdapter {
    return new SqliteAdapter();
  }

  createIntrospector(db: Kysely<any>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }
}
