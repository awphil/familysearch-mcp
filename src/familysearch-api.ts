import type { AppConfig } from "./config.js";
import { getEndpoints } from "./endpoints.js";

export class FamilySearchApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "FamilySearchApiError";
  }
}

export type QueryValue = string | number | boolean | undefined;

export class FamilySearchApi {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly getConfig: () => AppConfig,
    private readonly getAccessToken: () => string | null,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.fetchImpl = fetchImpl;
  }

  async get(
    pathname: string,
    query: Record<string, QueryValue> = {},
    accept = "application/x-gedcomx-v1+json, application/json",
  ): Promise<any> {
    const token = this.getAccessToken();
    if (!token) {
      throw new FamilySearchApiError(
        401,
        "Not authenticated. Use begin-auth, complete the browser login, and check auth-status.",
      );
    }

    const config = this.getConfig();
    const { apiBaseUrl } = getEndpoints(config.environment);
    const url = new URL(pathname, apiBaseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: accept,
        Authorization: `Bearer ${token}`,
        "User-Agent": "familysearch-mcp-secure/2.0.0",
      },
      redirect: "follow",
    });

    if (response.status === 204) {
      return {};
    }
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: "FamilySearch rejected the request parameters.",
        401: "The FamilySearch session expired. Authenticate again.",
        403: "FamilySearch denied access to this resource.",
        404: "The requested FamilySearch resource was not found.",
        410: "The requested FamilySearch person was deleted or merged.",
        429: "FamilySearch rate-limited the request. Try again later.",
      };
      throw new FamilySearchApiError(
        response.status,
        messages[response.status] ??
          `FamilySearch returned HTTP ${response.status}.`,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) {
      throw new FamilySearchApiError(
        502,
        "FamilySearch returned an unexpected response format.",
      );
    }
    return response.json();
  }
}
