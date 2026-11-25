import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";

// stdout carries the protocol; anything meant for a human goes to stderr.
async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  process.stderr.write(`stiksound-mcp failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
