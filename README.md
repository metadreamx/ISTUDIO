# ISTUDIO by Iconic Recordings

![ISTUDIO reference edit workspace](docs/assets/istudio-reference-edit.jpg)

ISTUDIO is a Windows-first reference-based photo editing app. It lets creators edit target photos from the visual DNA of another image for background replacement, relighting, style transfer, and fine element control.

## Download And Install

For normal users, use the GitHub **Releases** page. Do not use GitHub's green **Code > Download ZIP** button.

1. Open the latest Release for this repo.
2. Download `LAUNCH ISTUDIO.bat`.
3. Double-click `LAUNCH ISTUDIO.bat`.
4. The launcher downloads the complete ISTUDIO package automatically, installs it, and starts ISTUDIO.
5. ISTUDIO installs to `%LOCALAPPDATA%\ISTUDIO` and creates a desktop shortcut.

Users do not need to install anything else. The release package includes everything ISTUDIO needs to run.

## Use ISTUDIO

1. Open the desktop shortcut or `LAUNCH ISTUDIO.bat`.
2. ISTUDIO starts automatically.
3. Import a reference image that contains the lighting, mood, style, or scene DNA you want.
4. Add target photos.
5. Refine the edit and export the finished result.

For the maintenance menu, run:

```powershell
.\LAUNCH ISTUDIO.bat menu
```

The menu includes:

- `Check for updates`
- `Open projects folder`
- `Exit`

## Project Storage

Installed projects are saved locally here:

```text
%LOCALAPPDATA%\ISTUDIO\projects
```

Project data stays on the user's computer. Updates preserve projects and `.env.local`.

## Updates

ISTUDIO updates are published through GitHub Releases.

```powershell
.\LAUNCH ISTUDIO.bat menu
```

The maintenance menu can check for updates and open the local projects folder. Releases contain only these user-facing downloads:

- `LAUNCH ISTUDIO.bat`
- `ISTUDIO-windows.zip`
