# FeltLog

FeltLog is an Android diary/journal application built with React Native and TypeScript.

## Using

Build an apk using

```bash
npm run build:release
```

The apk can be found at the `android/app/build/outputs/apk/release/app-release.apk`.

You can then sideload the apk onto your device.

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

## AI assistance disclosure

This project is developed with significant AI assistance under a multi-agent workflow (planner,
explorer, builder, reviewer, e2e) with human oversight of architecture, prompts, and commits. The
human does not write most code line-by-line.

All code has been reviewed by a human, but only cursorily - enough to catch gross errors and
misdirection, not enough for pedantic line-by-line revision.

Verification enforcement:

- Unit tests with ≥90% coverage gate (`npm run test:coverage`)
- Pre-commit hooks enforcing lint, typecheck, and format
- Maestro end-to-end tests on Android emulator for critical paths
- Independent reviewer-agent pass on code changes

### Models used

Various model families were experimented with in coding this app (through various providers),
including (in order of size):

- DeepSeek v4 Pro 1.6T
- Kimi k2.7 1.1T
- MiMo V2.5 Pro 1T
- GLM 5.2 753B
- Nemotron 3 Ultra 561B
- MiniMax M3 427B
- MiMo V2.5 311B
- Deepseek V4 Flash 284B
- MiniMax M2.7 229B
- Nemotron 3 Super 120B
