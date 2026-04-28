# Shipping ISTUDIO With GitHub Releases

ISTUDIO ships as a simple Windows launcher plus a self-contained app package. Users only need to download one launcher; all runtime files and dependencies install automatically.

## User Downloads

Each GitHub Release should expose only:

- `LAUNCH ISTUDIO.bat`
- `ISTUDIO.exe`
- `ISTUDIO-windows.zip`

Tell users to download `ISTUDIO.exe` first. If Windows blocks the EXE, they can use `LAUNCH ISTUDIO.bat`. Both launchers install or repair ISTUDIO automatically from the latest release.

Users should not use GitHub's **Code > Download ZIP** button because source zips do not include ignored runtime folders such as `runtime/`, `node_modules/`, `dist/`, or `dist-server/`.

## What The Package Contains

`ISTUDIO-windows.zip` must contain:

- `runtime/node/node.exe`
- `runtime/node/npm.cmd`
- `node_modules/`
- `dist/index.html`
- `dist-server/server.js`
- `scripts/ISTUDIO-Launcher.ps1`
- `LAUNCH ISTUDIO.bat`
- `ISTUDIO.exe`

The package script and installer both validate these files before shipping or installing.

## Install And Update Flow

The launcher installs ISTUDIO to:

```text
%LOCALAPPDATA%\ISTUDIO
```

It preserves:

- `%LOCALAPPDATA%\ISTUDIO\projects`
- `%LOCALAPPDATA%\ISTUDIO\.env.local`
- `%LOCALAPPDATA%\ISTUDIO\.istudio-release`

The installed launcher can also check for updates and replace the app with the newest GitHub Release package.

## Create A Release

```powershell
git tag v1.0.4
git push origin v1.0.4
```

After GitHub Actions finishes, the release endpoint exists and the launcher can install/update users.
