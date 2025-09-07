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
        pkgs = import nixpkgs { inherit system; };
        sdk = android-nixpkgs.sdk.${system} (sdkPkgs:
          with sdkPkgs; [
            build-tools-35-0-0
            cmdline-tools-latest
            emulator
            platform-tools
            platforms-android-35
            system-images-android-35-google-apis-x86-64
            # Versions dictated by what expo run tried to auto install but failed because SDK dir is not writeable.
            ndk-27-1-12297006
            cmake-3-22-1
          ]);
      in {
        devShell = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs
            # Watch files and take action when change
            # TODO(DF): not sure what its a dependency of.
            watchman
            # e2e testing
            maestro
          ];

          shellHook = ''
            export PATH="${sdk}/bin:$PATH"
            ${(builtins.readFile "${sdk}/nix-support/setup-hook")}
            function create-avd () {
              local name=phone
              local sysimg="system-images;android-35;google_apis;x86_64"
              local device="pixel_4"

              avdmanager create avd --force --name "$name" --package "$sysimg" --device "$device"
              local cfg="$HOME/.android/avd/$name.avd/config.ini"
              sed -i 's/hw.keyboard=.*/hw.keyboard=yes/' "$cfg"
              sed -i 's/hw.mainKeys=.*/hw.mainKeys=yes/' "$cfg"
            }
          '';

        };
      }
    );
}
