import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  OAuthManager,
  buildAuthorizationUrl,
  createCodeChallenge,
  createCodeVerifier,
  statesMatch,
  validateLoopbackRedirectUri,
} from "../build/oauth.js";

const config = {
  clientId: "test-app-key",
  redirectUri: "http://127.0.0.1:57938/familysearch-auth",
  environment: "beta",
};

test("PKCE verifier and S256 challenge use base64url", () => {
  const verifier = createCodeVerifier();
  assert.match(verifier, /^[A-Za-z0-9_-]{64}$/);
  const expected = createHash("sha256")
    .update(verifier, "ascii")
    .digest("base64url");
  assert.equal(createCodeChallenge(verifier), expected);
});

test("authorization URL contains Authorization Code and PKCE fields", () => {
  const url = new URL(
    buildAuthorizationUrl(config, "expected-state", "expected-challenge"),
  );
  assert.equal(url.origin, "https://identbeta.familysearch.org");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), config.clientId);
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.get("state"), "expected-state");
  assert.equal(url.searchParams.get("code_challenge"), "expected-challenge");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "openid");
  assert.equal(url.searchParams.has("password"), false);
});

test("loopback redirect validation rejects remote and unsafe callbacks", () => {
  assert.equal(
    validateLoopbackRedirectUri(config.redirectUri).hostname,
    "127.0.0.1",
  );
  assert.throws(
    () => validateLoopbackRedirectUri("https://127.0.0.1:57938/callback"),
    /http loopback/,
  );
  assert.throws(
    () => validateLoopbackRedirectUri("http://example.com:57938/callback"),
    /callback host/,
  );
  assert.throws(
    () => validateLoopbackRedirectUri("http://127.0.0.1:80/callback"),
    /port above 1023/,
  );
  assert.throws(
    () => validateLoopbackRedirectUri("http://127.0.0.1:57938/callback#token"),
    /unsupported components/,
  );
});

test("OAuth state comparison rejects mismatches and length differences", () => {
  assert.equal(statesMatch("same-state", "same-state"), true);
  assert.equal(statesMatch("same-state", "other-stat"), false);
  assert.equal(statesMatch("same-state", "short"), false);
});

test("authorization-code exchange sends PKCE verifier without secrets", async () => {
  let capturedUrl;
  let capturedInit;
  const manager = new OAuthManager(async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(
      JSON.stringify({
        access_token: "memory-only-token",
        token_type: "Bearer",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  });

  const token = await manager.exchangeCode(
    config,
    "authorization-code",
    "pkce-verifier",
  );
  assert.equal(token.access_token, "memory-only-token");
  assert.equal(
    capturedUrl,
    "https://identbeta.familysearch.org/cis-web/oauth2/v3/token",
  );
  const body = new URLSearchParams(capturedInit.body);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "authorization-code");
  assert.equal(body.get("code_verifier"), "pkce-verifier");
  assert.equal(body.has("password"), false);
  assert.equal(body.has("client_secret"), false);
});
