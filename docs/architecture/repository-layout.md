# Repository layout

Create this layout in Phase 0. Do not create empty crates ahead of the phase that fills them.

```text
stiksound/
├── apps/
│   ├── desktop/                  # Tauri 2 shell and thin React bootstrap
│   │   └── src-tauri/
│   ├── extension/                # Manifest V3, editor tab, service worker
│   └── mcp/                      # MCP server over stdio for AI agents
├── packages/
│   ├── core/                     # domain, use cases, schema validation
│   ├── providers/                # MyInstants provider and URL policy
│   ├── media-web/                # WebMediaEngine
│   ├── media-node/               # NodeMediaEngine on the local FFmpeg
│   └── ui/                       # editor components and locales
├── crates/
│   ├── image-engine/
│   ├── audio-engine/
│   └── project-store/
├── fixtures/
│   ├── images/
│   ├── audio/
│   └── myinstants/               # saved HTML pages, no network in CI
├── docs/                         # this documentation
├── package.json                  # workspace root
├── pnpm-workspace.yaml
├── Cargo.toml                    # virtual manifest for crates and src-tauri
└── README.md
```

## Boundary rules

- `packages/core` does not import Tauri, Chrome, React, or ffmpeg.
- `packages/media-node` is the only package that starts a process. It imports `packages/core` and the pure helpers of `packages/media-web`, and nothing from `apps/*`.
- `apps/mcp` imports no UI package and no crate. Its tools call the use cases in `packages/core`.
- `packages/ui` may import `packages/core` types and calls use cases through an interface the shell implements.
- `apps/extension` does not import `apps/desktop` or any crate.
- `crates/*` do not parse React state. They accept the data transfer objects defined in `packages/core` and mirrored in Rust. A schema test fails if the two descriptions of the manifest drift. The JSON Schema file in `docs/specifications/schemas` is the source of truth, and both sides generate or validate against it.
- `apps/desktop/src-tauri` is the composition root: it wires crates to Tauri commands.

## Build outputs

| Command intent | Output |
| --- | --- |
| Desktop debug | A runnable Windows or macOS app |
| Desktop release | An installer or disk image for the host OS |
| Extension debug | An unpacked extension directory |
| Extension release | A zip for Chrome |
| MCP server | `apps/mcp/dist/index.js`, one executable Node file |

CI runs unit tests on every change. Desktop packaging runs on the matching OS runner. The extension build runs on any runner.

## Names

Rust crates and npm packages use the prefix `stiksound-`. The user-facing name remains StikSound. The portable extension is `.stiksound.zip`.
