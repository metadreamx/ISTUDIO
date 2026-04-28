# Shipping ISTUDIO With GitHub Releases

ISTUDIO is set up to ship as a Windows release package with a one-click installer.

## First-Time GitHub Setup

1. Use the GitHub repository `metadreamx/ISTUDIO`.
2. Push this folder to that repository.
3. In GitHub, go to **Actions** and run **Build ISTUDIO Release** once to confirm the package builds.
4. Create a version tag when you are ready to ship:

```powershell
git tag v1.0.0
git push origin v1.0.0
```

The workflow creates a GitHub Release with:

- `Install-ISTUDIO.bat`
- `Install-ISTUDIO.ps1`
- `ISTUDIO-windows.zip`

Share `Install-ISTUDIO.bat` with users. It downloads the latest release, installs ISTUDIO to `%LOCALAPPDATA%\ISTUDIO`, creates a desktop launcher, and opens the ISTUDIO Launcher menu.

## Updates

To ship an update:

```powershell
git tag v1.0.1
git push origin v1.0.1
```

Users can run the same installer again, or choose **Check for updates** inside `ISTUDIO.bat`. The updater downloads the newest GitHub Release and updates the app while preserving:

- `%LOCALAPPDATA%\ISTUDIO\projects`
- `%LOCALAPPDATA%\ISTUDIO\.env.local`

## Local Release Package

To build the same release files locally:

```powershell
.\scripts\package-release.ps1 -Repo "metadreamx/ISTUDIO"
```

The finished files will be in `release/`.

## Notes

- The release zip includes a portable Node.js runtime and `node_modules`, so users do not need to install Node separately.
- The app still works for development with `npm run dev`.
- Project data stays local on the user's computer.
