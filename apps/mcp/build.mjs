import { chmod } from "node:fs/promises";
import { build } from "esbuild";

// The workspace packages are TypeScript sources with no build step, so they are bundled into one
// file. Third-party packages stay external and are installed as dependencies: the SDK and zod are
// large, and @jsquash/webp loads its .wasm from its own folder at runtime.
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["@modelcontextprotocol/sdk", "@modelcontextprotocol/sdk/*", "zod", "@jsquash/webp", "@jsquash/webp/*"],
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  logLevel: "info"
});

await chmod("dist/index.js", 0o755);
