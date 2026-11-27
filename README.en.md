<div align="center">

<img src="docs/assets/app-icon.svg" alt="StikSound App Icon" width="120" height="120" />

# StikSound

**Create 5s or 10s sound videos (with an on-screen toggle) from a PNG, JPG, WebP, or animated GIF: paste your sticker, pick a local audio file or a MyInstants link, trim the exact clip, and export everything 100% locally.**

[![Use on the Web](https://img.shields.io/badge/Use%20on%20the%20Web-GitHub%20Pages-0ea5e9?style=for-the-badge&logo=githubpages&logoColor=white)](https://silverfeit.github.io/StikSound/)
[![Download](https://img.shields.io/github/v/release/SilverFeit/StikSound?style=for-the-badge&label=Download&color=25D366)](https://github.com/SilverFeit/StikSound/releases/latest)

[![Platforms](https://img.shields.io/badge/Platforms-Web%20%7C%20Windows%20%7C%20macOS%20%7C%20Chrome%20%7C%20CLI%20%26%20MCP-25D366?style=flat-square)](#web-version-vs-install)
[![Local Processing](https://img.shields.io/badge/Processing-100%25%20local-10b981?style=flat-square)](#privacy--security)
[![License](https://img.shields.io/badge/License-MIT%20OR%20Apache--2.0-6366f1?style=flat-square)](LICENSE-MIT)

[**Use on the Web**](https://silverfeit.github.io/StikSound/) · [**Download**](https://github.com/SilverFeit/StikSound/releases/latest) · [**CLI & AI MCP**](#-headless-cli--local-mcp-server-ai-stickers) · [**Step-by-Step Guide**](#step-by-step-guide) · [**How It Works**](#how-it-works-internally) · [**Development**](#development)

**🌐 Idioma / Language / Idioma:** [**🇪🇸 Español (Principal)**](README.md) · **🇺🇸 English** · [**🇧🇷 Português**](README.pt.md)

</div>

---

## 🌐 Web Version vs. Install

You can use **StikSound directly in your browser** with zero installation (works on PC, Android, and iPhone as a PWA), with one difference regarding **MyInstants**:

> [!IMPORTANT]
> **Web Version ([silverfeit.github.io/StikSound](https://silverfeit.github.io/StikSound/)):** works **only with audio files already downloaded** on your device (`MP3`, `WAV`, `M4A`, `OGG`, `AAC`) or the audio track of a short video clip.
>
> **Want to paste direct MyInstants links?** Because of browser CORS security rules, MyInstants blocks direct downloads from static web pages. To paste MyInstants URLs directly, **install** the [Desktop app (Windows/macOS) or Chrome Extension](https://github.com/SilverFeit/StikSound/releases/latest) — or download the MP3 from MyInstants first and pick it in the web app.

| Feature | 🌐 Web Version (GitHub Pages) | 💻 Desktop App / 🧩 Chrome Extension | ⌨️ CLI / 🤖 Local MCP |
| --- | :---: | :---: | :---: |
| **Installation required** | ❌ None ([open now](https://silverfeit.github.io/StikSound/)) | ✅ [Download release](https://github.com/SilverFeit/StikSound/releases/latest) | ✅ `StikSound-*-cli.zip` + Node 22 & FFmpeg |
| **100% local processing** | ✅ | ✅ | ✅ |
| **PNG / JPG / WebP / GIF stickers** | ✅ | ✅ | ✅ |
| **Short video clips (`MP4`, `MOV`, `WebM`) as source** | ✅ | — | ✅ |
| **Text-generated stickers (`--text`)** | — | — | ✅ |
| **`5s \| 10s` duration toggle** | ✅ | ✅ | ✅ |
| **Downloaded local audio files** | ✅ | ✅ | ✅ |
| **Paste direct MyInstants URLs** | ❌ *(download MP3 first)* | ✅ | ✅ |
| **Search MyInstants sounds (`search`)** | — | — | ✅ |
| **Transparent WebM export** | ❌ *(MP4 only on web/mobile)* | ✅ | ✅ |
| **AI assistant integration (MCP)** | — | — | ✅ *(Claude, Gemini, Codex, Cursor, VS Code)* |

---

## What StikSound Does

StikSound combines **a square image** and **an audio clip** into a downloadable or copyable file. The maximum clip duration is controlled via the `5s | 10s` toggle (10 seconds by default). Everything runs locally on your device without uploading files to any external server.

- Supports **PNG, JPG/JPEG, WebP, and GIF** inputs (plus `MP4`, `MOV`, `WebM` clips on Web).
- Decodes **animated GIFs** frame by frame and loops them seamlessly across the exported video duration.
- Accepts local **MP3, WAV, OGG, M4A, or AAC** audio, or validated **MyInstants** links (Desktop & Chrome Extension).
- Supports **9 built-in UI languages** (`ES`, `EN`, `PT`, `FR`, `DE`, `IT`, `RU`, `ZH`, `AR`) selectable in the `⋯` menu.
- Exports compatible **MP4**, transparent **WebM**, portable **`.stiksound.zip`** bundles/projects, or static **WebP** (`<= 100 KB`).

> [!WARNING]
> **Current WhatsApp compatibility (where & how to upload):**
> - **As of today, uploading the exported MP4 as a sound sticker only works directly on Android with WhatsApp Beta**, and **does not work on any other device or platform** (not on **WhatsApp Desktop for Windows/macOS** —neither stable nor beta—, not on **WhatsApp Web**, and not on **iPhone / iOS**).
> - Even if you are an Android *Beta tester*, Meta rolls this feature out **gradually per account server-side**: if your account does not have the experiment enabled yet, WhatsApp will not allow creating a sound sticker from video.
> - **How to try on Android Beta:** save the MP4 to your gallery → open a chat in WhatsApp Android Beta → Stickers icon → **Create** (`+`) → pick the MP4 video from your gallery. Pasting or sharing the MP4 straight into a chat sends it as a regular short video.
> - The `native-sound-sticker` profile remains disabled because WhatsApp does not yet offer a public API for native sound stickers.

---

## Step-by-Step Guide

1. **Load a sticker:** Paste with `Ctrl + V` / `Cmd + V`, drag & drop, or click the center stage (`PNG`, `JPG`, `WebP`, `GIF`; plus short video clips on Web).
2. **Frame 1:1 crop:** Non-square inputs are centered automatically; move your mouse (or drag with your finger on mobile) to reposition the `1:1` crop up to `512 × 512 px` without upscaling.
3. **Add audio:** Drop an audio file, click **Audio**, or paste a valid MyInstants URL (Desktop/Extension). Source limits: max `25 MB` and `3 minutes`; export selection between `0.1 s` and `5 s` or `10 s` (for animated GIFs, the minimum duration is 1 GIF loop up to the active cap).
4. **Adjust trim & background:** Click the waveform or drag the trim slider, preview playback, and choose **Transparent** (WebM) or **White / Black / Custom color** (MP4) when alpha is present.
5. **Preview, copy, or download:** Use `➔` to render and copy/share, `⬇` to pick an explicit export format, `⋯` for project save/open, language selection, and About/licenses, and `✕` to reset.

---

<details>
<summary><strong>For advanced users: headless CLI, local MCP server, internals, and repository layout</strong> (click to expand)</summary>

## 🤖 Headless CLI & Local MCP Server (AI Stickers)

StikSound ships a **cross-platform CLI** (`macOS`, `Windows`, `Linux`) with a built-in **local MCP (Model Context Protocol) server** (`stiksound mcp`) so you can build stickers from the terminal or directly from an AI assistant while keeping all media processing local.

> [!NOTE]
> Desktop, Chrome Extension, and Web **do not bundle or require FFmpeg**. The CLI is distributed separately (`StikSound-*-cli.zip`) and requires **Node.js 22+** and **FFmpeg**. See [apps/cli/README.md](apps/cli/README.md) for full CLI flags.

### MCP Tools Exposed Locally (`stiksound mcp`)

| MCP Tool | Kind | Purpose |
| --- | :---: | --- |
| `search_sounds` | Read | Searches `myinstants.com` by keyword or description (`query`, `limit`, `locale`) under the strict HTTPS/SSRF allowlist and returns titles + `page_url` links. |
| `create_sound_sticker` | Write | Combines a local visual file (`image_path`) **or locally rendered text** (`text`, `text_style`: `meme` \| `card` \| `minimal`, `text_color`, `background_color`, `transparent_background`) with `audio_path` or `myinstants_url`, `trim: "loudest"`, `max_duration_s: 5 \| 10`, profiles (`video-mp4`, `video-webm-alpha`, `sound-bundle`, `standard-webp`), `save_project`, and clipboard copy. |
| `probe_media` | Read | Inspects an image, GIF, video, audio file, or `.stiksound.zip` project (dimensions, crop, loudest 5s/10s windows, and WebP preview). |
| `export_project` | Write | Reopens a saved `.stiksound.zip` project and re-exports it with another profile or duration. |
| `check_environment` | Read | Runs `doctor` to report FFmpeg, encoder (H.264/AAC/VP9/Opus), WebP WASM, and text-renderer availability. |

### ✨ Creating Stickers with AI from a Single Prompt

- **Describe an emote/character + sound:**
  > `"usa @Stiksound quiero un stiker en mp4 de 10 segundos de dio brando con el sonido de omae-wa-mo-shinderu"`
  >
  > Because you only described the character without giving an image or asking to fetch one from the web, the AI assistant **generates the image using its own image model** (or uses `text` for text-only meme cards), searches the sound with `search_sounds`, and calls `create_sound_sticker` with `profile: "video-mp4"`, `max_duration_s: 10`, and `trim: "loudest"`.
- **Ask explicitly for a web GIF/image (or pass a local file):**
  > `"Stiksound ahora hazlo pero con un gif de dio brando que encuentres en web"`
  >
  > When you explicitly request a GIF/image from the web (or provide your own file path), the assistant skips AI image generation, passes that file's absolute path in `image_path`, and StikSound loops the GIF across the 10-second MP4 synced with the MyInstants audio.

### 🔌 Connecting StikSound MCP to Popular Apps

Every code block below has GitHub's native **Copy** button in the top-right corner *(GitHub strips custom HTML/JS buttons for security)*. You can also run `stiksound mcp --print-config` in your terminal to output ready-to-paste configs with your exact binary path.

#### Standard `mcpServers` JSON (`Claude Desktop`, `Gemini CLI`, `Antigravity`, `Cursor`, `Windsurf`)

```json
{
  "mcpServers": {
    "stiksound": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/stiksound-cli/cli.mjs",
        "mcp"
      ]
    }
  }
}
```

Config file locations: **Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows) · **Gemini CLI** (`~/.gemini/settings.json`) · **Antigravity** (`~/.gemini/antigravity/mcp_config.json`) · **Cursor** (`~/.cursor/mcp.json`).

#### Claude Code / Gemini CLI / OpenAI Codex CLI / VS Code

```bash
# Claude Code
claude mcp add stiksound --scope user -- node "/ABSOLUTE/PATH/stiksound-cli/cli.mjs" mcp

# Gemini CLI
gemini mcp add stiksound node "/ABSOLUTE/PATH/stiksound-cli/cli.mjs" mcp

# OpenAI Codex CLI
codex mcp add stiksound -- node "/ABSOLUTE/PATH/stiksound-cli/cli.mjs" mcp
```

**Codex (`~/.codex/config.toml`):**

```toml
[mcp_servers.stiksound]
command = "node"
args = ["/ABSOLUTE/PATH/stiksound-cli/cli.mjs", "mcp"]
```

**VS Code / GitHub Copilot (`.vscode/mcp.json`):**

```json
{
  "servers": {
    "stiksound": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/stiksound-cli/cli.mjs",
        "mcp"
      ]
    }
  }
}
```

> [!NOTE]
> **About ChatGPT (web / desktop):** ChatGPT cloud connectors currently only support remote HTTPS MCP servers and cannot spawn local `stdio` processes directly. To use GPT models with StikSound's local MCP server, use **OpenAI Codex CLI**, **VS Code / GitHub Copilot**, or **Cursor**.

---

## How It Works Internally

- **Image & GIF pipeline:** Sniffs actual file magic bytes, enforces decompression-bomb and GIF memory/frame limits (`300` frames max, `64 MiB` canvas, `256 MiB` aggregate RGBA), computes 1:1 crop, and schedules looping GIF frames matched to browser preview delays.
- **Audio pipeline:** Decodes audio, mixes to mono, computes 1024 waveform peak buckets, trims integer `start_ms`–`end_ms`, and resamples to **48 kHz mono**.
- **Video encoding:** Uses **WebCodecs (`VideoEncoder` + `AudioEncoder`) + pure-TS `mp4-muxer` / `webm-muxer`** when supported, falling back to **Canvas + `MediaRecorder`** where needed.

---

## Repository Layout

```text
apps/
  cli/           Headless CLI (Node 22 + FFmpeg) & local MCP server (`stiksound mcp`)
  desktop/       Tauri app for Windows/macOS
  extension/     Chrome Manifest V3 extension
  web/           Web App / PWA deployed on GitHub Pages
packages/
  core/          Project model, invariants, validation & use cases
  ui/            Shared React editor, trim bar & 9-language i18n
  media-web/     TypeScript sniffing, decoding, trim, waveform, mux & ZIP
  providers/     MyInstants URL policy & resolution
crates/
  audio-engine/  Rust audio probing/decoding/trim
  image-engine/  Rust image/GIF probing & utilities
  video-engine/  Rust video validation & mux utilities
  project-store/ Rust atomic file & package store
docs/            App icons & third-party license notices (THIRD_PARTY.md)
```

</details>

---

## Installation

### Windows & macOS
1. Open [**Releases**](https://github.com/SilverFeit/StikSound/releases/latest).
2. Download the installer or binary for your platform (`windows-x64` or `macos-universal`).
3. Launch StikSound — no FFmpeg or external tools required. *(On macOS, right-click → **Open** if Gatekeeper prompts for an unsigned developer).*

### Chrome / Edge / Brave Extension
1. Download `StikSound-*-chrome-extension.zip` from [**Releases**](https://github.com/SilverFeit/StikSound/releases/latest) and unzip it.
2. Open `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, and select the extracted folder.

### CLI & Local MCP Server (macOS, Windows & Linux)
1. Install **Node.js 22+** and **FFmpeg** (`brew install ffmpeg`, `sudo apt install ffmpeg`, or `winget install Gyan.FFmpeg`).
2. Download `StikSound-*-cli.zip` from [**Releases**](https://github.com/SilverFeit/StikSound/releases/latest) and extract it.
3. Run `bin/stiksound doctor` (macOS/Linux) or `bin\stiksound.cmd doctor` (Windows), or `bin/stiksound mcp --print-config` to print MCP client templates.

---

## Privacy & Security

- Zero backend servers receive your images, videos, or audio files.
- All media processing runs locally on your device.
- The only network request is MyInstants resolution (Desktop & Chrome Extension only), restricted by strict HTTPS allowlist, redirect cap, IP filtering (blocking private/loopback ranges in Rust), and 25 MB / 20 s limits.

---

## Development

```bash
git clone https://github.com/SilverFeit/StikSound.git
cd StikSound
npm install
npm run typecheck
npm test
npm run build
cargo test --workspace --exclude stiksound-desktop
```

## License

Dual-licensed under either **MIT License** ([LICENSE-MIT](LICENSE-MIT)) or **Apache License, Version 2.0** ([LICENSE-APACHE](LICENSE-APACHE)), at your option (`MIT OR Apache-2.0`).
