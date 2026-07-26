import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import type { FamilySearchEnvironment } from "./endpoints.js";

export const DEFAULT_REDIRECT_URI =
  "http://127.0.0.1:57938/familysearch-auth";

const configSchema = z.object({
  clientId: z.string().trim().min(1).max(200),
  redirectUri: z.url(),
  environment: z.enum(["beta", "production"]),
});

export interface AppConfig {
  clientId: string;
  redirectUri: string;
  environment: FamilySearchEnvironment;
}

export interface ConfigLoadResult {
  config: AppConfig | null;
  removedLegacySecrets: boolean;
}

function resolveConfigDir(): string {
  const override = process.env.FAMILYSEARCH_MCP_CONFIG_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(os.homedir(), ".familysearch-mcp");
}

export function getConfigPath(): string {
  return path.join(resolveConfigDir(), "config.json");
}

function ensureConfigDir(): void {
  fs.mkdirSync(resolveConfigDir(), { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(resolveConfigDir(), 0o700);
  } catch {
    // Windows ACLs do not map cleanly to POSIX modes.
  }
}

export function validateConfig(input: unknown): AppConfig {
  return configSchema.parse(input);
}

export function saveConfig(config: AppConfig): void {
  const validated = validateConfig(config);
  ensureConfigDir();
  const configPath = getConfigPath();
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  const body = `${JSON.stringify(validated, null, 2)}\n`;

  fs.writeFileSync(temporaryPath, body, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  try {
    fs.renameSync(temporaryPath, configPath);
    try {
      fs.chmodSync(configPath, 0o600);
    } catch {
      // Windows ACLs do not map cleanly to POSIX modes.
    }
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export function loadConfig(): ConfigLoadResult {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return { config: null, removedLegacySecrets: false };
  }

  const parsed: unknown = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("FamilySearch MCP config must be a JSON object.");
  }

  const record = parsed as Record<string, unknown>;
  const removedLegacySecrets = [
    "username",
    "password",
    "accessToken",
    "refreshToken",
    "clientSecret",
  ].some((key) => key in record);

  const candidate = {
    clientId: record.clientId,
    redirectUri: record.redirectUri ?? DEFAULT_REDIRECT_URI,
    environment: record.environment ?? "beta",
  };
  const config = validateConfig(candidate);

  if (removedLegacySecrets) {
    saveConfig(config);
  }

  return { config, removedLegacySecrets };
}
