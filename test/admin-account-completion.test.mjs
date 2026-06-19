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

async function createOpenCodeCredentialDb(filePath) {
  let sqlite;
  try {
    sqlite = await import("node:sqlite");
  } catch {
    return false;
  }

  const db = new sqlite.DatabaseSync(filePath);
  try {
    db.exec(`
      CREATE TABLE credential (
        id text PRIMARY KEY,
        integration_id text,
        label text NOT NULL,
        value text NOT NULL,
        connector_id text,
        method_id text,
        active integer,
        time_created integer NOT NULL,
        time_updated integer NOT NULL
      );
    `);
    const insert = db.prepare(`
      INSERT INTO credential (
        id,
        integration_id,
        label,
        value,
        connector_id,
        method_id,
        active,
        time_created,
        time_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      "cred_work",
      "gitlab",
      "Work",
      JSON.stringify({
        type: "oauth",
        methodID: "oauth",
        access: "db-oauth-access",
        refresh: "db-oauth-refresh",
        expires: 9999999999999,
      }),
      null,
      null,
      1,
      1,
      1,
    );
  } finally {
    db.close();
  }
  return true;
}

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

test("admin account creation derives native provider endpoints from provider options", async () => {
  const { store, server, baseUrl } = await createAdminFixture();
  try {
    const res = await fetch(`${baseUrl}/accounts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "bedrock-from-ui",
        provider: "amazon-bedrock",
        providerId: "amazon-bedrock",
        providerAdapter: "amazon-bedrock",
        providerAuthType: "api-key",
        providerOptions: { region: "eu-west-1" },
        accessToken: "bedrock-token",
        enabled: true,
      }),
    });
    const payload = await res.json();

    assert.equal(res.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    assert.equal(
      payload.account.baseUrl,
      "https://bedrock-runtime.eu-west-1.amazonaws.com",
    );
    assert.deepEqual(payload.account.providerOptions, { region: "eu-west-1" });

    const stored = (await store.listAccounts()).find(
      (account) => account.id === "bedrock-from-ui",
    );
    assert.equal(
      stored?.baseUrl,
      "https://bedrock-runtime.eu-west-1.amazonaws.com",
    );
    assert.deepEqual(stored?.providerOptions, { region: "eu-west-1" });
  } finally {
    await closeServer(server);
  }
});

test("admin account creation derives Neon gateway endpoint from provider options", async () => {
  const { store, server, baseUrl } = await createAdminFixture();
  try {
    const res = await fetch(`${baseUrl}/accounts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "neon-from-ui",
        provider: "openai-compatible",
        providerId: "neon",
        providerAdapter: "openai-compatible",
        providerAuthType: "api-key",
        providerOptions: {
          NEON_AI_GATEWAY_BASE_URL: "https://neon.example",
        },
        accessToken: "neon-token",
        enabled: true,
      }),
    });
    const payload = await res.json();

    assert.equal(res.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    assert.equal(payload.account.baseUrl, "https://neon.example/ai-gateway/mlflow");
    assert.deepEqual(payload.account.providerOptions, {
      NEON_AI_GATEWAY_BASE_URL: "https://neon.example",
    });

    const stored = (await store.listAccounts()).find(
      (account) => account.id === "neon-from-ui",
    );
    assert.equal(stored?.baseUrl, "https://neon.example/ai-gateway/mlflow");
    assert.equal(stored?.accessToken, "neon-token");
    assert.equal(stored?.enabled, true);
  } finally {
    await closeServer(server);
  }
});

test("admin account creation derives Databricks endpoint from provider options", async () => {
  const { store, server, baseUrl } = await createAdminFixture();
  try {
    const res = await fetch(`${baseUrl}/accounts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "databricks-from-ui",
        provider: "openai-compatible",
        providerId: "databricks",
        providerAdapter: "openai-compatible",
        providerAuthType: "api-key",
        providerOptions: {
          DATABRICKS_HOST: "https://dbc.example.com",
        },
        accessToken: "db-token",
        enabled: true,
      }),
    });
    const payload = await res.json();

    assert.equal(res.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    assert.equal(
      payload.account.baseUrl,
      "https://dbc.example.com/ai-gateway/mlflow",
    );

    const stored = (await store.listAccounts()).find(
      (account) => account.id === "databricks-from-ui",
    );
    assert.equal(stored?.baseUrl, "https://dbc.example.com/ai-gateway/mlflow");
    assert.equal(stored?.enabled, true);
  } finally {
    await closeServer(server);
  }
});

