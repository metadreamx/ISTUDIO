# ISTUDIO by Iconic Recordings

ISTUDIO is a Windows-first, reference-based photo editing studio. It lets creators edit target photos from the visual DNA of another image, making it useful for virtual background replacement, relighting, style transfer, and fine element control.

The workflow is simple: choose a reference image, import your target photos, describe the edit, and generate a cohesive result that follows the reference while preserving the subject you are editing.

## What ISTUDIO Does

- Reference DNA editing: transfer lighting, mood, color, composition, and environment cues from a reference image.
- Virtual background replacement: rebuild scenes around a subject with stronger visual consistency.
- Relighting and style transfer: match studio lighting, editorial tones, campaign looks, and cinematic treatments.
- Element control: guide clothing, accessories, face, hair, background, and sky behavior with dedicated controls.
- Local project storage: every project is stored on disk in a real project folder, not browser-only storage.
- Windows launcher: launch ISTUDIO, check for updates, and install the latest release from one menu.

## Install on Windows

1. Open the latest GitHub Release.
2. Download `Install-ISTUDIO.bat`.
3. Double-click the installer.

The installer downloads the newest self-contained ISTUDIO package, installs it to:

```text
%LOCALAPPDATA%\ISTUDIO
```

It includes the Node.js runtime, app dependencies, and production build. Users do not need to install Node.js, npm, or developer tools. It also creates a desktop shortcut named `ISTUDIO`.

## Launch and Update

Open `ISTUDIO.bat` or the desktop shortcut. The launcher shows:

- `Launch ISTUDIO`
- `Check for updates`
- `Open projects folder`
- `Exit`

When an update is available, choose `Check for updates` and confirm the install. Your local projects are preserved during updates.

## Project Storage

Installed projects live here:

```text
%LOCALAPPDATA%\ISTUDIO\projects
```

Development projects live in this repo's `projects/` folder. Project data stays local on the user's computer.

## Development

Requirements:

- Node.js 22 or newer
- npm

Run locally:

```powershell
npm install
npm run dev
```

Build production:

```powershell
npm run build
```

Launch production:

```powershell
.\ISTUDIO.bat
```

## Release Builds

GitHub Actions builds the Windows release package whenever a version tag is pushed.

```powershell
git tag v1.0.1
git push origin v1.0.1
```

The release contains:

- `Install-ISTUDIO.bat`
- `Install-ISTUDIO.ps1`
- `ISTUDIO-windows.zip`

The launcher update check needs at least one published GitHub Release. If it says no release is available, push a version tag and wait for the **Build ISTUDIO Release** action to finish.

For more detail, read [docs/GITHUB_RELEASES.md](docs/GITHUB_RELEASES.md).
