import test from "node:test";
import assert from "node:assert/strict";

import {
  describeProviderAuth,
  formatProviderOptions,
  formatProviderEndpoint,
  isAuthOnlyAccount,
  normalizeOpenCodeImportOptions,
  parseProviderOptionsInput,
  providerOptionsCanDeriveEndpoint,
} from "../web/src/lib/account-ui";
import type { Account, ProviderRegistryEntry } from "../web/src/types";

test("isAuthOnlyAccount flags imported provider accounts disabled by runtime errors", () => {
  const account: Account = {
    id: "snowflake",
    provider: "snowflake-cortex",
    providerId: "snowflake-cortex",
    providerAdapter: "openai-compatible",
    providerLabel: "Snowflake Cortex",
    providerSource: "opencode",
    providerAuthEnv: ["SNOWFLAKE_ACCOUNT", "SNOWFLAKE_CORTEX_TOKEN"],
    enabled: false,
    state: {
      lastError:
        "Provider endpoint contains unresolved environment variables: SNOWFLAKE_ACCOUNT",
    },
  };

  assert.equal(isAuthOnlyAccount(account), true);
});

test("isAuthOnlyAccount does not count a user-disabled routable account", () => {
  const account: Account = {
    id: "custom-openai-compatible",
    provider: "openai-compatible",
    providerAdapter: "openai-compatible",
    enabled: false,
    baseUrl: "https://api.example.test/v1",
    accessToken: "sk-test",
  };

  assert.equal(isAuthOnlyAccount(account), false);
});

test("isAuthOnlyAccount follows the backend native runtime adapter set", () => {
  const adapters = [
    "amazon-bedrock",
    "vertex",
    "vertex-anthropic",
    "gateway",
    "gitlab",
    "sap-ai-core",
  ];

  for (const adapter of adapters) {
    const account: Account = {
      id: adapter,
      provider: adapter,
      providerAdapter: adapter,
      enabled: true,
      accessToken: "token",
    };

    assert.equal(isAuthOnlyAccount(account), false, adapter);
  }
});

test("describeProviderAuth exposes OpenCode metadata needed for the add-account UI", () => {
  const provider: ProviderRegistryEntry = {
    id: "databricks",
    providerId: "databricks",
    label: "Databricks",
    provider: "databricks",
    providerAdapter: "openai-compatible",
    providerNpm: "@ai-sdk/openai-compatible",
    providerSource: "models.dev",
    providerDoc: "https://opencode.ai/docs/providers/",
    baseUrl: "https://dbc.example.test/serving-endpoints",
    tokenEnv: ["DATABRICKS_TOKEN", "DATABRICKS_HOST"],
    authType: "api-key",
    runtimeSupported: false,
    modelsCount: 4,
  };

  assert.deepEqual(describeProviderAuth(provider), {
    statusLabel: "Auth-only",
    statusTone: "warn",
    authLabel: "API key",
    envVars: ["DATABRICKS_TOKEN", "DATABRICKS_HOST"],
    adapterLabel: "openai-compatible",
    sourceLabel: "models.dev",
    packageName: "@ai-sdk/openai-compatible",
    docsUrl: "https://opencode.ai/docs/providers/",
    endpointLabel: "https://dbc.example.test/serving-endpoints",
    modelsLabel: "4 models",
  });
});

test("describeProviderAuth labels auth-free local providers", () => {
  const provider: ProviderRegistryEntry = {
    id: "ollama",
    providerId: "ollama",
    label: "Ollama (local)",
    provider: "openai-compatible",
    providerAdapter: "openai-compatible",
    providerSource: "builtin",
    baseUrl: "http://127.0.0.1:11434",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: [],
    authType: "none",
    runtimeSupported: true,
  };

  assert.equal(describeProviderAuth(provider)?.authLabel, "No auth");
});

test("formatProviderEndpoint distinguishes missing and configured endpoints", () => {
  assert.equal(formatProviderEndpoint(undefined), "Endpoint not configured");
  assert.equal(
    formatProviderEndpoint("https://api.example.test/v1/"),
    "https://api.example.test/v1/",
  );
});

test("provider option JSON helpers preserve editable provider-specific routing options", () => {
  const options = {
    gatewayId: "team-gateway",
    project: "vertex-project",
  };

  assert.equal(
    formatProviderOptions(options),
    '{\n  "gatewayId": "team-gateway",\n  "project": "vertex-project"\n}',
  );
  assert.deepEqual(parseProviderOptionsInput(""), undefined);
  assert.deepEqual(parseProviderOptionsInput(formatProviderOptions(options)), options);
  assert.throws(
    () => parseProviderOptionsInput("[\"gatewayId\"]"),
    /Provider options must be a JSON object/,
  );
  assert.throws(
    () => parseProviderOptionsInput("{not json}"),
    /Provider options must be valid JSON/,
  );
});

test("provider option endpoint helper recognizes OpenCode-style endpoint options", () => {
  assert.equal(
    providerOptionsCanDeriveEndpoint(
      "cloudflare-ai-gateway",
      "openai-compatible",
      '{ "accountId": "cf-account", "gatewayId": "team-gateway" }',
    ),
    true,
  );
  assert.equal(
    providerOptionsCanDeriveEndpoint(
      "azure",
      "openai-compatible",
      '{ "resourceName": "az-resource" }',
    ),
    true,
  );
  assert.equal(
    providerOptionsCanDeriveEndpoint(
      "custom-router",
      "openai-compatible",
      '{ "baseURL": "https://router.example/v1" }',
    ),
    true,
  );
  assert.equal(
    providerOptionsCanDeriveEndpoint(
      "neon",
      "openai-compatible",
      '{ "NEON_AI_GATEWAY_BASE_URL": "https://neon.example" }',
    ),
    true,
  );
  assert.equal(
    providerOptionsCanDeriveEndpoint(
      "databricks",
      "openai-compatible",
      '{ "DATABRICKS_HOST": "https://dbc.example.com" }',
    ),
    true,
  );
  assert.equal(
    providerOptionsCanDeriveEndpoint(
      "snowflake-cortex",
      "openai-compatible",
      '{ "SNOWFLAKE_ACCOUNT": "acme-test" }',
    ),
    true,
  );
  assert.equal(
    providerOptionsCanDeriveEndpoint(
      "custom-router",
      "openai-compatible",
      '{ "headers": { "x-api-key": "secret" } }',
    ),
    false,
  );
  assert.equal(
    providerOptionsCanDeriveEndpoint(
      "custom-router",
      "openai-compatible",
      "{not json}",
    ),
    false,
  );
});

test("normalizeOpenCodeImportOptions trims optional auth and config paths", () => {
  assert.deepEqual(normalizeOpenCodeImportOptions("", ""), {});
  assert.deepEqual(
    normalizeOpenCodeImportOptions(
      " /tmp/opencode/auth.json ",
      " /tmp/opencode/opencode.jsonc ",
    ),
    {
      path: "/tmp/opencode/auth.json",
      configPath: "/tmp/opencode/opencode.jsonc",
    },
  );
});

test("normalizeOpenCodeImportOptions includes pasted OpenCode auth and config content", () => {
  assert.deepEqual(
    normalizeOpenCodeImportOptions(
      "",
      "",
      ' { "anthropic": { "type": "api", "key": "ant" } } ',
      ' { "provider": { "anthropic": { "npm": "@ai-sdk/anthropic" } } } ',
    ),
    {
      authContent: '{ "anthropic": { "type": "api", "key": "ant" } }',
      configContent:
        '{ "provider": { "anthropic": { "npm": "@ai-sdk/anthropic" } } }',
    },
  );
});
