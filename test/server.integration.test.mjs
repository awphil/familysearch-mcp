import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFamilySearchServer } from "../build/server.js";

test("MCP server exposes only the intended secure tool surface", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "familysearch-mcp-"));
  const previous = process.env.FAMILYSEARCH_MCP_CONFIG_DIR;
  process.env.FAMILYSEARCH_MCP_CONFIG_DIR = directory;

  const server = createFamilySearchServer();
  const client = new Client(
    { name: "security-test-client", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "auth-status",
      "begin-auth",
      "configure",
      "get-ancestors",
      "get-current-user",
      "get-descendants",
      "get-person",
      "logout",
      "search-persons",
    ]);
    assert.equal(names.includes("authenticate"), false);
    assert.equal(names.includes("search-records"), false);

    const status = await client.callTool({ name: "auth-status", arguments: {} });
    assert.match(status.content[0].text, /Not authenticated/);

    const unsafeConfig = await client.callTool({
      name: "configure",
      arguments: {
        clientId: "test-key",
        redirectUri: "http://example.com:57938/callback",
        environment: "beta",
      },
    });
    assert.equal(unsafeConfig.isError, true);
    assert.match(unsafeConfig.content[0].text, /callback host/);
  } finally {
    await client.close();
    await server.close();
    if (previous === undefined) {
      delete process.env.FAMILYSEARCH_MCP_CONFIG_DIR;
    } else {
      process.env.FAMILYSEARCH_MCP_CONFIG_DIR = previous;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
