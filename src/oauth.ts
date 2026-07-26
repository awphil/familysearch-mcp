import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import type { AppConfig } from "./config.js";
import { getEndpoints } from "./endpoints.js";

const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
}

export type AuthState =
  | { status: "idle" }
  | { status: "waiting"; expiresAt: number }
  | { status: "authenticated"; authenticatedAt: number; expiresAt?: number }
  | { status: "error"; message: string };

interface PendingFlow {
  state: string;
  verifier: string;
  server: http.Server;
  timer: NodeJS.Timeout;
}

export interface BeginAuthorizationResult {
  authorizationUrl: string;
  expiresAt: number;
}

export function createCodeVerifier(): string {
  return randomBytes(48).toString("base64url");
}

export function createCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function isLoopbackAddress(address: string | undefined): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

export function validateLoopbackRedirectUri(value: string): URL {
  const redirect = new URL(value);
  if (redirect.protocol !== "http:") {
    throw new Error("The OAuth callback must use an http loopback URI.");
  }
  if (
    redirect.hostname !== "127.0.0.1" &&
    redirect.hostname !== "localhost" &&
    redirect.hostname !== "[::1]"
  ) {
    throw new Error(
      "The OAuth callback host must be 127.0.0.1, localhost, or [::1].",
    );
  }
  if (!redirect.port || Number(redirect.port) < 1024) {
    throw new Error("The OAuth callback must use an explicit port above 1023.");
  }
  if (redirect.username || redirect.password || redirect.hash) {
    throw new Error("The OAuth callback URI contains unsupported components.");
  }
  return redirect;
}

export function buildAuthorizationUrl(
  config: AppConfig,
  state: string,
  challenge: string,
): string {
  const endpoints = getEndpoints(config.environment);
  const url = new URL(endpoints.authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", "openid");
  return url.toString();
}

export function statesMatch(expected: string, received: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const receivedBytes = Buffer.from(received, "utf8");
  return (
    expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes)
  );
}

function browserResponse(
  response: http.ServerResponse,
  statusCode: number,
  title: string,
  message: string,
): void {
  const escapedTitle = title.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const escapedMessage = message
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;");
  const body = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapedTitle}</title><body><h1>${escapedTitle}</h1><p>${escapedMessage}</p><p>You may close this tab.</p></body></html>`;
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  response.end(body);
}

export class OAuthManager {
  private accessToken: string | null = null;
  private authState: AuthState = { status: "idle" };
  private pending: PendingFlow | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  getState(): AuthState {
    return this.authState;
  }

  private clearPending(): void {
    if (!this.pending) {
      return;
    }
    clearTimeout(this.pending.timer);
    this.pending.server.close();
    this.pending = null;
  }

  async begin(config: AppConfig): Promise<BeginAuthorizationResult> {
    this.clearPending();
    this.accessToken = null;

    const redirect = validateLoopbackRedirectUri(config.redirectUri);
    const verifier = createCodeVerifier();
    const challenge = createCodeChallenge(verifier);
    const state = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + FLOW_TIMEOUT_MS;

    const server = http.createServer((request, response) => {
      void this.handleCallback(
        request,
        response,
        config,
        redirect,
        state,
        verifier,
      );
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      const hostname =
        redirect.hostname === "[::1]" ? "::1" : redirect.hostname;
      server.listen(Number(redirect.port), hostname);
    });

    const address = server.address() as AddressInfo | null;
    if (!address) {
      server.close();
      throw new Error("Could not start the local OAuth callback listener.");
    }

    const timer = setTimeout(() => {
      this.authState = {
        status: "error",
        message: "Authentication timed out. Start a new login.",
      };
      this.clearPending();
    }, FLOW_TIMEOUT_MS);
    timer.unref();

    this.pending = { state, verifier, server, timer };
    this.authState = { status: "waiting", expiresAt };

    return {
      authorizationUrl: buildAuthorizationUrl(config, state, challenge),
      expiresAt,
    };
  }

  private async handleCallback(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    config: AppConfig,
    redirect: URL,
    expectedState: string,
    verifier: string,
  ): Promise<void> {
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      browserResponse(response, 403, "Request rejected", "Non-local request.");
      return;
    }
    if (request.method !== "GET") {
      browserResponse(response, 405, "Request rejected", "Expected a GET request.");
      return;
    }

    const callbackUrl = new URL(
      request.url ?? "/",
      `http://${redirect.host}`,
    );
    if (callbackUrl.pathname !== redirect.pathname) {
      browserResponse(response, 404, "Not found", "Unexpected callback path.");
      return;
    }

    const returnedState = callbackUrl.searchParams.get("state") ?? "";
    if (!statesMatch(expectedState, returnedState)) {
      this.authState = {
        status: "error",
        message: "FamilySearch returned an invalid OAuth state value.",
      };
      browserResponse(
        response,
        400,
        "Authentication rejected",
        "The OAuth state did not match.",
      );
      this.clearPending();
      return;
    }

    const oauthError = callbackUrl.searchParams.get("error");
    if (oauthError) {
      this.authState = {
        status: "error",
        message: `FamilySearch declined authorization: ${oauthError}`,
      };
      browserResponse(
        response,
        400,
        "Authentication declined",
        "FamilySearch did not authorize this application.",
      );
      this.clearPending();
      return;
    }

    const code = callbackUrl.searchParams.get("code");
    if (!code) {
      this.authState = {
        status: "error",
        message: "FamilySearch did not return an authorization code.",
      };
      browserResponse(
        response,
        400,
        "Authentication failed",
        "No authorization code was returned.",
      );
      this.clearPending();
      return;
    }

    try {
      const token = await this.exchangeCode(config, code, verifier);
      this.accessToken = token.access_token;
      this.authState = {
        status: "authenticated",
        authenticatedAt: Date.now(),
        ...(token.expires_in
          ? { expiresAt: Date.now() + token.expires_in * 1000 }
          : {}),
      };
      browserResponse(
        response,
        200,
        "FamilySearch connected",
        "The local MCP server is authenticated.",
      );
    } catch (error) {
      this.authState = {
        status: "error",
        message:
          error instanceof Error ? error.message : "Token exchange failed.",
      };
      browserResponse(
        response,
        500,
        "Authentication failed",
        "The authorization code could not be exchanged.",
      );
    } finally {
      this.clearPending();
    }
  }

  async exchangeCode(
    config: AppConfig,
    code: string,
    verifier: string,
  ): Promise<TokenResponse> {
    const endpoints = getEndpoints(config.environment);
    const body = new URLSearchParams({
      client_id: config.clientId,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    });
    const response = await this.fetchImpl(endpoints.tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      redirect: "error",
    });

    if (!response.ok) {
      throw new Error(
        `FamilySearch token exchange failed with HTTP ${response.status}.`,
      );
    }

    const token = (await response.json()) as Partial<TokenResponse>;
    if (!token.access_token || typeof token.access_token !== "string") {
      throw new Error("FamilySearch returned an invalid token response.");
    }
    return token as TokenResponse;
  }

  async logout(config: AppConfig): Promise<void> {
    const token = this.accessToken;
    this.clearPending();
    this.accessToken = null;
    this.authState = { status: "idle" };
    if (!token) {
      return;
    }

    const { apiBaseUrl } = getEndpoints(config.environment);
    try {
      await this.fetchImpl(new URL("/platform/logout", apiBaseUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        redirect: "error",
      });
    } catch {
      // The local token is cleared even if server-side invalidation is unavailable.
    }
  }
}
