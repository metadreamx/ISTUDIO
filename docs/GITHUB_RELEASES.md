# Shipping ISTUDIO With GitHub Releases

ISTUDIO is set up to ship as a self-contained Windows release package with a one-click installer. Users do not need to install Node.js, npm, or app dependencies manually.

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

- `ISTUDIO.exe`
- `ISTUDIO.bat`
- `ISTUDIO-windows.zip`

Share `ISTUDIO.exe` as the easiest launcher, or `ISTUDIO.bat` as the fallback launcher. Either one downloads the latest release, installs ISTUDIO to `%LOCALAPPDATA%\ISTUDIO`, creates a desktop launcher, and opens the ISTUDIO Launcher menu.

The `ISTUDIO-windows.zip` package must contain `runtime/node/node.exe`, `runtime/node/npm.cmd`, `node_modules`, `dist/index.html`, `dist-server/server.js`, `ISTUDIO.exe`, and `ISTUDIO.bat`. The packager and installer both validate these files before shipping or installing.

Normal users should not install from GitHub's source-code zip because source zips do not include ignored runtime folders such as `runtime/`, `node_modules/`, `dist/`, or `dist-server/`.

## Updates

To ship an update:

```powershell
git tag v1.0.1
git push origin v1.0.1
```

Users can run `ISTUDIO.exe` / `ISTUDIO.bat` again, or choose **Check for updates** inside the launcher. The updater downloads the newest GitHub Release and updates the app while preserving:

- `%LOCALAPPDATA%\ISTUDIO\projects`
- `%LOCALAPPDATA%\ISTUDIO\.env.local`

If the launcher reports a `404` from GitHub, the repo does not have a published release yet or the repo is private. Push a version tag and wait for the release workflow to finish:

```powershell
git tag v1.0.1
git push origin v1.0.1
```

After GitHub Actions finishes, the latest release endpoint will exist and the launcher can download updates.

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