test("admin account creation derives Snowflake Cortex endpoint from provider options", async () => {
  const { store, server, baseUrl } = await createAdminFixture();
  try {
    const res = await fetch(`${baseUrl}/accounts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "snowflake-from-ui",
        provider: "openai-compatible",
        providerId: "snowflake-cortex",
        providerAdapter: "openai-compatible",
        providerAuthType: "api-key",
        providerOptions: {
          SNOWFLAKE_ACCOUNT: "acme-test",
        },
        accessToken: "snowflake-token",
        enabled: true,
      }),
    });
    const payload = await res.json();

    assert.equal(res.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    assert.equal(
      payload.account.baseUrl,
      "https://acme-test.snowflakecomputing.com/api/v2/cortex",
    );

    const stored = (await store.listAccounts()).find(
      (account) => account.id === "snowflake-from-ui",
    );
    assert.equal(
      stored?.baseUrl,
      "https://acme-test.snowflakecomputing.com/api/v2/cortex",
    );
    assert.equal(stored?.enabled, true);
  } finally {
    await closeServer(server);
  }
});

test("admin OpenCode import reads current opencode.db credential records", async (t) => {
  const { store, server, baseUrl } = await createAdminFixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-admin-db-"));
  const dbPath = path.join(dir, "opencode.db");
  const configPath = path.join(dir, "opencode.jsonc");
  if (!(await createOpenCodeCredentialDb(dbPath))) {
    t.skip("node:sqlite is unavailable in this Node runtime");
    await closeServer(server);
    return;
  }

  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        provider: {
          gitlab: {
            npm: "gitlab-ai-provider",
            options: {
              baseURL: "https://gitlab.com",
            },
            models: {
              "duo-chat-sonnet-4-5": { name: "Duo Chat Sonnet 4.5" },
            },
          },
        },
      },
      null,
      2,
    ),
  );

  let timeout;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 2_000);
    const res = await fetch(`${baseUrl}/auth/import-opencode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: dbPath, configPath }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const payload = await res.json();

    assert.equal(res.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    assert.equal(payload.imported, 1);
    assert.equal(payload.accounts[0]?.id, "gitlab-work");

    const gitlab = (await store.listAccounts()).find(
      (account) => account.providerId === "gitlab",
    );
    assert.equal(gitlab?.accessToken, "db-oauth-access");
    assert.equal(gitlab?.refreshToken, "db-oauth-refresh");
    assert.equal(gitlab?.expiresAt, 9999999999999);
    assert.equal(gitlab?.providerAuthType, "oauth");
    assert.ok(gitlab?.providerModels?.["duo-chat-sonnet-4-5"]);
  } finally {
    if (timeout) clearTimeout(timeout);
    await closeServer(server);
  }
});

test("admin OpenCode import accepts pasted auth and config content", async () => {
  const { store, server, baseUrl } = await createAdminFixture();
  try {
    const res = await fetch(`${baseUrl}/auth/import-opencode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        authContent: JSON.stringify({
          "inline-router": {
            type: "api",
            key: "inline-secret-token",
          },
        }),
        configContent: `{
          // OpenCode JSONC comments should be accepted from the dashboard.
          "provider": {
            "inline-router": {
              "name": "Inline Router",
              "npm": "@ai-sdk/openai-compatible",
              "options": {
                "baseURL": "https://inline.example/v1"
              },
              "models": {
                "inline-model": { "name": "Inline Model" }
              }
            }
          }
        }`,
      }),
    });
    const payload = await res.json();

    assert.equal(res.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    assert.equal(payload.path, "<inline>");
    assert.equal(payload.configPath, "<inline>");
    assert.equal(payload.imported, 1);
    assert.equal(payload.accounts[0]?.id, "inline-router-inline-router");

    const account = (await store.listAccounts()).find(
      (item) => item.providerId === "inline-router",
    );
    assert.equal(account?.providerAdapter, "openai-compatible");
    assert.equal(account?.accessToken, "inline-secret-token");
    assert.equal(account?.baseUrl, "https://inline.example");
    assert.equal(account?.enabled, true);
    assert.ok(account?.providerModels?.["inline-model"]);
  } finally {
    await closeServer(server);
  }
});
