# ADR 005 — Node media engine and local MCP server

Date: 2026-11-25
Status: proposed

## Context

AI coding agents (Claude Code, Codex, Claude Desktop and others) can call local tools through the Model Context Protocol. A user who already works in one of them should be able to say "make a sound sticker from this image and this sound" and get the file, without opening the editor.

The use cases in `packages/core` do not depend on a shell: `ProjectController` takes a `MediaEngine` and a list of `SoundProvider`. The only engine that renders today is `WebMediaEngine`, and it needs WebCodecs, `OffscreenCanvas` and `decodeAudioData`. None of those exist in Node. The Rust crates probe and decode, but have no H.264, AAC or Opus encoder, and `crates/video-engine` only builds an FFmpeg argument list that nothing runs.

## Decision

- Add `packages/media-node` with `NodeMediaEngine`, a third implementation of `MediaEngine`.
- Add `apps/mcp`, a fourth shell: an MCP server over stdio that calls the same use cases.
- `NodeMediaEngine` runs the **FFmpeg found on the machine** (`ffmpeg` and `ffprobe` on `PATH`, or `STIKSOUND_FFMPEG` / `STIKSOUND_FFPROBE`). StikSound does not download, bundle or redistribute FFmpeg.
- FFmpeg is always started with an argument array built in code. No shell is involved, and the only free-form values (paths the engine creates in its own temp directory, and a `#RRGGBB` color checked against a pattern) cannot inject options.
- Static WebP is encoded with libwebp compiled to WebAssembly (`@jsquash/webp`, Apache-2.0), because many FFmpeg builds ship without libwebp. This is the WebAssembly encoder ADR 002 already allows.
- Everything that is pure TypeScript is reused from `packages/media-web`: header sniffing, trim and resample, waveform peaks, the WAV writer.
- The server exposes three tools: `probe_media`, `create_sound_sticker` and `export_project`. It takes absolute file paths and writes to a folder, by default `~/Downloads/StikSound`, without replacing existing files.
- MyInstants is the only network destination, through the existing `MyInstantsProvider`. The server injects a fetch that resolves the host first and refuses private and reserved addresses, the check the desktop app does in Rust.
- Every export result carries the caveat from the WhatsApp specification: the file is a video or a pair of files, not a WhatsApp sticker with sound. `native-sound-sticker` stays disabled and is not offered by any tool.

## Consequences

- Three engines must agree. The Node engine has end-to-end tests that drive `ProjectController` and check the acceptance properties (dimensions, alpha, duration, size limit), as the architecture asks for parity tests. They do not compare bytes with the web engine.
- The MCP server needs FFmpeg installed. The desktop app, the extension and the web app still need nothing; the README says so for each.
- Output differs from the web engine in ways the properties allow: stills are encoded at 25 fps instead of 10 so the file length stays within the 50 ms tolerance, and the sound bundle contains real Ogg Opus.
- Codec availability depends on the local FFmpeg build. MP4 needs any H.264 encoder (libx264, VideoToolbox, OpenH264 or Media Foundation); WebM with alpha needs libvpx-vp9. A missing encoder is reported as `unsupported-codec`.
- A local MCP server reads files on disk. It cannot see an image attached to a chat; the user or the agent has to give a path.
- The server is built from the repository (`npm run build --workspace=@stiksound/mcp`). Publishing it to npm is a separate decision.

## Alternatives rejected

- Bundle FFmpeg (for example `ffmpeg-static`). Simpler install, but it puts GPL binaries in a MIT OR Apache-2.0 project and a large download in a small tool.
- A Rust binary on top of the existing crates. They lack the encoders, so it would call FFmpeg as well, and it would duplicate the use cases that already exist in TypeScript.
- Drive `WebMediaEngine` in a headless Chromium. It reuses the engine, at the cost of shipping or requiring a browser and of real-time capture paths that are slow and hard to test.
- Add MyInstants search as a tool. The MyInstants specification excludes search in v1; an agent can find a URL with its own web search and pass it in.
