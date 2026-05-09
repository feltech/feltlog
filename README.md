# FeltLog

FeltLog is an Android diary/journal application built with React Native and TypeScript.

## Development

This project uses a Nix development environment for reproducibility.

### Prerequisites

- Nix with Flakes enabled.
- Android Emulator (included in the Nix shell).

### Getting Started

1. Enter the development shell (unnecessary if direnv is installed - see .envrc)

   ```bash
   nix develop ./build_env
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

## Running E2E Tests (Maestro)

To run the end-to-end tests, follow these steps:

1. **Restart ADB Server** (optional but recommended if in a bad state):

   ```bash
   adb kill-server
   adb start-server
   ```

2. **Start the Android Emulator**:

   ```bash
   maestro start-device --platform android --device-model "pixel_6" --device-os android-35
   ```

3. **Build and Install the App** (in a separate terminal or background):

   ```bash
   npm run android
   ```

   or, for debugging,

   ```bash
   npm start
   ```

4. **Run Maestro Tests**:

It is best to `cd` into the directory, since artifacts such as screenshots will be saved relative
to that.

```bash
cd e2e
maestro test .
```

Or run a specific test:

```bash
maestro test e2e/create_and_view_entry.yaml
```
