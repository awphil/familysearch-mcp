#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createFamilySearchServer } from "./server.js";

async function main(): Promise<void> {
  const server = createFamilySearchServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("FamilySearch MCP secure server is running over stdio.");
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown fatal server error.";
  console.error(`Fatal error: ${message}`);
  process.exitCode = 1;
});
