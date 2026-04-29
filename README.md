# ISTUDIO by Iconic Recordings

![ISTUDIO reference edit workspace](docs/assets/istudio-reference-edit.jpg)

ISTUDIO is a Windows-first reference-based photo editing app. It lets creators edit target photos from the visual DNA of another image for background replacement, relighting, style transfer, and fine element control.

## Download And Install

[Download the one-click Windows installer](https://github.com/metadreamx/ISTUDIO/releases/latest/download/LAUNCH-ISTUDIO.bat)

Place `LAUNCH-ISTUDIO.bat` in the folder where you want ISTUDIO installed, then double-click it. The installer creates an `ISTUDIO` folder beside the BAT, installs the complete app there, and starts ISTUDIO.

Users do not need to install anything else. The release package includes everything ISTUDIO needs to run.
Setup scratch files are unpacked beside the BAT in `.istudio-setup-temp` and removed after setup.

## Google API Key Required

ISTUDIO uses Google Gemini for AI image editing. Each user needs to provide their own Google API key before generating or refining images.

The app will ask for the key when it is needed. The key stays on the user's computer in the local ISTUDIO install folder and is not included with the download.

## Use ISTUDIO

1. Open the desktop shortcut or `LAUNCH ISTUDIO.bat` inside the installed ISTUDIO folder.
2. The launcher checks for updates automatically, applies a newer release if one is available, then starts ISTUDIO.
3. Add your Google API key when prompted.
4. Import a reference image that contains the lighting, mood, style, or scene DNA you want.
5. Add target photos.
6. Refine the edit and export the finished result.

For the maintenance menu, run:

```powershell
.\LAUNCH-ISTUDIO.bat menu
```

The menu includes:

- `Check for updates`
- `Open projects folder`
- `Exit`

## Project Storage

Installed projects are saved inside the ISTUDIO folder beside the launcher:

```text
<folder with LAUNCH-ISTUDIO.bat>\ISTUDIO\projects
```

Each project gets its own folder with the reference image, target photos, generated outputs, saved slider/settings state, and generation history. Project data stays on the user's computer. Updates preserve projects and `.env.local`.

## Updates

ISTUDIO updates are published through GitHub Releases.
The launcher checks for updates every time ISTUDIO starts. If the computer is offline or GitHub is unavailable, ISTUDIO continues opening the installed version.

```powershell
.\LAUNCH-ISTUDIO.bat menu
```

The maintenance menu can also check for updates manually and open the local projects folder. Releases show the installer BAT plus GitHub's source-code downloads:

- `LAUNCH-ISTUDIO.bat`
