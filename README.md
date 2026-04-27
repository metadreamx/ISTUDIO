# ISTUDIO

ISTUDIO by Iconic Recordings is a reference-based photo editing studio. It edits target photos from the visual DNA of another image for virtual background replacement, relighting, style transfer, and fine element control.

## Run Locally

Requirements:

- Node.js 22 or newer
- npm

```powershell
npm install
npm run dev
```

For the production launcher:

```powershell
.\ISTUDIO.bat
```

## Project Storage

Projects are stored on disk in the app's `projects/` folder. In the installed version, the updater preserves `%LOCALAPPDATA%\ISTUDIO\projects` so user work survives app updates.

## Ship on GitHub

This repo includes a GitHub Actions release workflow and a Windows one-click installer.

Read [docs/GITHUB_RELEASES.md](docs/GITHUB_RELEASES.md) for the full shipping flow.
