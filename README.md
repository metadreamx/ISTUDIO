# ISTUDIO by Iconic Recordings

![ISTUDIO reference edit workspace](docs/assets/istudio-reference-edit.jpg)

ISTUDIO is a Windows-first reference-based photo editing app. It lets creators edit target photos from the visual DNA of another image for background replacement, relighting, style transfer, and fine element control.

## Download And Install

For normal users, use the GitHub **Releases** page. Do not use GitHub's green **Code > Download ZIP** button.

1. Open the latest Release for this repo.
2. Download either `LAUNCH ISTUDIO.bat` or `ISTUDIO.exe`.
3. Double-click the downloaded launcher.
4. The launcher downloads the complete ISTUDIO package automatically.
5. ISTUDIO installs to `%LOCALAPPDATA%\ISTUDIO` and creates a desktop shortcut.

Users do not need to install Node.js, npm, developer tools, or app dependencies. The release package includes the runtime, dependencies, client build, and server build.

## Use ISTUDIO

1. Open the desktop shortcut, `ISTUDIO.exe`, or `LAUNCH ISTUDIO.bat`.
2. Choose `Launch ISTUDIO`.
3. Import a reference image that contains the lighting, mood, style, or scene DNA you want.
4. Add target photos.
5. Refine the edit and export the finished result.

The launcher also includes:

- `Check for updates`
- `Open projects folder`
- `Exit`

## Project Storage

Installed projects are saved locally here:

```text
%LOCALAPPDATA%\ISTUDIO\projects
```

Project data stays on the user's computer. Updates preserve projects and `.env.local`.

## Development

Requirements for development only:

- Node.js 22 or newer
- npm

```powershell
npm install
npm run dev
```

Build production locally:

```powershell
npm run build
```

Launch from this source folder:

```powershell
.\LAUNCH ISTUDIO.bat
```

## Release Builds

GitHub Actions builds the Windows release package whenever a version tag is pushed:

```powershell
git tag v1.0.4
git push origin v1.0.4
```

The Release should contain only these user-facing downloads:

- `LAUNCH ISTUDIO.bat`
- `ISTUDIO.exe`
- `ISTUDIO-windows.zip`

For release details, read [docs/GITHUB_RELEASES.md](docs/GITHUB_RELEASES.md).
