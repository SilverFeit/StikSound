# StikSound MCP server

A local [Model Context Protocol](https://modelcontextprotocol.io) server that lets an AI agent (Claude Code, Codex, Claude Desktop or any other MCP client) create StikSound sound stickers. It runs the same use cases as the apps, on your machine, over stdio.

```text
You:    make a sticker with ~/Pictures/cat.png and https://www.myinstants.com/en/instant/vine-boom-sound-70972/
Agent:  → probe_media, create_sound_sticker
        ~/Downloads/StikSound/cat-10s.mp4
```

> **The result is a file, not an installed WhatsApp sticker.** WhatsApp has no public format for stickers with sound. The MP4 is a video; see [docs/specifications/whatsapp.md](../../docs/specifications/whatsapp.md). Every export returns this caveat so the agent can pass it on.

## Requirements

- Node.js 22 or newer.
- **FFmpeg** (`ffmpeg` and `ffprobe`) installed and on `PATH`. The desktop app, the extension and the web app do not need it; this server does.

  | System | Command |
  | --- | --- |
  | macOS | `brew install ffmpeg` |
  | Debian / Ubuntu | `sudo apt install ffmpeg` |
  | Windows | `winget install Gyan.FFmpeg` |

  MP4 needs an H.264 encoder (libx264, VideoToolbox, OpenH264 or Media Foundation) and WebM with transparency needs libvpx-vp9. The usual packages include them.

## Build

The server is built from this repository. It is not published to npm.

```bash
git clone https://github.com/SilverFeit/StikSound.git
cd StikSound
npm install
npm run build --workspace=@stiksound/mcp
```

This writes `apps/mcp/dist/index.js`. Keep the repository in place: the file loads its dependencies from the repository's `node_modules`. The examples below use `/ABSOLUTE/PATH/StikSound` for the folder you cloned.

## Install in a client

### Claude Code

```bash
claude mcp add stiksound --scope user -- node /ABSOLUTE/PATH/StikSound/apps/mcp/dist/index.js
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.stiksound]
command = "node"
args = ["/ABSOLUTE/PATH/StikSound/apps/mcp/dist/index.js"]
```

### Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config) and restart the app:

```json
{
  "mcpServers": {
    "stiksound": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/StikSound/apps/mcp/dist/index.js"]
    }
  }
}
```

Claude Desktop does not give a local server the files you attach to a chat. Refer to files by their path on disk.

### Any other client

Start `node /ABSOLUTE/PATH/StikSound/apps/mcp/dist/index.js` as a stdio server.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `STIKSOUND_FFMPEG` | Path to a specific `ffmpeg`. Its sibling `ffprobe` is used unless the next variable is set. |
| `STIKSOUND_FFPROBE` | Path to a specific `ffprobe`. |

## Tools

All paths must be absolute or start with `~/`.

### `probe_media`

Inspects a file and writes nothing.

- Image, GIF or clip: format, size, transparency, animation, the square output size and a preview image of the crop. Pass `crop_x` / `crop_y` to preview another framing.
- Audio: duration, peak level, leading silence and the loudest 5 s and 10 s windows.

### `create_sound_sticker`

Creates the sticker in one call.

| Argument | Default | Meaning |
| --- | --- | --- |
| `image_path` | required | PNG, JPG, WebP, GIF, or a short MP4 / MOV / WebM clip |
| `audio_path` | | Local MP3, WAV, OGG, M4A or AAC (max 25 MB, 3 minutes) |
| `myinstants_url` | | A MyInstants page or direct sound URL, instead of `audio_path` |
| `start_ms`, `end_ms` | from 0 | The audio fragment |
| `trim` | `start` | Without `start_ms` / `end_ms`: `start` or `loudest` |
| `max_duration_s` | `10` | `5` or `10`, the app's duration switch |
| `volume` | `1` | 0 to 1 |
| `crop_x`, `crop_y` | `0.5` | Anchor of the 1:1 crop, 0 to 1 |
| `background_color` | `#FFFFFF` | Fill behind transparency in MP4 |
| `profile` | `video-mp4` | `video-mp4`, `video-webm-alpha`, `sound-bundle` or `standard-webp` |
| `name` | image file name | Project name; the output file name derives from it |
| `output_dir` | `~/Downloads/StikSound` | Destination folder |
| `save_project` | `false` | Also write an editable `.stiksound.zip` |
| `copy_to_clipboard` | `false` | Copy the result as a file (macOS and Windows) |

A video clip uses its own sound when no audio is given. An animated GIF loops for the whole fragment, and the fragment cannot be shorter than one loop of the GIF (up to the maximum duration).

Existing files are never replaced: a second export of `cat-10s.mp4` becomes `cat-10s-2.mp4`.

### `export_project`

Opens a `.stiksound.zip` saved by the apps or by `create_sound_sticker` and exports it with its stored crop and trim, optionally with another `profile`.

### Errors

A failed call returns a tool error with a code the agent can act on:

```json
{ "error": { "code": "trim-out-of-range", "message": "Selected duration 7000 ms must be within 100..5000 ms." } }
```

The codes are the ones the apps use (`unsupported-image`, `unsupported-audio`, `unsupported-codec`, `file-too-large`, `url-rejected`, `remote-unavailable`, `trim-out-of-range`, `sticker-too-large`, `package-invalid`, `encode-failed`), plus `invalid-input` for a bad path or a missing argument. A missing FFmpeg is reported as `unsupported-codec` with the install hint.

## Privacy and security

- Media is processed on your machine. Nothing is uploaded.
- The only network access is MyInstants, and only when a call passes `myinstants_url`. The existing URL policy applies (HTTPS, `myinstants.com` only, at most 2 redirects, 25 MB, 20 s), and the server refuses to connect when the host resolves to a private or reserved address.
- The server reads the files a call names and writes only to the output folder. It never overwrites a file.
- FFmpeg is started with an argument array built in code, never through a shell.
- Sounds from MyInstants belong to their owners. StikSound grants no license to them.

## Development

```bash
npm run typecheck --workspace=@stiksound/mcp
npx vitest run apps/mcp packages/media-node
```

The tests that render media need FFmpeg and are skipped without it. They generate their fixtures with FFmpeg's synthetic sources and never use the network. Design notes are in [ADR 005](../../docs/decisions/005-node-engine-and-mcp.md).
