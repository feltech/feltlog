# FeltLog Development Guidelines

## Project Overview

FeltLog is an Android diary/journal application built with React Native (Expo) and TypeScript,
following domain-driven design principles at the high level and data-oriented design at the lower
level.

Code is in constant flux, frequently refactored wih sweeping changes for code quality and
testability in line with common best practices.

## Agent conduct

Agents must never assume they can throw away changes. The user or other agents may be working in
the same codebase, so agents must not run `git checkout`, `git reset`, `git clean`, or otherwise
discard or revert existing working-tree changes unless explicitly instructed by the user.

The user may edit `AGENTS.md`, agent persona instruction files (`.opencode/agents/*.md`), and
opencode configuration (`opencode.json`, anything under `.opencode/`) in parallel to the delegated
task. These edits are the user's own work, not scope creep by the builder. Reviewers and builders
must exclude these files from review findings and from any commit related to the delegated task.
When staging a commit, do not stage changes to `AGENTS.md`, `.opencode/`, or `opencode.json` unless
those files were explicitly part of the task scope.

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
- The shell is auto-activated via Direnv, so commands run directly without any prefix.
- Shell provides: `nodejs`, `openjdk`, `gh`, `maestro`, `watchman`, `jq`, `yq`, `pup`, `python3`.
  sqlite.

### Agent restriction on `build_env/` changes

Agents must **not** automatically modify files in the `build_env/` directory (especially
`flake.nix`, `flake.lock`, or any Nix configuration). Any changes to the build environment —
including adding/removing NDK versions, SDK packages, build tools, or system dependencies — must
first be requested from the user. Only proceed with `build_env/` edits after receiving explicit
user approval.

### Running tests

- Unit tests are via jest. The canonical verification command that builders MUST run after code
  changes is `npm run test:coverage` — this enforces the ≥90% coverage threshold configured in
  `package.json`.
  - Full command: `npm run test:coverage`
- `npm test` runs jest without coverage enforcement; use it only for quick dev iterations, never
  for final verification.
