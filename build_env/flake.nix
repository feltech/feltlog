{
  description = "FeltLog diary/journal application";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    android-nixpkgs.url = "github:tadfisher/android-nixpkgs/stable";
  };

  outputs = { self, nixpkgs, flake-utils, android-nixpkgs, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; config = { allowUnfree = true; };};

        opencode-dev = pkgs.opencode.overrideAttrs (prev: {
          pname = "opencode-dev";
          version = "dev";
          __intentionallyOverridingVersion = true;
          node_modules = pkgs.opencode.node_modules;
          env = (prev.env or {}) // {
            OPENCODE_VERSION = "dev";
            OPENCODE_CHANNEL = "dev";
          };
          installPhase = ''
            runHook preInstall
            install -Dm755 dist/opencode-*/bin/opencode $out/bin/opencode-dev
            wrapProgram $out/bin/opencode-dev \
              --prefix PATH : ${pkgs.lib.makeBinPath (
                [ pkgs.ripgrep ]
                ++ pkgs.lib.optionals pkgs.stdenvNoCC.hostPlatform.isDarwin [
                  pkgs.sysctl
                ]
              )}
            install -Dm644 config.json $out/share/opencode/config.json
            install -Dm644 tui.json $out/share/opencode/tui.json
            runHook postInstall
          '';
          postInstall = "";
          doInstallCheck = false;
          passthru = prev.passthru or {};
          meta = (prev.meta or {}) // {
            mainProgram = "opencode-dev";
          };
        });

        sdk = android-nixpkgs.sdk.${system} (sdkPkgs:
          with sdkPkgs; [
            # SDK 36 components required by Expo SDK 56 (compileSdk/targetSdk 36)

            build-tools-36-0-0
            platforms-android-36
            system-images-android-36-google-apis-x86-64
            cmdline-tools-latest
            emulator
            platform-tools

            # Versions dictated by what expo run tried to auto install but failed
            # because SDK dir is not writeable.

            # For expo modules (well-behaved ones)
            ndk-27-1-12297006 
            # For expo-sqlite - upstream bug where ndkVersion is not inherited and falls back on
            # Android Gradle Plugin default. 
            ndk-27-0-12077973
            cmake-3-22-1
            # Needed until upstream bugfix: expo-module-gradle-plugin (applied to every
            # library module) calls applyDefaultAndroidSdkVersions() to sync SDK
            # version with the root project, but doesn't set buildToolsVersion, so the
            # official Android Gradle Plugin (AGP) falls back to
            # DEFAULT_BUILD_TOOLS_REVISION=35 when building libraries.
            build-tools-35-0-0
          ]);
        create-avd = pkgs.writeShellScriptBin "create-avd" ''
            set -euo pipefail

            name=phone
            sysimg="system-images;android-3dn6;google_apis;x86_64"
            device="pixel_4"

            avdmanager create avd --force --name "$name" --package "$sysimg" --device "$device"

            cfg="$HOME/.android/avd/$name.avd/config.ini"
            sed -i 's/hw.keyboard=.*/hw.keyboard=yes/' "$cfg"
            sed -i 's/hw.mainKeys=.*/hw.mainKeys=yes/' "$cfg"
          '';
      in {
        devShell = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs
            # Java Development Kit for Android builds
            openjdk

            # Tools that agents like to use

            python3
            # JSON parser
            jq
            # html parser
            pup
            # YAML, JSON, INI and XML processor
            yq
            # GitHub CLI
            gh

            # Custom script (above) to create an appropriate AVD.
            create-avd

            # Watch files and take action when change
            # TODO(DF): not sure what its a dependency of.
            watchman

            # e2e testing
            maestro

            # sqlite command-line (e.g. for db migration script)
            sqlite
            sqlcipher # encryption support

            # AI coding agent
            opencode
            opencode-dev
          ];

          shellHook = ''
            export PATH="${sdk}/bin:$PATH"
            ${(builtins.readFile "${sdk}/nix-support/setup-hook")}
          '';
        };
      }
    );
}
