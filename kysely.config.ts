import { defineConfig, DUMMY_DIALECT_CONFIG } from 'kysely-ctl';

// FeltLog uses expo-sqlite at runtime with a custom InMemoryMigrationProvider.
// This config is for dev-time use only: generating migration file stubs via
// `kysely migrate make <name>`. The dummy dialect satisfies the config
// requirement without needing a real database connection.
export default defineConfig({
  dialect: DUMMY_DIALECT_CONFIG,
  migrations: {
    migrationFolder: 'src/data/database/migrations',
    getMigrationPrefix: () => {
      // ISO 8601 date prefix matching the existing migration naming convention.
      const now = new Date();
      const date = now.toISOString().slice(0, 10).replace(/-/g, '');
      return `${date}_`;
    },
  },
});
