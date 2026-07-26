import assert from "node:assert/strict";
import test from "node:test";
import {
  FamilySearchApi,
  FamilySearchApiError,
} from "../build/familysearch-api.js";

const config = {
  clientId: "test-key",
  redirectUri: "http://127.0.0.1:57938/familysearch-auth",
  environment: "beta",
};

test("GET requests encode query values and use an Authorization header", async () => {
  let capturedUrl;
  let capturedInit;
  const api = new FamilySearchApi(
    () => config,
    () => "test-access-token",
    async (url, init) => {
      capturedUrl = new URL(url);
      capturedInit = init;
      return new Response(JSON.stringify({ entries: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );

  await api.get("/platform/tree/search", {
    "q.givenName": "A&B",
    count: 10,
  });

  assert.equal(capturedUrl.origin, "https://apibeta.familysearch.org");
  assert.equal(capturedUrl.searchParams.get("q.givenName"), "A&B");
  assert.equal(capturedUrl.searchParams.get("count"), "10");
  assert.equal(
    capturedInit.headers.Authorization,
    "Bearer test-access-token",
  );
  assert.equal(capturedUrl.searchParams.has("access_token"), false);
});

test("API requests fail locally when no token is present", async () => {
  const api = new FamilySearchApi(
    () => config,
    () => null,
    async () => {
      throw new Error("fetch should not be called");
    },
  );
  await assert.rejects(
    () => api.get("/platform/users/current"),
    (error) =>
      error instanceof FamilySearchApiError &&
      error.status === 401 &&
      !error.message.includes("token="),
  );
});

test("API errors do not echo remote response bodies", async () => {
  const api = new FamilySearchApi(
    () => config,
    () => "test-access-token",
    async () =>
      new Response("remote-body-containing-sensitive-details", { status: 403 }),
  );
  await assert.rejects(
    () => api.get("/platform/tree/persons/TEST-123"),
    (error) =>
      error instanceof FamilySearchApiError &&
      error.status === 403 &&
      !error.message.includes("sensitive-details"),
  );
});
