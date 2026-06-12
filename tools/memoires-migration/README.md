# Memoires-to-FeltLog Migration Tool

A one-shot Node.js/TypeScript script that reads an old **Memoires** Android SQLite diary database
and produces a ready-to-use **FeltLog SQLite database file**.

## What it does

1. Opens the source SQLite database in **read-only** mode.
2. Reads every row from the `memo` and `tag` tables.
3. Converts each memo into a FeltLog `JournalEntry`:
   - HTML notes are converted to Markdown via `turndown`.
   - Remaining HTML entities are decoded via `entities`.
   - Nested anchor tags are normalised before turndown runs (see `html-converter.ts`).
   - A known decryption-error placeholder is replaced with a human-readable explanation.
   - Java-serialized address blobs are parsed to extract latitude/longitude.

   > **Why no H1 header?** Memoires stored `header` as an auto-generated list preview — it is
   > always a fragment of the `note`, never a separate title. Prepending it would duplicate text in
   > ~99 % of entries, so the header is ignored and only the converted `note` is used for content.

4. Generates deterministic UUIDv5 IDs for entries and tags.
5. Detects a bulk-update sentinel in the `modified` column and falls back to the row's `created`
   timestamp for those rows.
6. Writes a **plaintext SQLite database** (`*.db3.migrated`) containing:
   - The three FeltLog domain tables (`tags`, `journal_entries`, `journal_entry_tags`).
   - Kysely's internal migration tracking tables (`kysely_migration`, `kysely_migration_lock`) with
     a row claiming the initial migration is already applied.
   - This lets the FeltLog app open the file with `Migrator.migrateToLatest()` without re-running
     `CREATE TABLE` statements that would fail because the tables already exist.

## Idempotency

Re-running the migration is safe: deterministic UUIDv5 IDs and a fixed timestamp for the
`kysely_migration` row mean the output will be byte-identical across runs with the same source DB.

## Running

```bash
cd tools/memoires-migration
npm install
npm run migrate
```

### CLI options

| Option     | Default                                                     |
| ---------- | ----------------------------------------------------------- |
| `--source` | `/home/dave/workspace/feltlog/memoires_backup/memories.db3` |
| `--output` | Derived from `--source` (see below)                         |

**Default output derivation:**

- If the source path ends with `.db3`, the output is `<source>.db3.migrated`.
- Otherwise, the output is `<source>.migrated`.

Examples:

| Source             | Default output              |
| ------------------ | --------------------------- |
| `memories.db3`     | `memories.db3.migrated`     |
| `/path/to/foo.db3` | `/path/to/foo.db3.migrated` |
| `bar`              | `bar.migrated`              |

```bash
npm run migrate -- --source /path/to/memories.db3 --output /path/to/out.db3.migrated
```

## Output file

The produced file is a standard SQLite 3 database. You can inspect it with the `sqlite3` CLI:

```bash
sqlite3 memoires_backup/memories.db3.migrated ".schema"
sqlite3 memoires_backup/memories.db3.migrated "SELECT COUNT(*) FROM journal_entries"
sqlite3 memoires_backup/memories.db3.migrated "SELECT COUNT(*) FROM tags"
sqlite3 memoires_backup/memories.db3.migrated "SELECT COUNT(*) FROM journal_entry_tags"
sqlite3 memoires_backup/memories.db3.migrated "PRAGMA foreign_key_check"
sqlite3 memoires_backup/memories.db3.migrated "PRAGMA integrity_check"
sqlite3 memoires_backup/memories.db3.migrated "SELECT * FROM kysely_migration"
```

The file is ready to be copied to an Android device and consumed by the FeltLog app's future
"Restore from backup" feature. It is **plaintext** (no SQLCipher encryption) — encryption can be
applied later by the app if desired.

## Assumptions & limitations

- The source DB is a Memoires plaintext SQLite file (not encrypted).
- Tags are looked up by exact string match. Tags that exist in `memo.tags` but not in the `tag`
  table are silently skipped.
- The `address` column is a hex-encoded Java ObjectOutputStream. The parser uses a pattern-matching
  shortcut that was validated against every blob in the source dataset. **This parser is tuned to a
  specific Java serialization format;** running it against blobs produced by a different Java
  version may produce incorrect coordinates. Re-validate against known samples when re-using.
- `modified` timestamps that appear in > 50 % of rows are treated as a bulk update sentinel and
  replaced with the row's `created` value.
- Only the `memo` and `tag` tables are migrated. Attachments, weather, people, and other Memoires
  features are ignored.
- The output DB includes Kysely internal tables (`kysely_migration`, `kysely_migration_lock`)
  because FeltLog's `Migrator.migrateToLatest()` uses bare `CREATE TABLE` statements without
  `IF NOT EXISTS`. If these internal rows were missing, the app would fail with "table already
  exists" on first open.

## Development

```bash
npm test                # unit tests
npm run test:coverage   # coverage report (≥ 90 % required)
npm run typecheck       # TypeScript strict check
npm run lint            # ESLint + Prettier
npm run format          # auto-format
```

## License

Same as the parent FeltLog project.
