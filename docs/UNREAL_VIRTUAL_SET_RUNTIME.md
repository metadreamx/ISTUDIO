# ISTUDIO Virtual Set Runtime Contract

ISTUDIO can run an optional bundled Unreal runtime for the **Virtual Set** tool.

## Runtime Location

Place the packaged Unreal runtime in:

```text
virtual-set-runtime/
```

ISTUDIO looks for these Windows executables:

- `virtual-set-runtime/ISTUDIOVirtualSet.exe`
- `virtual-set-runtime/ISTUDIOVirtualSetRuntime.exe`
- `virtual-set-runtime/VirtualSetRuntime.exe`
- `virtual-set-runtime/Windows/ISTUDIOVirtualSet.exe`
- `virtual-set-runtime/Windows/ISTUDIOVirtualSetRuntime.exe`
- `virtual-set-runtime/WindowsNoEditor/ISTUDIOVirtualSet.exe`
- `virtual-set-runtime/WindowsNoEditor/ISTUDIOVirtualSetRuntime.exe`

The path can also be overridden with `ISTUDIO_UNREAL_RUNTIME_EXE`.

## Local Viewport

When started, ISTUDIO launches the runtime with Pixel Streaming flags and embeds:

```text
http://127.0.0.1:4218
```

Override with `ISTUDIO_PIXEL_STREAMING_URL` if the bundled signalling server uses a different loopback URL.

## Command Bridge

If `ISTUDIO_UNREAL_CONTROL_URL` is set, ISTUDIO posts scene commands to that endpoint:

```json
{
  "type": "scene.update",
  "scene": {}
}
```

The Unreal runtime should accept JSON commands for scene creation, object transforms, material changes, sky/lighting, camera framing, and still rendering.

## Output

ISTUDIO stores Virtual Set project data under:

```text
projects/<project>/virtual-set/scenes/
projects/<project>/virtual-set/assets/
projects/<project>/virtual-set/renders/
projects/<project>/virtual-set/thumbnails/
```

Renders can be sent to Reference Edit as the main reference image or as a controlled virtual background.
