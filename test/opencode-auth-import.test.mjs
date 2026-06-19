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

async function createOpenCodeCredentialDb(filePath, credential) {
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
      credential.id,
      credential.integrationID,
      credential.label,
      JSON.stringify(credential.value),
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

test("imports OpenCode stored credential records through the CLI", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-stored-auth-"));
  const storePath = path.join(dir, "accounts.json");
  const authPath = path.join(dir, "auth.json");
  const configPath = path.join(dir, "opencode.jsonc");

  fs.writeFileSync(
    authPath,
    JSON.stringify(
      [
        {
          id: "cred_work",
          integrationID: "gitlab",
          label: "Work",
          value: {
            type: "oauth",
            methodID: "oauth",
            access: "stored-oauth-access",
            refresh: "stored-oauth-refresh",
            expires: 9999999999999,
          },
        },
      ],
      null,
      2,
    ),
  );
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

  const store = fs.existsSync(storePath) ? readStore(storePath) : { accounts: [] };
  const gitlab = store.accounts.find((account) => account.providerId === "gitlab");

  assert.equal(gitlab?.id, "gitlab-work");
  assert.equal(gitlab?.accessToken, "stored-oauth-access");
  assert.equal(gitlab?.refreshToken, "stored-oauth-refresh");
  assert.equal(gitlab?.expiresAt, 9999999999999);
  assert.equal(gitlab?.providerAuthType, "oauth");
  assert.ok(gitlab?.providerModels?.["duo-chat-sonnet-4-5"]);
});

test("imports OpenCode opencode.db credentials through the CLI", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-db-auth-"));
  const storePath = path.join(dir, "accounts.json");
  const authPath = path.join(dir, "opencode.db");
  const configPath = path.join(dir, "opencode.jsonc");
  if (
    !(await createOpenCodeCredentialDb(authPath, {
      id: "cred_work",
      integrationID: "gitlab",
      label: "Work",
      value: {
        type: "oauth",
        methodID: "oauth",
        access: "db-oauth-access",
        refresh: "db-oauth-refresh",
        expires: 9999999999999,
      },
    }))
  ) {
    t.skip("node:sqlite is unavailable in this Node runtime");
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
  const gitlab = store.accounts.find((account) => account.providerId === "gitlab");

  assert.equal(gitlab?.id, "gitlab-work");
  assert.equal(gitlab?.accessToken, "db-oauth-access");
  assert.equal(gitlab?.refreshToken, "db-oauth-refresh");
  assert.equal(gitlab?.expiresAt, 9999999999999);
  assert.equal(gitlab?.providerAuthType, "oauth");
  assert.ok(gitlab?.providerModels?.["duo-chat-sonnet-4-5"]);
});

test("imports ordinary bundled OpenAI-compatible SDK packages through the CLI", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-sdk-package-auth-"));
  const storePath = path.join(dir, "accounts.json");
  const authPath = path.join(dir, "auth.json");
  const configPath = path.join(dir, "opencode.jsonc");

  fs.writeFileSync(authPath, JSON.stringify({}, null, 2));
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        provider: {
          "custom-groq": {
            npm: "@ai-sdk/groq",
            options: {
              baseURL: "https://api.groq.com/openai/v1",
              apiKey: "groq-secret",
            },
            models: {
              "llama-3.3-70b-versatile": { name: "Llama 3.3 70B" },
            },
          },
          "custom-xai": {
            npm: "@ai-sdk/xai",
            options: {
              apiKey: "xai-secret",
            },
            models: {
              "grok-4": { name: "Grok 4" },
            },
          },
          "custom-openrouter": {
            npm: "@openrouter/ai-sdk-provider",
            options: {
              apiKey: "openrouter-secret",
            },
            models: {
              "openai/gpt-5": { name: "GPT-5" },
            },
          },
          "custom-perplexity": {
            npm: "@ai-sdk/perplexity",
            options: {
              baseURL: "https://api.perplexity.ai",
              apiKey: "perplexity-secret",
            },
            models: {
              "sonar-pro": { name: "Sonar Pro" },
            },
          },
          "custom-vercel-v0": {
            npm: "@ai-sdk/vercel",
            options: {
              apiKey: "vercel-secret",
            },
            models: {
              "v0-1.5-md": { name: "v0 1.5 MD" },
            },
          },
        },
      },
      null,
      2,
    ),
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
  const byId = new Map(store.accounts.map((account) => [account.providerId, account]));

  assert.equal(byId.get("custom-groq")?.providerAdapter, "openai-compatible");
  assert.equal(byId.get("custom-groq")?.baseUrl, "https://api.groq.com/openai");
  assert.equal(byId.get("custom-groq")?.accessToken, "groq-secret");
  assert.equal(byId.get("custom-groq")?.enabled, true);
  assert.ok(byId.get("custom-groq")?.providerModels?.["llama-3.3-70b-versatile"]);

  assert.equal(byId.get("custom-xai")?.providerAdapter, "openai-compatible");
  assert.equal(byId.get("custom-xai")?.baseUrl, "https://api.x.ai");
  assert.equal(byId.get("custom-xai")?.accessToken, "xai-secret");
  assert.equal(byId.get("custom-xai")?.enabled, true);
  assert.ok(byId.get("custom-xai")?.providerModels?.["grok-4"]);

  assert.equal(byId.get("custom-openrouter")?.providerAdapter, "openai-compatible");
  assert.equal(byId.get("custom-openrouter")?.baseUrl, "https://openrouter.ai/api");
  assert.equal(byId.get("custom-openrouter")?.accessToken, "openrouter-secret");
  assert.equal(byId.get("custom-openrouter")?.enabled, true);
  assert.ok(byId.get("custom-openrouter")?.providerModels?.["openai/gpt-5"]);

  assert.equal(byId.get("custom-perplexity")?.providerAdapter, "openai-compatible");
  assert.equal(byId.get("custom-perplexity")?.baseUrl, "https://api.perplexity.ai");
  assert.equal(byId.get("custom-perplexity")?.openAiPathPrefix, "none");
  assert.equal(byId.get("custom-perplexity")?.enabled, true);

  assert.equal(byId.get("custom-vercel-v0")?.providerAdapter, "openai-compatible");
  assert.equal(byId.get("custom-vercel-v0")?.baseUrl, "https://api.v0.dev");
  assert.equal(byId.get("custom-vercel-v0")?.accessToken, "vercel-secret");
  assert.equal(byId.get("custom-vercel-v0")?.enabled, true);
  assert.ok(byId.get("custom-vercel-v0")?.providerModels?.["v0-1.5-md"]);
});

