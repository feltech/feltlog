# FeltLog Development Guidelines

## Project Overview

FeltLog is an Android diary/journal application built with React Native (Expo) and TypeScript,
following domain-driven design principles at the high level and data-oriented design at the lower
level.

## Development Environment

### Core Tools

- NixOS development environment with Direnv auto-activation via `.envrc`
- WebStorm IDE (though terminal-based development should be supported)
- Android Emulator with x86_64 images (API 35)
- Node.js (stable version)
- React Native via Expo (SDK 53)

### Development Shell

- Nix Flake for reproducible development environment in `build_env/` directory
- Minimal system dependencies, focused on Android development needs
- All shell commands must be prefixed with: `nix develop ./build_env --command` in order to execute
  in the correct environment.
- Shell provides: `nodejs`, `openjdk`, `gh`, `maestro`, `watchman`, `jq`, `python3`, `create-avd`
  helper

### Running tests

- Unit tests are via jest and can be run using `npm test`
- e2e tests are via android emulator and maestro.
- To run e2e tests:
  1. Restart ADB (if in a bad state):
     `nix develop ./build_env --command adb kill-server && nix develop ./build_env --command adb start-server`
  2. Start the emulator via Maestro:
     `nix develop ./build_env --command maestro start-device --platform \`
     `android --device-model "pixel_6" --device-os android-35`
  3. Build and install the app in a **separate terminal** (Metro bundler runs indefinitely — it
     does not exit after the build): `nix develop ./build_env --command npm run android` Wait for
     "BUILD SUCCESSFUL" and the app to appear on the emulator before proceeding. The Metro process
     must remain running for the app to function.
  4. Run the tests in another terminal: `nix develop ./build_env --command npm run e2e` or
     `nix develop ./build_env --command maestro test e2e/`

## Technology Stack

### Frontend

- React Native with TypeScript (strict mode), Expo SDK 53
- Expo Router v5 (file-based routing with `app/` directory, typed routes enabled)
- React Native Paper (Material Design 3 UI components)
- MVVM architecture pattern
- Hermes JS engine (Android), React Native New Architecture enabled

### Maps

- Maplibre GL Native for map display on the entry creation/edit screen
- OpenStreetMap reverse geocoding via `expo-location` (no API key required)

### Database

- Encrypted expo-sqlite (SQLCipher via `useSQLCipher: true` in app.json) for production and e2e
  tests; shimmed via `expo-sqlite-mock` for Node.js unit tests
- Kysely query builder with `kysely-expo` dialect adapter
- UUID generation via `uuid` + `react-native-get-random-values`

Tables:

- `journal_entries`: id, content, datetime, created_at, modified_at, location columns (inline)
- `tags`: id, name (unique), created_at
- `journal_entry_tags`: entry_id, tag_id (composite PK, cascading deletes)

Domain `JournalEntry` interface uses `Date` objects, but persistence uses ISO 8601 strings. Tags
use a many-to-many relationship via the junction table. No explicit indices.

### Database Migrations

- Migrations use Kysely's built-in `Migrator` class with a custom `InMemoryMigrationProvider`
  (since React Native cannot use Kysely's `FileMigrationProvider` which requires Node.js
  `fs`/`path`).
- Migration files live in `src/data/database/migrations/` and export `up(db: Kysely<any>)` and
  `down(db: Kysely<any>)` functions.
- Migration naming convention: `YYYYMMDD_sequence_description.ts` (e.g.,
  `20260523_one_create_initial_tables.ts`). The date prefix ensures alphabetical sort matches
  chronological order.
- The migration registry in `src/data/database/migrations/index.ts` must be updated when adding new
  migrations — import the new module and add it to the `MIGRATIONS` record.
- Never delete or rename migration files/keys that have already been shipped.
- Kysely tracks executed migrations in `kysely_migration` and `kysely_migration_lock` internal
  tables.
- Initial data population (seeding) should be done within the first migration or a dedicated early
  migration — not via a separate mechanism.
- To generate a new migration stub: `npx kysely migrate make <descriptive_name>`. This creates a
  file in `src/data/database/migrations/` with the correct timestamp prefix. After generating, you
  must also register it in `index.ts`.
- The `kysely-ctl` CLI is a dev-time tool only. At runtime, the app uses the
  `InMemoryMigrationProvider` to serve migrations to Kysely's `Migrator`.

### Testing

- `jest` with `jest-expo` preset (configured in `package.json`)
- `expo-sqlite-mock` shims SQLite for Node.js unit tests
- `@testing-library/react-native` for component testing
- `jest.setup.js` mocks Maplibre, expo-location, markdown renderer for all tests

## Architecture Overview

### Design Patterns

- Data-oriented design at lower level
- Repository pattern for data access abstraction
- Context-based dependency injection (no singletons)

### Application Layers

- **Domain layer** (`src/domain/`): entities (`JournalEntry`, `Tag`, `Location`), repository
  interface (`JournalRepository`), React context for DI (`RepositoryContext`)
- **Data layer** (`src/data/`): Kysely-backed `JournalRepositoryImpl`, database bootstrap and
  migrations, AsyncStorage helper for DB name persistence
- **Presentation layer** (`src/presentation/`): ViewModel hook (`useJournalViewModel`), UI
  components (`JournalList`, `JournalEntryCard`, `SetupDatabaseScreen`), theming
- **App layer** (`app/`): Expo Router screens (root `_layout`, tabs, modal), file-based routing

### Key Files

| File                                                | Purpose                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `app/_layout.tsx`                                   | Root layout: loads fonts, initializes DB, provides Repository + Paper + Theme |
| `app/(tabs)/_layout.tsx`                            | Tab navigator (Journal, Settings)                                             |
| `app/(tabs)/index.tsx`                              | Journal list screen with FAB and Snackbar errors                              |
| `app/modal.tsx`                                     | Create/edit entry modal with autosave, undo/redo, tags, location              |
| `src/domain/entities/JournalEntry.ts`               | Domain interfaces: JournalEntry, Location, Tag, JournalEntryTag               |
| `src/domain/repositories/JournalRepository.ts`      | Repository interface (12 methods)                                             |
| `src/domain/repositories/RepositoryContext.tsx`     | React context providing JournalRepository via DI                              |
| `src/data/database/schema.ts`                       | Kysely table type definitions                                                 |
| `src/data/database/migrations/index.ts`             | Migration registry + InMemoryMigrationProvider export                         |
| `src/data/database/migrations/migrationProvider.ts` | InMemoryMigrationProvider (replaces FileMigrationProvider for RN)             |
| `src/data/database/migrations/*.ts`                 | Individual migration files (up/down with `Kysely<any>`)                       |
| `src/data/database/database.ts`                     | `openKysely()`, `useDatabase()` React hook, Migrator setup                    |
| `src/data/repositories/JournalRepositoryImpl.ts`    | Kysely-backed repository implementation                                       |
| `src/presentation/viewmodels/JournalViewModel.ts`   | Core MVVM hook: state + actions                                               |
| `build_env/flake.nix`                               | Nix dev shell with Android SDK, Maestro, Node                                 |

## Code Quality

### TypeScript Configuration

- Strict mode enabled, extends `expo/tsconfig.base`
- Path alias `@/*` maps to project root
- Includes `.expo/types/` for typed route auto-generation

### Linting and Formatting

- ESLint with `@typescript-eslint`, `react`, `react-hooks`, `jsdoc`, `jest`, `prettier` plugins
- Prettier with `prettier-plugin-jsdoc`
- 99 character line limit for code (`printWidth: 99`)
- 88 character line limit for JSDoc comments (`jsdocPrintWidth: 88`)
- Markdownlint for markdown files (99 char limit for prose)

- `.eslintrc.js`, `.prettierrc.js`, `babel.config.js`, and `jest.setup.js` use CommonJS (required
  by these tools at the project root). All application source code under `src/` and `app/` uses ES
  modules.

#### Commands

Pre-commit hooks are managed by husky + lint-staged, which run automatically on `git commit`. The
hooks run ESLint fix, Prettier format, and markdownlint on staged files, followed by a full
typecheck and a large file (>1MB) check. Husky hooks are installed via the `prepare` script in
`package.json`, which runs automatically on `npm install`.

Run these checks manually after every substantial change:

- **Linting:** `nix develop ./build_env --command npm run lint` (includes TypeScript type checking
  via `tsc --noEmit` before ESLint)
- **Type checking (standalone):** `nix develop ./build_env --command npm run typecheck`
- **Formatting:** `nix develop ./build_env --command npm run format`
- **Format check (no write):** `nix develop ./build_env --command npm run format:check`
- **Markdown Linting:** `nix develop ./build_env --command npm run lint:md`
- **Combined Check:**
  `nix develop ./build_env --command bash -c "npm run format && npm run lint && npm run lint:md"`

Use `npm run lint:fix` to automatically fix some linting issues.

### Comment formatting

- 88 character line limit for comments
- 99 character line limit for markdown
- Javadoc style docstrings.
- Newlines separating summary, description body, and parameters in docstrings.
- End parameter and return descriptions with a period.

### Test conventions

- Unit tests alongside source files in `__tests__/` directories
- Integration tests in `e2e/` directory using Maestro
- `e2e/subflows/` contains reusable Maestro flow snippets
- No specific coverage threshold
- Tests must run on both:
  - Node.js environment (unit tests)
  - Android Emulator (integration tests)
- When reading terminal output, ignore the expected error
  > bash: history: : cannot create: No such file or directory
- Add `takeScreenshot` commands to the maestro e2e tests as necessary to aid diagnosis of errors.
- When running e2e tests, additional logs from the expo dev server can be found in `android.log` to
  aid diagnostics.
- Do NOT "fix" tests by marking them as skipped to get the unit tests to pass — actually fix the
  tests or the code, or, if necessary, remove the tests if they are no longer relevant.

## Coding guidelines

- Do NOT modify files in `node_modules/`.
- Use as few mocks as possible when testing. Especially avoid global mocks that affect every test.
  Try to fix the configuration of the project before resorting to mocking.
- Read the stack trace of error messages and check the code in the last couple of mentioned files
  to better understand the reason for the error.
- Use ES modules in all application source code (`src/`, `app/`).
- Do not make git commits, the user will do that.
- Add plenty of code comments, especially around conditionals.
- All non-trivial functions must have docstrings.
- All classes and interfaces must have docstrings.
- Avoid the use of singletons, prefer dependency injection or contexts.
- Keep transactions minimal in Expo SQLite (avoid complex multi-table transactions).

## Core Features

### Journal Entry Management

- Markdown support for content (basic formatting via `react-native-markdown-renderer`)
- Autosave during editing
- Undo/redo within editing session (history stack maintained in `app/modal.tsx`)
- Location capture on entry creation with Maplibre map display
  - Manual location updates via menu
  - Elevation data from location services
  - OpenStreetMap reverse geocoding via `expo-location`
- Tag support
  - Free-form tags
  - Autocomplete from existing tags
  - Default to last used tags for new entries
- Pagination via FlatList `onEndReached`
  - Batch size: 10 entries

### Storage

- Database created in Expo's default location with user-provided filename
- DB filename remembered in AsyncStorage for convenience
- Optional SQLCipher encryption key (entered on setup, never persisted)

### Search Functionality

- Text search within journal entries (repository-level `searchEntries`)
- Tag-based filtering (`getEntriesByTags`)
- No location-based search in initial version

### Error Handling

- Snackbar at screen bottom for transient error messages
- Status messages auto-dismiss after 3 seconds (configurable)
- No dedicated error; error state from ViewModel shown in `JournalList` empty state and via
  `Snackbar` in the journal screen

### Location Features

- Capture on entry creation
- Manual update option in entry menu
- Device location permission management with user warnings
- Graceful degradation on permission denial
- OpenStreetMap-based geocoding via `expo-location.reverseGeocodeAsync()`

### UI/UX

- System locale-based formatting for dates and times
- React Native Paper FAB for create-entry action
- Pull-to-refresh on journal list
- Tab-based navigation (Journal, Settings)

## Non-Requirements (First Version)

- Cloud sync
- Media attachments
- Templates
- Statistics
- Notifications
- Automatic theme switching (light/dark toggle only)
- Mood tracking
- Tag hierarchies
- Tag suggestions
- Location-based search
- Database indices or query optimization
- Automatic backups
- Import/export database via Storage Access Framework

## Build and Deployment

- Focus on Android platform initially (iOS scaffold present)
- Expo EAS Build for APK generation
- Pre-commit hooks managed by husky + lint-staged (runs ESLint fix, Prettier format, and
  markdownlint on staged files, plus typecheck and large file check)

## Dependencies

- Prefer established open-source packages
- Liberal licensing required
- Key packages:
  - Expo (SDK 53) with Expo Router, expo-sqlite, expo-location
  - React Native Paper (UI components)
  - Kysely + kysely-expo (query builder)
  - Maplibre GL Native (map rendering)
  - uuid + react-native-get-random-values (ID generation)

## Security Considerations

- SQLCipher encryption on database (user-provided key via setup screen, never persisted)
- No network requests or data sharing (fully local)
- DB filename cached in AsyncStorage for UX; encryption key never stored
- Permissions requested only when needed (location)
- Clear user feedback on permission requirements

## Performance Considerations

- Paginated FlatList with `hasMore`/`loadingMore` state (batch size: 10)
- Kysely queries join/aggregate tags in a single round-trip per page
- Autosave with debounce
- Virtualized list via FlatList for smooth scrolling

## Future Expansion Areas

- Cross-platform support (iOS scaffold exists)
- Media attachments
- Cloud sync options
- Advanced search features
- Performance optimizations (indices, query tuning)
- Database migration versioning
- Import/export via Storage Access Framework
- Settings screen (tab route exists but screen file is missing)
