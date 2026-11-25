import { chmod, copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(cliDir, "dist");
const outFile = path.join(distDir, "cli.mjs");

// Bundle all workspace TypeScript sources into one ESM entry file.
// Runtime third-party packages stay external: @jsquash/webp loads its .wasm relative to its
// package directory, and @modelcontextprotocol/sdk + zod are only imported when `stiksound mcp` runs.
await build({
  entryPoints: [path.join(cliDir, "src/index.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: [
    "@modelcontextprotocol/sdk",
    "@modelcontextprotocol/sdk/*",
    "zod",
    "@jsquash/webp",
    "@jsquash/webp/*"
  ],
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  logLevel: "info"
});

await chmod(outFile, 0o755).catch(() => undefined);

if (process.argv.includes("--pack-release")) {
  const stageDir = path.join(cliDir, "dist-release", "stiksound-cli");
  const binDir = path.join(stageDir, "bin");
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(binDir, { recursive: true });

  await copyFile(outFile, path.join(stageDir, "cli.mjs"));
  await copyFile(path.join(cliDir, "README.md"), path.join(stageDir, "README.md"));

  // Minimal package.json so Node treats cli.mjs cleanly and npm/tools can inspect version.
  const pkg = JSON.parse(await (await import("node:fs/promises")).readFile(path.join(cliDir, "package.json"), "utf8"));
  await writeFile(
    path.join(stageDir, "package.json"),
    JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        license: pkg.license,
        type: "module",
        bin: { stiksound: "./cli.mjs" }
      },
      null,
      2
    ) + "\n"
  );

  // POSIX shell launcher (macOS & Linux)
  const shLauncher = path.join(binDir, "stiksound");
  await writeFile(
    shLauncher,
    [
      "#!/usr/bin/env sh",
      'DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"',
      'exec node "$DIR/cli.mjs" "$@"'
    ].join("\n") + "\n"
  );
  await chmod(shLauncher, 0o755).catch(() => undefined);

  // Windows batch launcher
  const cmdLauncher = path.join(binDir, "stiksound.cmd");
  await writeFile(
    cmdLauncher,
    ["@echo off", 'node "%~dp0..\\cli.mjs" %*'].join("\r\n") + "\r\n"
  );

  // Copy only the external runtime dependencies if a pre-installed production node_modules exists
  const prodModules = path.join(cliDir, "dist-release", "prod_modules");
  try {
    await cp(prodModules, path.join(stageDir, "node_modules"), { recursive: true });
  } catch {
    // When running locally without staged prod_modules, skip copying node_modules.
  }
}