test("imports Vercel AI Gateway through the CLI", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-gateway-auth-"));
  const storePath = path.join(dir, "accounts.json");
  const authPath = path.join(dir, "auth.json");
  const configPath = path.join(dir, "opencode.jsonc");

  fs.writeFileSync(authPath, JSON.stringify({}, null, 2));
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        provider: {
          vercel: {
            npm: "@ai-sdk/gateway",
            options: {
              baseURL: "https://ai-gateway.vercel.sh/v3/ai",
              apiKey: "gateway-secret",
            },
            models: {
              "openai/gpt-5": { name: "GPT-5" },
            },
          },
        },
      },
      null,
      2,
    ),
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
  const gateway = store.accounts.find((account) => account.providerId === "vercel");
  assert.equal(gateway?.provider, "gateway");
  assert.equal(gateway?.providerAdapter, "gateway");
  assert.equal(gateway?.baseUrl, "https://ai-gateway.vercel.sh/v3/ai");
  assert.equal(gateway?.accessToken, "gateway-secret");
  assert.equal(gateway?.enabled, true);
  assert.ok(gateway?.providerModels?.["openai/gpt-5"]);
});

test("imports OpenCode model-level provider overrides through the CLI", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-model-override-auth-"));
  const storePath = path.join(dir, "accounts.json");
  const authPath = path.join(dir, "auth.json");
  const configPath = path.join(dir, "opencode.jsonc");

  fs.writeFileSync(authPath, JSON.stringify({ "amazon-bedrock": {} }, null, 2));
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        provider: {
          "amazon-bedrock": {
            npm: "@ai-sdk/amazon-bedrock",
            env: ["AWS_BEARER_TOKEN_BEDROCK", "AWS_REGION"],
            options: {
              region: "us-east-1",
            },
            models: {
              "anthropic.claude-3-5-sonnet-20241022-v2:0": {
                id: "anthropic.claude-3-5-sonnet-20241022-v2:0",
                name: "Claude 3.5 Sonnet",
              },
              "openai.gpt-oss-120b": {
                id: "openai.gpt-oss-120b",
                name: "GPT OSS 120B",
                provider: {
                  npm: "@ai-sdk/amazon-bedrock/mantle",
                  api: "https://bedrock-mantle.${AWS_REGION}.api.aws/v1",
                  shape: "responses",
                },
              },
            },
          },
        },
      },
      null,
      2,
    ),
  );

  execFileSync(
    process.execPath,
    [cli, "auth", "import-opencode", authPath, "--config", configPath],
    {
      cwd: root,
      env: {
        ...process.env,
        AWS_REGION: "us-east-1",
        AWS_BEARER_TOKEN_BEDROCK: "bedrock-api-key",
        MULTICODEX_STORE_PATH: storePath,
        MULTICODEX_DATA_DIR: dir,
      },
      encoding: "utf8",
    },
  );

  const store = readStore(storePath);
  const parent = store.accounts.find(
    (account) =>
      account.providerId === "amazon-bedrock" &&
      account.providerAdapter === "amazon-bedrock",
  );
  const mantle = store.accounts.find(
    (account) =>
      account.providerId === "amazon-bedrock" &&
      account.providerAdapter === "openai-compatible",
  );

  assert.ok(parent?.providerModels?.["anthropic.claude-3-5-sonnet-20241022-v2:0"]);
  assert.equal(parent?.providerModels?.["openai.gpt-oss-120b"], undefined);

  assert.equal(mantle?.provider, "openai-compatible");
  assert.equal(mantle?.baseUrl, "https://bedrock-mantle.us-east-1.api.aws");
  assert.equal(mantle?.upstreamMode, "responses");
  assert.equal(mantle?.compatibilityMode, "responses");
  assert.equal(mantle?.accessToken, "bedrock-api-key");
  assert.equal(mantle?.enabled, true);
  assert.ok(mantle?.providerModels?.["openai.gpt-oss-120b"]);
});

