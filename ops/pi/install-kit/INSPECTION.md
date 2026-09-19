# Inspection findings

Both supplied `.app` bundles were inspected without modification. SHA-256
checks of `Info.plist`, the launcher, server, site entry point, catalogue, and
bundled runtime matched between the Seagate and Google Drive copies.

## What the app is

- `Info.plist` identifies a macOS application bundle named The Reading Room,
  version 1.0, minimum macOS 12, with `LSUIElement` enabled for menu-bar style
  operation.
- `Contents/MacOS/reading-room` is a zsh script, not a compiled app executable.
- The script stages a static site, launches `standalone-server.mjs`, opens the
  default browser, and uses Apple-only `osascript`/JXA for notifications and a
  menu-bar controller.
- The site is a compiled React/Vinext/Vite browser application. No original
  TypeScript/React source or source maps are present in either bundle.
- There is no Electron runtime, `app.asar`, Chromium bundle, or Electron
  framework. There are also no conventional app frameworks under
  `Contents/Frameworks`.
- `Contents/Resources/node` is Node.js 24.14.0 compiled as a Mach-O arm64
  executable for macOS. Raspberry Pi OS needs an ELF aarch64 Linux Node binary.
- The server is dependency-free JavaScript using Node built-ins. That code and
  the static site are portable to Linux once run by the Pi's Node.js runtime.

## Why copying the `.app` did not work

An SMB/NAS folder stores bytes; it does not convert or execute them for another
operating system. Even though both Apple Silicon and Raspberry Pi 5 use ARM64
CPUs, macOS and Linux use different executable formats and system APIs. The
bundle's zsh launcher calls macOS utilities and its Node executable is Mach-O,
where Raspberry Pi OS expects ELF. iOS also cannot execute arbitrary macOS app
bundles from a network share.

The correct model is the one in this package: run the portable Node server on
the Pi and use the iPhone as a browser client over Tailscale.

## Credential review

The active Drive download path constructs `drive.usercontent.google.com`
download URLs from catalogued file IDs and proxies the response. No OAuth client
secret, refresh token, access token, API key, or Authorization header was found
in the server or browser site. The original certificate/private-key pair was
not copied because it is unnecessary with Tailscale Serve and should not be
redistributed.
