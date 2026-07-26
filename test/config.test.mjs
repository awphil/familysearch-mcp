import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_REDIRECT_URI,
  getConfigPath,
  loadConfig,
  saveConfig,
} from "../build/config.js";

test("legacy plaintext credentials and tokens are removed on load", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "familysearch-mcp-"));
  const previous = process.env.FAMILYSEARCH_MCP_CONFIG_DIR;
  process.env.FAMILYSEARCH_MCP_CONFIG_DIR = directory;

  try {
    fs.writeFileSync(
      path.join(directory, "config.json"),
      JSON.stringify({
        clientId: "test-key",
        redirectUri: DEFAULT_REDIRECT_URI,
        environment: "beta",
        username: "should-not-remain",
        password: "should-not-remain",
        accessToken: "should-not-remain",
        refreshToken: "should-not-remain",
      }),
    );

    const loaded = loadConfig();
    assert.equal(loaded.removedLegacySecrets, true);
    assert.equal(loaded.config.clientId, "test-key");
    const rewritten = fs.readFileSync(getConfigPath(), "utf8");
    assert.doesNotMatch(rewritten, /username|password|accessToken|refreshToken/);
    assert.doesNotMatch(rewritten, /should-not-remain/);
  } finally {
    if (previous === undefined) {
      delete process.env.FAMILYSEARCH_MCP_CONFIG_DIR;
    } else {
      process.env.FAMILYSEARCH_MCP_CONFIG_DIR = previous;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("saved config contains only non-secret allowed fields", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "familysearch-mcp-"));
  const previous = process.env.FAMILYSEARCH_MCP_CONFIG_DIR;
  process.env.FAMILYSEARCH_MCP_CONFIG_DIR = directory;

  try {
    saveConfig({
      clientId: "test-key",
      redirectUri: DEFAULT_REDIRECT_URI,
      environment: "production",
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(getConfigPath(), "utf8")), {
      clientId: "test-key",
      redirectUri: DEFAULT_REDIRECT_URI,
      environment: "production",
    });
  } finally {
    if (previous === undefined) {
      delete process.env.FAMILYSEARCH_MCP_CONFIG_DIR;
    } else {
      process.env.FAMILYSEARCH_MCP_CONFIG_DIR = previous;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
