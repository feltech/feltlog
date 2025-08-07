---
description: "General project guidelines"
globs: [ "*" ]
alwaysApply: true
---

# FeltLog Development Guidelines

## Project Overview

FeltNote is an Android diary/journal application built with React Native
and TypeScript, following domain-driven design principles at the high
level and data-oriented design at the lower level.

## Development Environment

### Core Tools

- NixOS development environment
- WebStorm IDE (though terminal-based development should be supported)
- Android Emulator with x86_64 images
- Node.js (stable version)
- React Native using Expo

### Development Shell

- Nix Flake for reproducible development environment in build_env
  directory
- Minimal system dependencies, focused on Android development needs

## Technology Stack

### Frontend

- React Native with TypeScript
- MVVM architecture pattern for potential cross-platform portability

### Database

- Encrypted expo-sqlite for production and e2e tests, shimmed to sqlite
  for nodejs for unit tests
- Kysely query builder
- Schema for a diary entry:
  ```typescript
  interface JournalEntry {
    id: string;
    content: string;
    datetime: Date;  // User-adjustable timestamp
    created_at: Date;
    modified_at: Date;
    tags: string[];
    location?: {
      latitude: number;
      longitude: number;
      elevation: number;
      accuracy?: number;
      address?: string;
    };
  }
  ```
- Tags in separate table with many-to-many relationship
- No explicit indices in initial version

## Architecture Overview

### Design Patterns

- Data-oriented design at lower level
- Repository pattern for data access abstraction

### Application Layers

- Domain layer (business logic and entities)
- Data layer (repositories and data sources)
- Presentation layer (components and viewmodels)
- Infrastructure layer (platform-specific implementations)

## Code Quality

### TypeScript Configuration

- Strict mode enabled
- Comprehensive type checking

### Code Formatting

- ESLint for linting
- Prettier for formatting
- 99 character line limit for code

## Comment formatting

- 72 character line limit for comments
- Javadoc style docstrings. 
- Newlines separating summary, description body,
  and parameters in docstrings.
- End parameter and return descriptions with a period.

### Testing

- Unit tests alongside source files
- Integration tests in separate e2e directory mirroring source structure
- maestro for integration testing
- No specific coverage threshold
- Tests must run on both:
  - Node.js environment (unit tests)
  - Android Emulator (integration tests)

## Coding guidelines

- Do NOT modify files in node_modules.
- Use as few mocks as possible when testing. Especially avoid global
  mocks that affect every test. Try to fix the configuration of the
  project before resorting to mocking.
- Read the stack trace of error messages and check the code in the last
  couple of mentioned files to better understand the reason
  for the error.
- Use ES modules, never CommonJS.
- Do not make git commits, the user will do that.

## Core Features

### Journal Entry Management

- Markdown support for content (basic formatting)
- Autosave during editing
- Undo/redo within editing session
- Location capture on entry creation
  - Manual location updates via menu
  - Elevation data from location services
  - OpenStreetMap for reverse geocoding (no API key required)
- Tag support
  - Free-form tags
  - Autocomplete from existing tags
  - Default to last used tags for new entries
- Virtual scrolling
  - Batch size: 10 entries
  - Pre-fetch enabled

### Storage

- User-selected database location via Storage Access Framework
- Import/export sqlite database file using Storage Access Framework on
  Android

### Search Functionality

- Text search within journal entries
- Tag-based filtering
- No location-based search in initial version
- UI optimized for quick access to search functionality

### Error Handling

- Collapsible status area at screen bottom
- Status messages auto-hide after 3 seconds
- Tap to keep status visible
- Platform specific logging system support
- Multiple log levels with debug toggle in settings
- Graceful degradation for missing permissions or services

### Location Features

- Capture on entry creation
- Manual update option in entry menu
- Device location permission management with user warnings
- Graceful degradation on permission denial
- OpenStreetMap-based geocoding (no API key required)

### UI/UX

- System locale-based formatting for dates and times
- Responsive layout for various screen sizes
- Focus on usability and simplicity
- Collapsible status area for notifications
- Infinite scroll implementation for journal entries

## Non-Requirements (First Version)

- Cloud sync
- Media attachments
- Templates
- Statistics
- Notifications
- Theme support
- Mood tracking
- Tag hierarchies
- Tag suggestions
- Location-based search
- Database optimization
- Automatic backups

## Build and Deployment

- GitHub Actions for CI/CD
- Focus on Android platform initially
- Recent Android API target acceptable
- No pre-commit hooks initially

## Dependencies

- Prefer established open-source packages
- Liberal licensing required
- Key packages:
  - Expo
  - Kysely

## Security Considerations

- No internal encryption (rely on external apps like DroidFS)
- User-selected database location via Storage Access Framework
- No network requests or data sharing
- Permissions requested only when needed
- Clear user feedback on permission requirements

## Performance Considerations

- Lazy loading of journal entries
- Efficient database queries
- Minimal Redux state
- Virtualized list for smooth scrolling
- Autosave with appropriate throttling

## Development Workflow

- Feature branches
- Pull requests for code review
- CI validation before merge
- Testing required for new features
- Clear commit messages

## Future Expansion Areas

- Cross-platform support
- Media attachments
- Cloud sync options
- Advanced search features
- Performance optimizations
- Database migration strategies
    

