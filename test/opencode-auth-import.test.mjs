import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "bin", "codex-multicodex.js");

function readStore(storePath) {
  return JSON.parse(fs.readFileSync(storePath, "utf8"));
}

test("imports OpenCode auth entries through Models.dev provider metadata", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-auth-"));
  const storePath = path.join(dir, "accounts.json");
  const authPath = path.join(dir, "auth.json");

  fs.writeFileSync(
    authPath,
    JSON.stringify(
      {
        requesty: {
          apiKey: "rq-test-key",
        },
        anthropic: {
          apiKey: "ant-test-key",
        },
        google: {
          apiKey: "gem-test-key",
        },
        "custom-local": {
          token: "local-test-key",
          options: {
            baseURL: "http://127.0.0.1:1234/v1",
          },
        },
      },
      null,
      2,
    ),
  );

  execFileSync(process.execPath, [cli, "auth", "import-opencode", authPath], {
    cwd: root,
    env: {
      ...process.env,
      MULTICODEX_STORE_PATH: storePath,
      MULTICODEX_DATA_DIR: dir,
    },
    encoding: "utf8",
  });

  const store = readStore(storePath);
  const byProviderId = new Map(
    store.accounts.map((account) => [account.providerId, account]),
  );

  const requesty = byProviderId.get("requesty");
  assert.equal(requesty?.provider, "openai-compatible");
  assert.equal(requesty?.providerAdapter, "openai-compatible");
  assert.equal(requesty?.providerLabel, "Requesty");
  assert.equal(requesty?.providerNpm, "@ai-sdk/openai-compatible");
  assert.equal(requesty?.baseUrl, "https://router.requesty.ai");
  assert.equal(requesty?.accessToken, "rq-test-key");
  assert.equal(requesty?.enabled, true);

  const anthropic = byProviderId.get("anthropic");
  assert.equal(anthropic?.provider, "anthropic");
  assert.equal(anthropic?.providerAdapter, "anthropic");
  assert.equal(anthropic?.providerLabel, "Anthropic");
  assert.equal(anthropic?.providerNpm, "@ai-sdk/anthropic");
  assert.equal(anthropic?.accessToken, "ant-test-key");
  assert.equal(anthropic?.enabled, true);
  assert.equal(anthropic?.baseUrl, "https://api.anthropic.com");

  const google = byProviderId.get("google");
  assert.equal(google?.provider, "google");
  assert.equal(google?.providerAdapter, "google");
  assert.equal(google?.providerLabel, "Google");
  assert.equal(google?.providerNpm, "@ai-sdk/google");
  assert.equal(google?.baseUrl, "https://generativelanguage.googleapis.com");
  assert.equal(google?.accessToken, "gem-test-key");
  assert.equal(google?.enabled, true);

  const custom = byProviderId.get("custom-local");
  assert.equal(custom?.provider, "openai-compatible");
  assert.equal(custom?.providerAdapter, "openai-compatible");
  assert.equal(custom?.providerLabel, "custom-local");
  assert.equal(custom?.baseUrl, "http://127.0.0.1:1234");
  assert.equal(custom?.accessToken, "local-test-key");
  assert.equal(custom?.enabled, true);
});

test("imports custom OpenCode provider metadata from opencode config", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-config-auth-"));
  const storePath = path.join(dir, "accounts.json");
  const authPath = path.join(dir, "auth.json");
  const configPath = path.join(dir, "opencode.jsonc");

  fs.writeFileSync(
    authPath,
    JSON.stringify(
      {
        haimaker: {
          apiKey: "hm-test-key",
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    configPath,
    `{
      // OpenCode custom provider shape.
      "provider": {
        "haimaker": {
          "npm": "@ai-sdk/openai-compatible",
          "name": "Haimaker",
          "options": {
            "baseURL": "https://api.haimaker.ai/v1"
          },
          "models": {
            "z-ai/glm-4.6": { "name": "GLM 4.6" }
          }
        }
      }
    }`,
  );

  execFileSync(
    process.execPath,
    [cli, "auth", "import-opencode", authPath, "--config", configPath],
    {
      cwd: root,
      env: {
        ...process.env,
        MULTICODEX_STORE_PATH: storePath,
        MULTICODEX_DATA_DIR: dir,
      },
      encoding: "utf8",
    },
  );

  const store = readStore(storePath);
  const haimaker = store.accounts.find((account) => account.providerId === "haimaker");
  assert.equal(haimaker?.provider, "openai-compatible");
  assert.equal(haimaker?.providerAdapter, "openai-compatible");
  assert.equal(haimaker?.providerLabel, "Haimaker");
  assert.equal(haimaker?.baseUrl, "https://api.haimaker.ai");
  assert.equal(haimaker?.accessToken, "hm-test-key");
  assert.equal(haimaker?.enabled, true);
  assert.ok(haimaker?.providerModels?.["z-ai/glm-4.6"]);
});
