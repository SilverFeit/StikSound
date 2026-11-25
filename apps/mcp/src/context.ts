import { ProjectController, type SoundProvider } from "@stiksound/core";
import { NodeMediaEngine } from "@stiksound/media-node";
import { MyInstantsProvider } from "@stiksound/providers";
import { copyFileToClipboard, type ClipboardCopier } from "./clipboard";
import { defaultOutputDir } from "./files";
import { createGuardedFetch } from "./guarded-fetch";

/** Everything a tool needs. Tests replace the parts that touch the network, clipboard or home folder. */
export interface ServerContext {
  engine: NodeMediaEngine;
  controller: ProjectController;
  /** Folder for exports when a call does not pass `output_dir`. */
  outputDir: string;
  copyToClipboard: ClipboardCopier;
}

export interface ServerOptions {
  engine?: NodeMediaEngine;
  providers?: SoundProvider[];
  outputDir?: string;
  copyToClipboard?: ClipboardCopier;
}

export function createContext(options: ServerOptions = {}): ServerContext {
  const engine = options.engine ?? new NodeMediaEngine();
  const providers = options.providers ?? [new MyInstantsProvider(createGuardedFetch())];
  return {
    engine,
    controller: new ProjectController(engine, providers),
    outputDir: options.outputDir ?? defaultOutputDir(),
    copyToClipboard: options.copyToClipboard ?? copyFileToClipboard
  };
}
