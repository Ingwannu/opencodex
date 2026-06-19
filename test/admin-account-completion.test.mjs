import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAdminRouter } from "../dist/routes/admin/index.js";
import { AccountStore, OAuthStateStore } from "../dist/store.js";
import { createTraceManager } from "../dist/traces.js";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("no port"));
      else resolve(address.port);
    });
  });
}

async function closeServer(server) {
  if (typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }
  await Promise.race([
    new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

async function createAdminFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-admin-"));
  const accountsPath = path.join(dir, "accounts.json");
  const oauthStatePath = path.join(dir, "oauth.json");
  const tracePath = path.join(dir, "traces.jsonl");
  const traceStatsHistoryPath = path.join(dir, "trace-stats.jsonl");
  const store = new AccountStore(accountsPath);
  const oauthStore = new OAuthStateStore(oauthStatePath);
  await store.init();
  await oauthStore.init();

  const app = express();
  app.use(express.json());
  app.use(
    "/admin",
    createAdminRouter({
      store,
      oauthStore,
      traceManager: createTraceManager({
        filePath: tracePath,
        historyFilePath: traceStatsHistoryPath,
      }),
      oauthConfig: {
        authorizationUrl: "https://auth.example/authorize",
        tokenUrl: "https://auth.example/token",
        clientId: "client",
        scope: "openid",
        redirectUri: "http://127.0.0.1/auth/callback",
      },
      openaiBaseUrl: "https://api.openai.com",
      mistralBaseUrl: "https://api.mistral.ai",
      zaiBaseUrl: "https://api.z.ai",
      storagePaths: {
        accountsPath,
        oauthStatePath,
        tracePath,
        traceStatsHistoryPath,
      },
    }),
  );

  const server = http.createServer(app);
  const port = await listen(server);
  return { store, server, baseUrl: `http://127.0.0.1:${port}/admin` };
}

test("admin patch promotes an OpenCode auth-only OpenAI-compatible account to routable", async () => {
  const { store, server, baseUrl } = await createAdminFixture();
  try {
    await store.upsertAccount({
      id: "databricks-auth-only",
      provider: "openai-compatible",
      providerId: "databricks",
      providerAdapter: "openai-compatible",
      providerLabel: "Databricks",
      providerNpm: "@ai-sdk/openai-compatible",
      providerSource: "opencode",
      providerAuthType: "api-key",
      accessToken: "old-token",
      enabled: false,
      upstreamMode: "chat/completions",
      compatibilityMode: "chat-completions-bridge",
      priority: 0,
      state: {
        lastError: "auth-only disabled account until endpoint metadata is available",
        modelBlocks: {
          "databricks-meta-llama": {
            until: Date.now() + 60_000,
            reason: "auth-only",
          },
        },
        recentErrors: [{ at: Date.now(), message: "auth-only" }],
        recentEmptyResponses: [{ at: Date.now(), message: "auth-only" }],
        needsTokenRefresh: true,
      },
    });

    const res = await fetch(`${baseUrl}/accounts/databricks-auth-only`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: "https://dbc.example.com/serving-endpoints/v1",
        accessToken: "db-token",
        enabled: true,
      }),
    });
    const payload = await res.json();

    assert.equal(res.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    assert.equal(payload.account.enabled, true);
    assert.equal(payload.account.baseUrl, "https://dbc.example.com/serving-endpoints");
    assert.equal(payload.account.state, undefined);

    const stored = (await store.listAccounts()).find(
      (account) => account.id === "databricks-auth-only",
    );
    assert.equal(stored?.enabled, true);
    assert.equal(stored?.baseUrl, "https://dbc.example.com/serving-endpoints");
    assert.equal(stored?.accessToken, "db-token");
    assert.equal(stored?.state, undefined);
  } finally {
    await closeServer(server);
  }
});
