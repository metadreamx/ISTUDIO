# ISTUDIO by Iconic Recordings

![ISTUDIO reference edit workspace](docs/assets/istudio-reference-edit.jpg)

ISTUDIO is a Windows-first creative app for reference-based photo editing. Use one image as the visual DNA for another, then control background replacement, relighting, style transfer, element details, and export-ready results.

## What ISTUDIO Does

- **Reference Edit**: edit target photos from the lighting, background, mood, color, and style DNA of a reference image.
- **High-detail output**: keeps the target photo's crop, aspect ratio, pose, and fine details as intact as possible while requesting the highest supported 4K Gemini output.
- **Virtual Set**: build a 3D set, tune sky and lighting, render a still, then use it as reference DNA or a virtual background.
- **Tethered Mode**: watch a camera capture folder and import new photos into a Reference Edit project automatically.
- **Local projects**: save references, targets, generations, virtual sets, tethered captures, exports, and settings in project folders on your computer.
- **Automatic updates**: the launcher checks GitHub Releases every time ISTUDIO starts.
- **iPhone PWA mode**: open ISTUDIO in Safari, add it to the Home Screen, and use browser-backed project storage with ZIP backup/export.

## Use On iPhone

The easiest iPhone version is the ISTUDIO PWA:

Open your Netlify ISTUDIO site in Safari.

Then:

1. Open the link in Safari.
2. Tap **Share**.
3. Tap **Add to Home Screen**.
4. Open ISTUDIO from the new Home Screen icon.
5. Add your Google Gemini API key when prompted, then tap **Test Gemini**.

The iPhone version keeps the same desktop-style Reference Edit workspace with side-by-side target/result panels and slide-over controls. Projects are saved in Safari browser storage, not a Windows project folder.

Gemini requests on iPhone use the Netlify Function relay built into the same site, so Safari receives the same request/response flow as the Windows desktop app. If the connection test fails, confirm the Netlify deploy includes `netlify/functions/gemini-generate.js` and that the key has the Gemini API enabled.

Use **Export backup** to download a project ZIP before clearing Safari data or moving work to another device. Use **Import backup** to restore a project ZIP.

Desktop-only features are hidden or limited on iPhone:

- Windows BAT launcher and automatic desktop updates
- Open projects folder
- Tethered Mode folder watching
- Heavy Virtual Set workflows on smaller phones

## Download And Install

### For Windows Users

**Download this installer:**

