import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DEFAULT_REDIRECT_URI,
  loadConfig,
  saveConfig,
  validateConfig,
  type AppConfig,
} from "./config.js";
import { FamilySearchApi } from "./familysearch-api.js";
import {
  FAMILYSEARCH_DATA_NOTICE,
  formatAncestors,
  formatDescendants,
  formatPersonDetails,
  formatSearchEntry,
  safeText,
} from "./formatters.js";
import { OAuthManager, validateLoopbackRedirectUri } from "./oauth.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(error: unknown): ToolResult {
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred.";
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

const personIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9-]+$/, "Person ID contains invalid characters.");
const shortSearchText = z.string().trim().min(1).max(200);

export function createFamilySearchServer(): McpServer {
  let config: AppConfig | null = null;
  const loaded = loadConfig();
  config = loaded.config;
  if (loaded.removedLegacySecrets) {
    console.error(
      "Removed legacy plaintext FamilySearch credentials and tokens from config.json.",
    );
  }

  const oauth = new OAuthManager();
  const api = new FamilySearchApi(
    () => {
      if (!config) {
        throw new Error("Configure a FamilySearch application first.");
      }
      return config;
    },
    () => oauth.getAccessToken(),
  );
  const includeLiving =
    process.env.FAMILYSEARCH_INCLUDE_LIVING?.toLowerCase() === "true";

  const server = new McpServer({
    name: "familysearch-mcp-secure",
    version: "2.0.0",
  });

  server.registerTool(
    "configure",
    {
      description:
        "Configure a non-secret FamilySearch app key and loopback OAuth callback. This never accepts a username, password, client secret, or token.",
      inputSchema: {
        clientId: z.string().trim().min(1).max(200),
        redirectUri: z
          .url()
          .optional()
          .describe(
            `Pre-registered loopback callback; defaults to ${DEFAULT_REDIRECT_URI}`,
          ),
        environment: z.enum(["beta", "production"]).default("beta"),
      },
    },
    async ({ clientId, redirectUri, environment }) => {
      try {
        if (config) {
          await oauth.logout(config);
        }
        const nextConfig = validateConfig({
          clientId,
          redirectUri: redirectUri ?? DEFAULT_REDIRECT_URI,
          environment,
        });
        validateLoopbackRedirectUri(nextConfig.redirectUri);
        saveConfig(nextConfig);
        config = nextConfig;
        return textResult(
          `FamilySearch ${environment} configuration saved. No password or token was stored.`,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "begin-auth",
    {
      description:
        "Start FamilySearch browser login using OAuth Authorization Code with PKCE. The MCP server never sees the FamilySearch password.",
      inputSchema: {},
    },
    async () => {
      try {
        if (!config) {
          throw new Error(
            "Run configure with your FamilySearch app key before beginning authentication.",
          );
        }
        const result = await oauth.begin(config);
        return textResult(
          [
            "Open this FamilySearch authorization URL in your browser:",
            result.authorizationUrl,
            "",
            `The local callback expires at ${new Date(result.expiresAt).toISOString()}.`,
            "After approving access, call auth-status.",
          ].join("\n"),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "auth-status",
    {
      description:
        "Check whether the in-memory FamilySearch OAuth session is authenticated.",
      inputSchema: {},
    },
    async () => {
      const state = oauth.getState();
      if (state.status === "authenticated") {
        return textResult(
          `Authenticated in memory since ${new Date(state.authenticatedAt).toISOString()}. The token will not survive an MCP server restart.`,
        );
      }
      if (state.status === "waiting") {
        return textResult(
          `Waiting for browser authorization until ${new Date(state.expiresAt).toISOString()}.`,
        );
      }
      if (state.status === "error") {
        return errorResult(new Error(state.message));
      }
      return textResult("Not authenticated.");
    },
  );

  server.registerTool(
    "logout",
    {
      description:
        "Invalidate the active FamilySearch token when possible and always clear it from memory.",
      inputSchema: {},
    },
    async () => {
      try {
        if (config) {
          await oauth.logout(config);
        }
        return textResult("The FamilySearch session was cleared.");
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get-current-user",
    {
      description:
        "Read a minimal current-user profile. Email and other unnecessary account fields are omitted.",
      inputSchema: {},
    },
    async () => {
      try {
        const payload = await api.get(
          "/platform/users/current",
          {},
          "application/x-fs-v1+json, application/json",
        );
        const user = payload?.users?.[0];
        if (!user) {
          return textResult("FamilySearch did not return a current user.");
        }
        return textResult(
          [
            FAMILYSEARCH_DATA_NOTICE,
            `Name: ${safeText(user.displayName ?? user.fullName ?? user.contactName) || "Unknown"}`,
            `User ID: ${safeText(user.id, 80) || "Unknown"}`,
            `Tree person ID: ${safeText(user.personId, 80) || "Unknown"}`,
          ].join("\n"),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "search-persons",
    {
      description:
        "Search the FamilySearch Family Tree. Results are read-only, bounded, sanitized, and living people are redacted by default.",
      inputSchema: {
        givenName: shortSearchText.optional(),
        surname: shortSearchText.optional(),
        birthDate: shortSearchText.optional(),
        birthPlace: shortSearchText.optional(),
        deathDate: shortSearchText.optional(),
        deathPlace: shortSearchText.optional(),
        gender: z.enum(["Male", "Female"]).optional(),
        limit: z.number().int().min(1).max(25).default(10),
      },
    },
    async (params) => {
      try {
        if (
          !params.givenName &&
          !params.surname &&
          !params.birthDate &&
          !params.birthPlace &&
          !params.deathDate &&
          !params.deathPlace
        ) {
          throw new Error("Provide at least one person-search field.");
        }
        const payload = await api.get(
          "/platform/tree/search",
          {
            "q.givenName": params.givenName,
            "q.surname": params.surname,
            "q.birthLikeDate": params.birthDate,
            "q.birthLikePlace": params.birthPlace,
            "q.deathLikeDate": params.deathDate,
            "q.deathLikePlace": params.deathPlace,
            "q.sex": params.gender,
            count: params.limit,
          },
          "application/x-gedcomx-atom+json, application/json",
        );
        const entries: any[] = Array.isArray(payload?.entries)
          ? payload.entries
          : [];
        const formatted = entries
          .slice(0, params.limit)
          .map((entry) => formatSearchEntry(entry, includeLiving))
          .filter((entry): entry is string => Boolean(entry));
        if (formatted.length === 0) {
          return textResult("No matching FamilySearch persons were returned.");
        }
        return textResult(
          [
            FAMILYSEARCH_DATA_NOTICE,
            "",
            ...formatted.map((entry, index) => `${index + 1}. ${entry}`),
          ].join("\n\n"),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get-person",
    {
      description:
        "Read one FamilySearch person by ID. Living people are redacted by default.",
      inputSchema: {
        personId: personIdSchema,
      },
    },
    async ({ personId }) => {
      try {
        const payload = await api.get(
          `/platform/tree/persons/${encodeURIComponent(personId)}`,
        );
        const person = payload?.persons?.[0];
        if (!person) {
          return textResult(`No FamilySearch person was returned for ${personId}.`);
        }
        return textResult(
          `${FAMILYSEARCH_DATA_NOTICE}\n\n${formatPersonDetails(person, includeLiving)}`,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get-ancestors",
    {
      description:
        "Read a bounded ancestor tree. This is read-only and redacts living people by default.",
      inputSchema: {
        personId: personIdSchema,
        generations: z.number().int().min(1).max(8).default(4),
      },
    },
    async ({ personId, generations }) => {
      try {
        const payload = await api.get("/platform/tree/ancestry", {
          person: personId,
          generations,
        });
        return textResult(
          `${FAMILYSEARCH_DATA_NOTICE}\n\n${formatAncestors(payload, personId, generations, includeLiving)}`,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get-descendants",
    {
      description:
        "Read a bounded descendant tree. This is read-only and redacts living people by default.",
      inputSchema: {
        personId: personIdSchema,
        generations: z.number().int().min(1).max(3).default(2),
      },
    },
    async ({ personId, generations }) => {
      try {
        const payload = await api.get("/platform/tree/descendancy", {
          person: personId,
          generations,
        });
        return textResult(
          `${FAMILYSEARCH_DATA_NOTICE}\n\n${formatDescendants(payload, personId, generations, includeLiving)}`,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