test("imports OpenCode config provider secrets without auth.json entries", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-config-secret-"));
  const storePath = path.join(dir, "accounts.json");
  const authPath = path.join(dir, "auth.json");
  const configPath = path.join(dir, "opencode.jsonc");

  fs.writeFileSync(authPath, JSON.stringify({}, null, 2));
  fs.writeFileSync(
    configPath,
    `{
      "provider": {
        "fhgenie": {
          "npm": "@ai-sdk/openai-compatible",
          "name": "FhGenie",
          "options": {
            "baseURL": "https://fhgenie.example/v1",
            "apiKey": "fh-secret"
          },
          "models": {
            "Kimi-K2-Thinking": { "name": "Kimi K2 Thinking" }
          }
        },
        "headergenie": {
          "npm": "@ai-sdk/openai-compatible",
          "options": {
            "baseURL": "https://headergenie.example/v1",
            "headers": {
              "Authorization": "Bearer header-secret"
            }
          },
          "models": {
            "glm-5.2": { "name": "GLM 5.2" }
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
  const byProviderId = new Map(
    store.accounts.map((account) => [account.providerId, account]),
  );

  assert.equal(byProviderId.get("fhgenie")?.providerAdapter, "openai-compatible");
  assert.equal(byProviderId.get("fhgenie")?.baseUrl, "https://fhgenie.example");
  assert.equal(byProviderId.get("fhgenie")?.accessToken, "fh-secret");
  assert.equal(byProviderId.get("fhgenie")?.enabled, true);
  assert.ok(byProviderId.get("fhgenie")?.providerModels?.["Kimi-K2-Thinking"]);
  assert.equal(byProviderId.get("headergenie")?.baseUrl, "https://headergenie.example");
  assert.equal(byProviderId.get("headergenie")?.accessToken, "header-secret");
  assert.ok(byProviderId.get("headergenie")?.providerModels?.["glm-5.2"]);
});

test("imports Cloudflare AI Gateway from OpenCode config and env variables", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-cloudflare-auth-"));
  const storePath = path.join(dir, "accounts.json");
  const authPath = path.join(dir, "auth.json");
  const configPath = path.join(dir, "opencode.jsonc");

  fs.writeFileSync(
    authPath,
    JSON.stringify(
      {
        "cloudflare-ai-gateway": {
          apiKey: "cf-test-token",
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    configPath,
    `{
      "provider": {
        "cloudflare-ai-gateway": {
          "options": {
            "accountId": "{env:CLOUDFLARE_ACCOUNT_ID}",
            "gatewayId": "{env:CLOUDFLARE_GATEWAY_ID}"
          },
          "models": {
            "openai/gpt-5.1": { "name": "GPT 5.1 through Cloudflare" }
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
        CLOUDFLARE_ACCOUNT_ID: "cf-account",
        CLOUDFLARE_GATEWAY_ID: "cf-gateway",
        MULTICODEX_STORE_PATH: storePath,
        MULTICODEX_DATA_DIR: dir,
      },
      encoding: "utf8",
    },
  );

  const store = readStore(storePath);
  const cloudflare = store.accounts.find(
    (account) => account.providerId === "cloudflare-ai-gateway",
  );
  assert.equal(cloudflare?.provider, "openai-compatible");
  assert.equal(cloudflare?.providerAdapter, "openai-compatible");
  assert.equal(cloudflare?.providerLabel, "cloudflare-ai-gateway");
  assert.equal(
    cloudflare?.baseUrl,
    "https://gateway.ai.cloudflare.com/v1/cf-account/cf-gateway/openai",
  );
  assert.equal(cloudflare?.upstreamMode, "chat/completions");
  assert.equal(cloudflare?.compatibilityMode, "chat-completions-bridge");
  assert.equal(cloudflare?.accessToken, "cf-test-token");
  assert.equal(cloudflare?.enabled, true);
  assert.ok(cloudflare?.providerModels?.["openai/gpt-5.1"]);
});

test("imports Azure OpenAI v1 endpoint from OpenCode config and env variables", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-azure-auth-"));
  const storePath = path.join(dir, "accounts.json");
  const authPath = path.join(dir, "auth.json");
  const configPath = path.join(dir, "opencode.jsonc");

  fs.writeFileSync(
    authPath,
    JSON.stringify(
      {
        azure: {
          apiKey: "az-test-key",
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    configPath,
    `{
      "provider": {
        "azure": {
          "options": {
            "resourceName": "{env:AZURE_RESOURCE_NAME}"
          },
          "models": {
            "gpt-5.1-prod": { "name": "GPT 5.1 Azure deployment" }
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
        AZURE_RESOURCE_NAME: "az-resource",
        MULTICODEX_STORE_PATH: storePath,
        MULTICODEX_DATA_DIR: dir,
      },
      encoding: "utf8",
    },
  );

  const store = readStore(storePath);
  const azure = store.accounts.find(
    (account) =>
      account.providerId === "azure" &&
      account.providerAdapter === "openai-compatible",
  );
  assert.equal(azure?.provider, "openai-compatible");
  assert.equal(azure?.providerAdapter, "openai-compatible");
  assert.equal(azure?.providerLabel, "azure");
  assert.equal(azure?.baseUrl, "https://az-resource.openai.azure.com/openai");
  assert.equal(azure?.upstreamMode, "responses");
  assert.equal(azure?.compatibilityMode, "responses");
  assert.equal(azure?.accessToken, "az-test-key");
  assert.equal(azure?.enabled, true);
  assert.ok(azure?.providerModels?.["gpt-5.1-prod"]);
});

test("imports Azure OpenAI resource name from OpenCode credential metadata", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-azure-metadata-auth-"));
  const storePath = path.join(dir, "accounts.json");
  const authPath = path.join(dir, "auth.json");

  fs.writeFileSync(
    authPath,
    JSON.stringify(
      {
        azure: {
          type: "key",
          key: "az-test-key",
          metadata: {
            resourceName: "az-auth-resource",
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
  const azure = store.accounts.find(
    (account) =>
      account.providerId === "azure" &&
      account.providerAdapter === "openai-compatible",
  );
  assert.equal(azure?.provider, "openai-compatible");
  assert.equal(azure?.providerAdapter, "openai-compatible");
  assert.equal(azure?.baseUrl, "https://az-auth-resource.openai.azure.com/openai");
  assert.equal(azure?.upstreamMode, "responses");
  assert.equal(azure?.compatibilityMode, "responses");
  assert.equal(azure?.accessToken, "az-test-key");
  assert.equal(azure?.enabled, true);
});

test("imports Snowflake Cortex from OpenCode config and env PAT/JWT token", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-snowflake-auth-"));
  const storePath = path.join(dir, "accounts.json");
  const authPath = path.join(dir, "auth.json");
  const configPath = path.join(dir, "opencode.jsonc");

  fs.writeFileSync(authPath, JSON.stringify({ "snowflake-cortex": {} }, null, 2));
  fs.writeFileSync(
    configPath,
    `{
      "provider": {
        "snowflake-cortex": {
          "npm": "@ai-sdk/openai-compatible",
          "name": "Snowflake Cortex",
          "options": {
            "baseURL": "https://\${SNOWFLAKE_ACCOUNT}.snowflakecomputing.com/api/v2/cortex"
          },
          "models": {
            "claude-sonnet-4-5": { "name": "Claude Sonnet 4.5" }
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
        SNOWFLAKE_ACCOUNT: "acme-test",
        SNOWFLAKE_CORTEX_TOKEN: "snowflake-env-token",
        MULTICODEX_STORE_PATH: storePath,
        MULTICODEX_DATA_DIR: dir,
      },
      encoding: "utf8",
    },
  );

  const store = readStore(storePath);
  const snowflake = store.accounts.find(
    (account) => account.providerId === "snowflake-cortex",
  );
  assert.equal(snowflake?.provider, "openai-compatible");
  assert.equal(snowflake?.providerAdapter, "openai-compatible");
  assert.equal(snowflake?.providerLabel, "Snowflake Cortex");
  assert.equal(
    snowflake?.baseUrl,
    "https://acme-test.snowflakecomputing.com/api/v2/cortex",
  );
  assert.equal(snowflake?.upstreamMode, "chat/completions");
  assert.equal(snowflake?.compatibilityMode, "chat-completions-bridge");
  assert.equal(snowflake?.accessToken, "snowflake-env-token");
  assert.equal(snowflake?.enabled, true);
  assert.ok(snowflake?.providerModels?.["claude-sonnet-4-5"]);
});