[Download INSTALL-ISTUDIO.bat](https://github.com/metadreamx/ISTUDIO/releases/latest/download/INSTALL-ISTUDIO.bat)

Then:

1. Move `INSTALL-ISTUDIO.bat` to the folder where you want ISTUDIO installed.
   Good choices are Desktop, Documents, or an external drive.
2. Double-click `INSTALL-ISTUDIO.bat`.
3. The installer checks GitHub Releases for the newest ISTUDIO package.
4. If a newer installer is available, it updates itself first, then continues automatically.
5. ISTUDIO creates an `ISTUDIO` folder beside the BAT file.
6. The installer sets up the complete app and starts ISTUDIO.
7. Keep the launcher window open while using ISTUDIO. Closing it stops the local app server.

Users do not need to install developer tools. The Windows release includes everything ISTUDIO needs to run.

Do not use GitHub's green **Code > Download ZIP** button for installation. Regular users should download `INSTALL-ISTUDIO.bat` from Releases.

## Google API Key Required

ISTUDIO uses Google Gemini for AI image editing. Each user needs to provide their own Google API key before generating or refining images.

The app will ask for the key when it is needed. The key is stored locally in the user's browser/app and is not included with the download. During an AI request, ISTUDIO sends the key only for that request:

- Windows desktop: through the local ISTUDIO relay at `/api/gemini/generate`.
- iPhone PWA on Netlify: through the same-site Netlify Function at `/.netlify/functions/gemini-generate`.
- GitHub Pages fallback: through a Cloudflare Worker relay configured by `VITE_GEMINI_RELAY_URL`.

The relay does not store the key or save it into project files. Use the **Test Gemini** button in Settings to confirm the key can analyze and generate before starting a project.

For the iPhone PWA relay, use a Gemini key with the Gemini API enabled. Prefer restricting the key to the Gemini API itself instead of using browser-only referrer restrictions, because the relay makes the final Google request on behalf of the app.

## Use ISTUDIO

1. Open the desktop shortcut or `LAUNCH.bat` inside the installed ISTUDIO folder.
2. The launcher checks for updates automatically.
3. If a newer version is available, ISTUDIO updates first, then opens.
4. Add your Google API key when prompted.
5. Open **Reference Edit** or **Virtual Set**.
6. Create, save, refine, and export your work.

### Virtual Set

Virtual Set lets users compose a 3D scene inside ISTUDIO, adjust objects, camera, sky, lighting, fog, and render size, then save a still into the current project. A render can be sent directly into **Reference Edit** as the main reference DNA or as a controlled virtual background.

ISTUDIO includes a native Three.js rendering engine with PBR materials, selectable objects and lights, transform gizmos, environment controls, imported image/model assets, fast WebGL preview, and progressive path-traced Beauty Render for bounced light, soft shadows, emissive panels, and realistic reflections. No external 3D engine or runtime is required.

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

On Windows, projects are saved inside the installed ISTUDIO folder:

```text
<folder with INSTALL-ISTUDIO.bat>\ISTUDIO\projects
```

Each project gets its own folder with reference images, target photos, virtual set scenes/renders, tethered captures, generated outputs, exports, saved settings, and generation history. Project data stays on the user's computer.

On iPhone PWA, projects are saved in Safari browser storage. Export a project backup ZIP to move or preserve it.

### Moving Projects Between Computers

To move work to another computer, copy the project folder into the new computer's `ISTUDIO\projects` folder, then restart ISTUDIO. Imported project folders can be placed directly inside `projects` or inside another folder under `projects`; ISTUDIO scans for `project.json` files and lists them automatically.

## Updates

ISTUDIO updates are published through GitHub Releases.
The installer checks for a newer release every time it runs, downloads the latest installer when needed, then installs or repairs ISTUDIO from the newest app package.
The launcher checks for updates every time ISTUDIO starts. If the computer is offline or GitHub is unavailable, ISTUDIO keeps opening the installed version.

Updates preserve:

- `projects`
- `.env.local`
- local API key/settings files

## Publish The iPhone PWA

Netlify is the recommended mobile/PWA host because it can serve both the app and the Gemini relay.

Use these Netlify settings:

- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`

The included `netlify.toml` sets the app to Netlify relay mode automatically. No Cloudflare token or `VITE_GEMINI_RELAY_URL` is needed for Netlify hosting.

After Netlify deploys, open the Netlify site on iPhone Safari and use **Test Gemini** in Settings. The app should show **Netlify Relay connected**.

### Optional GitHub Pages Fallback

GitHub Pages is static, so mobile Gemini calls need the included Cloudflare Worker relay:

1. Deploy `worker/gemini-relay.js` with Cloudflare Workers.
2. In GitHub, add the repository variable `VITE_GEMINI_RELAY_URL` with the Worker URL, for example `https://istudio-gemini-relay.yourname.workers.dev`.
3. Run the **Publish ISTUDIO PWA** workflow or push to `main`.
4. Open [ISTUDIO PWA](https://metadreamx.github.io/ISTUDIO/) on iPhone and use **Test Gemini** in Settings.

The Pages workflow intentionally fails if `VITE_GEMINI_RELAY_URL` is missing. This prevents publishing a mobile app that cannot analyze references or generate images.

To deploy the relay from a local terminal:

```powershell
$env:CLOUDFLARE_API_TOKEN = "your-cloudflare-api-token"
npx wrangler deploy
```

## Troubleshooting

- If Windows blocks the BAT file, choose **More info > Run anyway** only if you downloaded it from this official GitHub Releases page.
- If ISTUDIO does not open, close any old ISTUDIO launcher windows and run `LAUNCH.bat` again.
- If you want to install somewhere else, move `INSTALL-ISTUDIO.bat` to that folder before running it.
- If update checking fails because the computer is offline, ISTUDIO will still launch the installed version.