- e2e tests are via android emulator and maestro.
- To run e2e tests:
  1. Restart ADB (if in a bad state): `adb kill-server && adb start-server`
  2. Start the emulator via Maestro: `maestro start-device --platform \`
     `android --device-model "pixel_6" --device-os android-36`
  3. Build and install the app in a **separate terminal** (Metro bundler runs indefinitely — it
     does not exit after the build): `npm run android` Wait for "BUILD SUCCESSFUL" and the app to
     appear on the emulator before proceeding. The Metro process must remain running for the app to
     function.
  4. Run the tests in another terminal: `npm run e2e` or `maestro test e2e/`

## Technology Stack

### Frontend

- React Native with TypeScript (strict mode), Expo SDK (see package.json for version)
- Expo Router (file-based routing with `app/` directory, typed routes enabled)
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
- **App layer** (`app/`): Expo Router screens (root `_layout`, tabs, entry-editor), file-based
  routing

### Key Directories

| Directory                | Purpose                                                   |
| ------------------------ | --------------------------------------------------------- |
| `app/`                   | Expo Router screens and layouts (file-based routing)      |
| `src/domain/`            | Entities, repository interfaces, DI context               |
| `src/data/database/`     | Schema, migrations, Kysely connection, migration provider |
| `src/data/repositories/` | Repository implementations (Kysely-backed)                |
| `src/presentation/`      | ViewModels, UI components, theming                        |
| `build_env/`             | Nix flake for reproducible dev environment                |
| `e2e/`                   | Maestro e2e test flows                                    |

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

- **Linting:** `npm run lint` (includes TypeScript type checking via `tsc --noEmit` before ESLint)
- **Type checking (standalone):** `npm run typecheck`
- **Formatting:** `npm run format`
- **Format check (no write):** `npm run format:check`
- **Markdown Linting:** `npm run lint:md`
- **Combined Check:** `npm run format && npm run lint && npm run lint:md`

Use `npm run lint:fix` to automatically fix some linting issues.

**Before making code edits**, run `npm run format` to ensure all files are formatted according to
the project's Prettier configuration. This prevents agents from wasting iterations on
formatting-only lint failures — Prettier enforces the 99-character line limit for code and
88-character limit for JSDoc comments automatically.

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
- Minimum 90% code coverage enforced via Jest `coverageThreshold` in `package.json`
- Coverage ≥ 90% is a floor, not a ceiling — the coverage report may reveal obvious untested paths
  (uncovered branches, missing error cases) even when thresholds pass. Pursue these quick wins
  proactively rather than stopping at the threshold.
- Run `npm run test:coverage` to generate a coverage report
- Coverage applies to statements, branches, functions, and lines — all must be ≥ 90%
- Files excluded from coverage are listed in `coveragePathIgnorePatterns` in the Jest config (these
  are type-only, platform-specific, or framework boilerplate files)
- Do NOT add files to `coveragePathIgnorePatterns` to bypass writing tests for non-trivial source
  code. The ignore list is for type-only declarations, platform-specific shims, and framework
  boilerplate (e.g., the existing `app/+html.tsx` re-export). It is NOT for hiding components,
  screens, or modules that contain real logic. If a file is large or awkward to test, write the
  tests — don't exclude the file from coverage. A coverage report that hides a 463-line component
  with real logic at "excluded" gives a false sense of completeness; future maintainers will not
  know the file is untested.
- If code is hard to test (e.g., branches in unreachable state paths, Portal-rendered children that
  aren't addressable via testID), prefer refactoring for testability over adding coverage ignores
  or skipping tests. Extract imperative async logic into custom hooks that can be unit-tested in
  isolation with `renderHook`. Keep components as thin presentation layers; move state machines and
  side-effect orchestration into hooks. A component that can't be tested is often a signal that
  it's doing too much.
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

### React `act()` warnings

React `act()` warnings in test output indicate that state updates happened outside of `act()`
scopes — typically because async effects (e.g. fetching data, timers) resolved after the test's
render phase. These warnings are a **code smell** that should be addressed, not suppressed.

**Preferred approach — refactor the test first:**

- Wrap async renders in `await act(async () => { render(...) })` or use a helper like
  `flushEffects()` that processes the microtask queue inside an `act()` scope after the initial
  render.
- Use `waitFor()` or `findBy*` queries to wait for async state changes to settle before making
  assertions.
- When using `jest.useFakeTimers()`, advance timers inside `act()`:
  `await act(async () => { jest.advanceTimersByTime(ms); })`.

**If test refactoring alone doesn't eliminate the warnings, refactor the component:**

- Extract complex async logic from the component into a custom hook or a service that can be more
  easily mocked or tested in isolation.
- Use dependency injection for async operations so tests can provide synchronous fakes.
- Consider splitting large effects into smaller, more testable units.

**Do not** silence `act()` warnings by mocking `console.error` or adding broad `act()` wrappers
that hide real timing issues.

## Coding guidelines

- Do NOT modify files in `node_modules/`.
- Use as few mocks as possible when testing. Especially avoid global mocks that affect every test.
  Try to fix the configuration of the project before resorting to mocking.
- Read the stack trace of error messages and check the code in the last couple of mentioned files
  to better understand the reason for the error.
- Use ES modules in all application source code (`src/`, `app/`).
- You may make git commits, but must propose the commit structure for review first.
- When writing commit body messages, split long lines into multiple lines rather than shortening
  the content. Commitlint enforces a 100-character body line limit.
- Add inline comments explaining **why** code is added — the rationale, the context, the constraint
  that drove the decision. Assume a reader unfamiliar with the tech stack (React Native, Expo,
  Kysely, etc.). For complex code, also explain **what** it is doing step-by-step.
- All non-trivial functions must have docstrings.
- All classes and interfaces must have docstrings.
- Avoid the use of singletons, prefer dependency injection or contexts.
- Use the available CLI tools for parsing files instead of writing custom scripts. The development
  shell provides `jq` for JSON, `yq` for YAML/JSON/INI/XML, `pup` for HTML, and `python3` for
  everything else. Reach for `jq` before writing a Python one-liner to extract a JSON field; reach
  for `yq` before parsing a YAML file; reach for `pup` before writing BeautifulSoup code to extract
  an HTML attribute. Custom scripts are appropriate only when no shell tool fits the job (e.g.,
  multi-step pipelines, complex text transformations, or anything that needs proper control flow).

## E2E Testability Constraints

### Maestro + React Native Native Stack Navigator Headers on Android

React Native Paper components (`Appbar.Action`, `Appbar.BackAction`, etc.) rendered inside
`headerLeft`, `headerRight`, or `headerTitle` callbacks of React Navigation's **native** Stack
Navigator are **not testable with Maestro** on Android. The native Stack wraps these components in
opaque `android.view.ViewGroup` containers that strip `testID`, `accessibilityLabel`, text, and
`clickable` from the accessibility tree.

**Confirmed non-functional selectors:**

| Selector              | Component                           | Result    |
| --------------------- | ----------------------------------- | --------- |
| `id: 'undo-button'`   | `Appbar.Action` in `headerRight`    | Not found |
| `id: 'redo-button'`   | `Appbar.Action` in `headerRight`    | Not found |
| `text: 'Navigate up'` | `Appbar.BackAction` in `headerLeft` | Not found |
| `text: 'New Entry'`   | `Stack.Screen` title                | Not found |

**Required pattern:** Always use `headerShown: false` on the `Stack.Screen` and render a custom
`Appbar.Header` directly in the screen content with explicit `testID` props:

```tsx
<Stack.Screen options={{ headerShown: false }} />
<Appbar.Header statusBarHeight={0} testID="appbar-header">
  <Appbar.BackAction onPress={() => navigation.goBack()} testID="back-button" />
  <Appbar.Content title="New Entry" />
  <Appbar.Action icon="undo" testID="undo-button" onPress={handleUndo} />
  <Appbar.Action icon="redo" testID="redo-button" onPress={handleRedo} />
</Appbar.Header>
```

**Note:** `Appbar.Header` adds its own `statusBarHeight` padding by default. When wrapped in
`SafeAreaView` with the `top` edge, this creates double padding. Set `statusBarHeight={0}` to
prevent the gap.

## Core Features

### Journal Entry Management

- Markdown support for content (basic formatting via `react-native-markdown-renderer`)
- Autosave during editing
- Undo/redo within editing session (history stack maintained in `app/entry-editor.tsx`)
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

### Backups

The app maintains local file copies of the encrypted database in a user-chosen Storage Access
Framework directory. Backups are written under four circumstances:

- **Lifecycle (automatic):** when the app moves to the background and on app start-up, if the
  database has changed since the last backup and a backup directory is configured. Skipped silently
  if the database is not stale.
- **Pre-migration (automatic):** before any pending database migrations run. Best-effort; the
  migration proceeds even if the backup write fails.
- **Safety (automatic, user-confirmed):** a fresh backup is taken immediately before a destructive
  restore overwrites the existing database, and before an encryption-password change rewrites the
  database.
- **Manual:** the "Backup Now" button on the Settings screen.

The most recent N backups are retained (default 5); older copies are deleted on rotation. A
"Restore from backup" flow is reachable from the login screen.

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
- Location-based search
- Database indices or query optimization

## Build and Deployment

- Focus on Android platform initially (iOS scaffold present)
- Expo EAS Build for APK generation

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
