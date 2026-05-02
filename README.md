# ISTUDIO by Iconic Recordings

![ISTUDIO reference edit workspace](docs/assets/istudio-reference-edit.jpg)

ISTUDIO is a Windows-first creative app for reference-based photo editing and campaign design. Use one image as the visual DNA for another, then control background replacement, relighting, style transfer, element details, and export-ready results.

## What ISTUDIO Does

- **Reference Edit**: edit target photos from the lighting, background, mood, color, and style DNA of a reference image.
- **Tethered Mode**: watch a camera capture folder and import new photos into a Reference Edit project automatically.
- **Canvas**: create single-page designs with editable image, text, shape, brush, template, and AI result layers.
- **Local projects**: save references, targets, generations, Canvas documents, exports, and settings in project folders on your computer.
- **Automatic updates**: the launcher checks GitHub Releases every time ISTUDIO starts.

## Download And Install

### For Windows Users

**Download this installer:**

[Download INSTALL-ISTUDIO.bat](https://github.com/metadreamx/ISTUDIO/releases/latest/download/INSTALL-ISTUDIO.bat)

Then:

1. Move `INSTALL-ISTUDIO.bat` to the folder where you want ISTUDIO installed.
   Good choices are Desktop, Documents, or an external drive.
2. Double-click `INSTALL-ISTUDIO.bat`.
3. ISTUDIO creates an `ISTUDIO` folder beside the BAT file.
4. The installer sets up the complete app and starts ISTUDIO.
5. Keep the launcher window open while using ISTUDIO. Closing it stops the local app server.

Users do not need to install developer tools. The Windows release includes everything ISTUDIO needs to run.

Do not use GitHub's green **Code > Download ZIP** button for installation. Regular users should download `INSTALL-ISTUDIO.bat` from Releases.

## Google API Key Required

ISTUDIO uses Google Gemini for AI image editing. Each user needs to provide their own Google API key before generating or refining images.

The app will ask for the key when it is needed. The key stays on the user's computer and is not included with the download.

## Use ISTUDIO

1. Open the desktop shortcut or `LAUNCH.bat` inside the installed ISTUDIO folder.
2. The launcher checks for updates automatically.
3. If a newer version is available, ISTUDIO updates first, then opens.
4. Add your Google API key when prompted.
5. Choose **Reference Edit** or **Canvas**.
6. Create, save, refine, and export your work.

### Tethered Mode

Tethered Mode is inside **Reference Edit**. Use your camera brand's tethering software, Lightroom, Capture One, or another capture app to save new photos into a folder. In ISTUDIO, open **Tethered Mode**, choose that folder, pick the current project or a new session project, then start watching.

New photos are imported and saved immediately. Turn on **Auto Edit** when a reference image and DNA controls are ready, and incoming shots will queue for editing automatically. For best results, configure your tether software to save JPEG, PNG, WebP, or TIFF files; RAW files are ignored until they are converted by the capture software.

To open the maintenance menu, run:

```powershell
& ".\LAUNCH.bat" menu
```

The menu includes:

- `Check for updates`
- `Open projects folder`
- `Exit`

## Project Storage

Projects are saved inside the installed ISTUDIO folder:

```text
<folder with INSTALL-ISTUDIO.bat>\ISTUDIO\projects
```

Each project gets its own folder with reference images, target photos, generated outputs, Canvas assets, exports, saved settings, and generation history. Project data stays on the user's computer.

### Moving Projects Between Computers

To move work to another computer, copy the project folder into the new computer's `ISTUDIO\projects` folder, then restart ISTUDIO. Imported project folders can be placed directly inside `projects` or inside another folder under `projects`; ISTUDIO scans for `project.json` files and lists them automatically.

## Updates

ISTUDIO updates are published through GitHub Releases.
The launcher checks for updates every time ISTUDIO starts. If the computer is offline or GitHub is unavailable, ISTUDIO keeps opening the installed version.

Updates preserve:

- `projects`
- `.env.local`
- local API key/settings files

## Troubleshooting

- If Windows blocks the BAT file, choose **More info > Run anyway** only if you downloaded it from this official GitHub Releases page.
- If ISTUDIO does not open, close any old ISTUDIO launcher windows and run `LAUNCH.bat` again.
- If you want to install somewhere else, move `INSTALL-ISTUDIO.bat` to that folder before running it.
- If update checking fails because the computer is offline, ISTUDIO will still launch the installed version.
