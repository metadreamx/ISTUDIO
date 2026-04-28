# Shipping ISTUDIO With GitHub Releases

ISTUDIO ships as a simple Windows launcher plus a self-contained app package. Users only need to download one launcher; all runtime files and dependencies install automatically.

## User Downloads

Each GitHub Release should expose only:

- `LAUNCH ISTUDIO.bat`
- `ISTUDIO-windows.zip`

Tell users to download `LAUNCH ISTUDIO.bat`, move it to the folder where they want ISTUDIO installed, then double-click it. The launcher creates an `ISTUDIO` folder beside the BAT, installs or repairs the app there, then starts ISTUDIO in one run. Users can open the maintenance menu with `LAUNCH ISTUDIO.bat menu`.

Users should not use GitHub's **Code > Download ZIP** button. The only supported install path is `LAUNCH ISTUDIO.bat` from GitHub Releases.

## What The Package Contains

`ISTUDIO-windows.zip` must contain:

- `runtime/node/node.exe`
- `runtime/node/npm.cmd`
- `node_modules/`
- `dist/index.html`
- `dist-server/server.js`
- `scripts/ISTUDIO-Launcher.ps1`
- `LAUNCH ISTUDIO.bat`

The launcher validates these files before starting ISTUDIO.

## Install And Update Flow

The launcher installs ISTUDIO beside the BAT:

```text
<folder with LAUNCH ISTUDIO.bat>\ISTUDIO
```

It preserves:

- `<install folder>\projects`
- `<install folder>\.env.local`
- `<install folder>\.istudio-release`

The installed launcher can also check for updates and replace the app with the newest GitHub Release package.

## User Support

If install or launch fails, ask the user to download the latest `LAUNCH ISTUDIO.bat` from GitHub Releases and run it again.
