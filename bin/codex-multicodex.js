#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const HOME = os.homedir();
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, ".codex");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.MULTICODEX_PORT || "1455";
const BASE = process.env.MULTICODEX_BASE_URL || `http://127.0.0.1:${PORT}`;
const CATALOG_PATH = path.join(CODEX_HOME, "model-catalogs", "multicodex-models.json");
const OAI_CATALOG_PATH = path.join(CODEX_HOME, "model-catalogs", "oai-models.json");
const PROFILE_PATH = path.join(CODEX_HOME, "multicodex.config.toml");
const OAI_PROFILE_PATH = path.join(CODEX_HOME, "oai.config.toml");
const CONFIG_PATH = path.join(CODEX_HOME, "config.toml");
const MANAGED_DIR = path.join(CODEX_HOME, "opencodex");
const DATA_DIR = process.env.MULTICODEX_DATA_DIR || path.join(MANAGED_DIR, "data");
const LEGACY_DATA_DIRS = [path.join(CODEX_HOME, "multicodex-proxy", "data"), path.join(ROOT, "data")];
const STORE_PATH = process.env.MULTICODEX_STORE_PATH || process.env.STORE_PATH || path.join(DATA_DIR, "accounts.json");
const OAUTH_STATE_PATH = process.env.MULTICODEX_OAUTH_STATE_PATH || path.join(DATA_DIR, "oauth-state.json");
const TRACE_FILE_PATH = process.env.MULTICODEX_TRACE_FILE_PATH || path.join(DATA_DIR, "requests-trace.jsonl");
const TRACE_STATS_HISTORY_PATH =
  process.env.MULTICODEX_TRACE_STATS_HISTORY_PATH || path.join(DATA_DIR, "requests-stats-history.jsonl");
const OPENCODE_AUTH_PATH =
  process.env.OPENCODE_AUTH_PATH || path.join(HOME, ".local", "share", "opencode", "auth.json");
const DEFAULT_CODEX_BIN = path.join(CODEX_HOME, "packages", "standalone", "current", "bin", "codex");
const FAST_SERVICE_TIER = "priority";
const CODEX_FAST_CONFIG_TIER = "fast";
const MANIFEST_PATH = path.join(MANAGED_DIR, "manifest.json");
const BIN_DIR = process.env.CODEX_MULTICODEX_BIN_DIR || path.join(HOME, ".local", "bin");
const WRAPPER_PATHS = {
  codex: path.join(BIN_DIR, "codex"),
  opencodex: path.join(BIN_DIR, "opencodex"),
  "codex-multicodex": path.join(BIN_DIR, "codex-multicodex"),
  "codex-multi": path.join(BIN_DIR, "codex-multi"),
  "codex-oai": path.join(BIN_DIR, "codex-oai"),
  "codex-oss": path.join(BIN_DIR, "codex-oss"),
};
const SHIM_MARKER = "codex-multicodex managed shim v1";

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathEntries() {
  return (process.env.PATH || "").split(path.delimiter).filter(Boolean);
}

function findOnPath(command, exclude = new Set()) {
  for (const dir of pathEntries()) {
    const candidate = path.resolve(dir, command);
    if (exclude.has(candidate)) continue;
    if (isExecutable(candidate)) return candidate;
  }
  return undefined;
}

function resolveCodexBin() {
  const explicit = process.env.CODEX_BIN || process.env.CODEX_REAL_BIN;
  if (explicit) return explicit;

  const manifest = readManifest();
  if (typeof manifest?.codexRealBin === "string" && manifest.codexRealBin && isExecutable(manifest.codexRealBin)) {
    return manifest.codexRealBin;
  }

  if (isExecutable(DEFAULT_CODEX_BIN)) return DEFAULT_CODEX_BIN;

  const managedWrappers = new Set(Object.values(WRAPPER_PATHS).map((entry) => path.resolve(entry)));
  return findOnPath("codex", managedWrappers) || "codex";
}

const CODEX_BIN = resolveCodexBin();
const AWS_BEDROCK_SIGV4_PLACEHOLDER = "__opencodex_aws_sigv4__";
const GOOGLE_VERTEX_ADC_PLACEHOLDER = "__opencodex_google_vertex_adc__";
const NO_AUTH_ACCESS_TOKEN = "__opencodex_no_auth__";
const DEFAULT_PROXY_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex-spark",
  "codex-auto-review",
  "moonshotai/Kimi-K2.5",
  "qwen3.6-35b-fast",
  "glm-5.1",
  "zai-org/GLM-5.1-FP8",
  "qwen3.5-397b-fast",
  "kimi-k2.6-fast",
  "glm-5.1-fast",
  "glm-5.2-fast",
  "kimi-k2.5-fast",
  "qwen3.5-397b",
  "kimi-k2.6",
  "glm-5.2",
  "qwen3.6-35b",
  "kimi-k2.7-code",
].join(",");

const authProviderPresets = {
  "openai-chatgpt": {
    label: "OpenAI ChatGPT account token",
    provider: "openai",
    providerId: "openai-chatgpt",
    providerAdapter: "openai",
    providerSource: "builtin",
    tokenEnv: ["CHATGPT_ACCESS_TOKEN", "OPENAI_ACCESS_TOKEN"],
    runtimeSupported: true,
  },
  "openai-api": {
    label: "OpenAI API key through the proxy",
    provider: "openai-compatible",
    providerId: "openai",
    providerAdapter: "openai-compatible",
    providerNpm: "@ai-sdk/openai",
    providerSource: "builtin",
    providerDoc: "https://platform.openai.com/docs/models",
    baseUrl: "https://api.openai.com",
    upstreamMode: "responses",
    compatibilityMode: "responses",
    tokenEnv: ["OPENAI_API_KEY"],
    runtimeSupported: true,
  },
  openrouter: {
    label: "OpenRouter chat/completions bridge",
    provider: "openai-compatible",
    providerId: "openrouter",
    providerAdapter: "openai-compatible",
    providerNpm: "@openrouter/ai-sdk-provider",
    providerSource: "builtin",
    providerDoc: "https://openrouter.ai/models",
    baseUrl: "https://openrouter.ai/api",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    providerOptions: {
      headers: {
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      },
    },
    tokenEnv: ["OPENROUTER_API_KEY"],
    disabledModels: ["gpt-5-chat-latest", "openai/gpt-5-chat"],
    runtimeSupported: true,
  },
  mistral: {
    label: "Mistral native provider",
    provider: "mistral",
    providerId: "mistral",
    providerAdapter: "mistral",
    providerNpm: "@ai-sdk/mistral",
    providerSource: "builtin",
    tokenEnv: ["MISTRAL_API_KEY"],
    runtimeSupported: true,
  },
  zai: {
    label: "Z.ai native provider",
    provider: "zai",
    providerId: "zai",
    providerAdapter: "zai",
    providerNpm: "@ai-sdk/openai-compatible",
    providerSource: "builtin",
    providerDoc: "https://docs.z.ai/guides/overview/pricing",
    tokenEnv: ["ZAI_API_KEY", "ZAI_TOKEN"],
    runtimeSupported: true,
  },
  neuralwatt: {
    label: "Neuralwatt OpenAI-compatible bridge",
    provider: "openai-compatible",
    providerId: "neuralwatt",
    providerAdapter: "openai-compatible",
    providerNpm: "@ai-sdk/openai-compatible",
    providerSource: "builtin",
    baseUrl: "https://api.neuralwatt.com",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: ["NEURALWATT_API_KEY"],
    runtimeSupported: true,
  },
  requesty: {
    label: "Requesty",
    provider: "openai-compatible",
    providerId: "requesty",
    providerAdapter: "openai-compatible",
    providerNpm: "@ai-sdk/openai-compatible",
    providerSource: "builtin",
    providerDoc: "https://requesty.ai/solution/llm-routing/models",
    baseUrl: "https://router.requesty.ai",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: ["REQUESTY_API_KEY"],
    runtimeSupported: true,
  },
  vercel: {
    label: "Vercel AI Gateway",
    provider: "gateway",
    providerId: "vercel",
    providerAdapter: "gateway",
    providerNpm: "@ai-sdk/gateway",
    providerSource: "builtin",
    providerDoc: "https://vercel.com/docs/ai-gateway",
    baseUrl: "https://ai-gateway.vercel.sh/v3/ai",
    tokenEnv: ["AI_GATEWAY_API_KEY"],
    runtimeSupported: true,
  },
  anthropic: {
    label: "Anthropic",
    provider: "anthropic",
    providerId: "anthropic",
    providerAdapter: "anthropic",
    providerNpm: "@ai-sdk/anthropic",
    providerSource: "builtin",
    providerDoc: "https://docs.anthropic.com/en/docs/about-claude/models",
    baseUrl: "https://api.anthropic.com",
    providerOptions: {
      headers: {
        "anthropic-beta":
          "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
      },
    },
    tokenEnv: ["ANTHROPIC_API_KEY"],
    runtimeSupported: true,
  },
  google: {
    label: "Google",
    provider: "google",
    providerId: "google",
    providerAdapter: "google",
    providerNpm: "@ai-sdk/google",
    providerSource: "builtin",
    providerDoc: "https://ai.google.dev/gemini-api/docs/models",
    baseUrl: "https://generativelanguage.googleapis.com",
    tokenEnv: ["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
    runtimeSupported: true,
  },
  "google-vertex": {
    label: "Google Vertex AI",
    provider: "vertex",
    providerId: "google-vertex",
    providerAdapter: "vertex",
    providerNpm: "@ai-sdk/google-vertex",
    providerSource: "builtin",
    providerDoc: "https://opencode.ai/docs/providers/",
    baseUrl: vertexBaseUrlFromOptions(),
    providerOptions: googleVertexProviderOptionsFromSource({
      options: {
        project: process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_VERTEX_PROJECT,
        location: process.env.VERTEX_LOCATION || process.env.GOOGLE_VERTEX_LOCATION,
        credentialsFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      },
    }),
    tokenEnv: [
      "GOOGLE_VERTEX_ACCESS_TOKEN",
      "GOOGLE_ACCESS_TOKEN",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "GOOGLE_CLOUD_PROJECT",
      "GOOGLE_VERTEX_PROJECT",
      "VERTEX_LOCATION",
      "GOOGLE_VERTEX_LOCATION",
    ],
    runtimeSupported: Boolean(vertexBaseUrlFromOptions()),
  },
  "google-vertex-anthropic": {
    label: "Google Vertex AI Anthropic",
    provider: "vertex-anthropic",
    providerId: "google-vertex-anthropic",
    providerAdapter: "vertex-anthropic",
    providerNpm: "@ai-sdk/google-vertex/anthropic",
    providerSource: "builtin",
    providerDoc: "https://opencode.ai/docs/providers/",
    baseUrl: vertexBaseUrlFromOptions(),
    providerOptions: googleVertexProviderOptionsFromSource({
      options: {
        project: process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_VERTEX_PROJECT,
        location: process.env.VERTEX_LOCATION || process.env.GOOGLE_VERTEX_LOCATION,
        credentialsFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      },
    }),
    tokenEnv: [
      "GOOGLE_VERTEX_ACCESS_TOKEN",
      "GOOGLE_ACCESS_TOKEN",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "GOOGLE_CLOUD_PROJECT",
      "GOOGLE_VERTEX_PROJECT",
      "VERTEX_LOCATION",
      "GOOGLE_VERTEX_LOCATION",
    ],
    runtimeSupported: Boolean(vertexBaseUrlFromOptions()),
  },
  cohere: {
    label: "Cohere",
    provider: "cohere",
    providerId: "cohere",
    providerAdapter: "cohere",
    providerNpm: "@ai-sdk/cohere",
    providerSource: "builtin",
    providerDoc: "https://docs.cohere.com/docs/models",
    baseUrl: "https://api.cohere.com",
    tokenEnv: ["COHERE_API_KEY"],
    runtimeSupported: true,
  },
  "amazon-bedrock": {
    label: "Amazon Bedrock",
    provider: "amazon-bedrock",
    providerId: "amazon-bedrock",
    providerAdapter: "amazon-bedrock",
    providerNpm: "@ai-sdk/amazon-bedrock",
    providerSource: "builtin",
    providerDoc: "https://docs.aws.amazon.com/bedrock/latest/userguide/",
    baseUrl: amazonBedrockBaseUrlFromOptions(),
    providerOptions: amazonBedrockProviderOptionsFromSource({
      options: {
        region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
        profile: process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE,
      },
    }),
    tokenEnv: [
      "AWS_BEARER_TOKEN_BEDROCK",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_PROFILE",
      "AWS_DEFAULT_PROFILE",
      "AWS_REGION",
      "AWS_DEFAULT_REGION",
      "AWS_SHARED_CREDENTIALS_FILE",
    ],
    runtimeSupported: true,
  },
  "sap-ai-core": {
    label: "SAP AI Core",
    provider: "sap-ai-core",
    providerId: "sap-ai-core",
    providerAdapter: "sap-ai-core",
    providerNpm: "@jerome-benoit/sap-ai-provider-v2",
    providerSource: "builtin",
    providerDoc: "https://help.sap.com/docs/sap-ai-core",
    tokenEnv: ["AICORE_SERVICE_KEY"],
    runtimeSupported: true,
  },
  "openai-compatible": {
    label: "Generic OpenAI-compatible endpoint",
    provider: "openai-compatible",
    providerId: "openai-compatible",
    providerAdapter: "openai-compatible",
    providerNpm: "@ai-sdk/openai-compatible",
    providerSource: "builtin",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: ["OPENAI_COMPATIBLE_API_KEY"],
    runtimeSupported: true,
  },
  ollama: {
    label: "Ollama (local)",
    provider: "openai-compatible",
    providerId: "ollama",
    providerAdapter: "openai-compatible",
    providerNpm: "@ai-sdk/openai-compatible",
    providerSource: "builtin",
    providerDoc: "https://opencode.ai/docs/providers/",
    baseUrl: "http://127.0.0.1:11434",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: [],
    authType: "none",
    runtimeSupported: true,
  },
  lmstudio: {
    label: "LM Studio (local)",
    provider: "openai-compatible",
    providerId: "lmstudio",
    providerAdapter: "openai-compatible",
    providerNpm: "@ai-sdk/openai-compatible",
    providerSource: "builtin",
    providerDoc: "https://opencode.ai/docs/providers/",
    baseUrl: "http://127.0.0.1:1234",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: [],
    authType: "none",
    runtimeSupported: true,
  },
  "llama.cpp": {
    label: "llama.cpp (local)",
    provider: "openai-compatible",
    providerId: "llama.cpp",
    providerAdapter: "openai-compatible",
    providerNpm: "@ai-sdk/openai-compatible",
    providerSource: "builtin",
    providerDoc: "https://opencode.ai/docs/providers/",
    baseUrl: "http://127.0.0.1:8080",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: [],
    authType: "none",
    runtimeSupported: true,
  },
};

const authProviderAliases = {
  chatgpt: "openai-chatgpt",
  openai: "openai-api",
  "openai-responses": "openai-api",
  "z.ai": "zai",
  zaiorg: "zai",
};

const openAiCompatibleSdkProviderDefaults = {
  xai: { baseUrl: "https://api.x.ai" },
  groq: { baseUrl: "https://api.groq.com/openai" },
  deepinfra: { baseUrl: "https://api.deepinfra.com/v1/openai" },
  cerebras: {
    baseUrl: "https://api.cerebras.ai",
    providerOptions: {
      headers: {
        "X-Cerebras-3rd-Party-Integration": "opencode",
      },
    },
  },
  togetherai: { baseUrl: "https://api.together.ai" },
  perplexity: {
    baseUrl: "https://api.perplexity.ai",
    openAiPathPrefix: "none",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
  },
  "perplexity-agent": {
    baseUrl: "https://api.perplexity.ai/v1",
    upstreamMode: "responses",
    compatibilityMode: "responses",
  },
  venice: { baseUrl: "https://api.venice.ai/api/v1" },
  aihubmix: { baseUrl: "https://aihubmix.com/v1" },
  "merge-gateway": { baseUrl: "https://api-gateway.merge.dev/v1/openai" },
  opencode: {
    baseUrl: "https://opencode.ai/zen/v1",
    label: "OpenCode Zen",
    tokenEnv: ["OPENCODE_API_KEY"],
  },
  "opencode-go": {
    baseUrl: "https://opencode.ai/zen/go/v1",
    label: "OpenCode Go",
    tokenEnv: ["OPENCODE_API_KEY"],
  },
  v0: {
    baseUrl: "https://api.v0.dev/v1",
    providerOptions: {
      headers: {
        "http-referer": "https://opencode.ai/",
        "x-title": "opencode",
      },
    },
  },
};

const openAiCompatibleSdkPackageDefaults = {
  "@ai-sdk/alibaba": {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  "@ai-sdk/cerebras": {
    baseUrl: "https://api.cerebras.ai/v1",
    providerOptions: {
      headers: {
        "X-Cerebras-3rd-Party-Integration": "opencode",
      },
    },
  },
  "@ai-sdk/deepinfra": { baseUrl: "https://api.deepinfra.com/v1/openai" },
  "@ai-sdk/groq": { baseUrl: "https://api.groq.com/openai/v1" },
  "@ai-sdk/perplexity": {
    baseUrl: "https://api.perplexity.ai",
    openAiPathPrefix: "none",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
  },
  "@ai-sdk/togetherai": { baseUrl: "https://api.together.xyz/v1" },
  "@ai-sdk/vercel": {
    baseUrl: "https://api.v0.dev/v1",
    providerOptions: {
      headers: {
        "http-referer": "https://opencode.ai/",
        "x-title": "opencode",
      },
    },
  },
  "@ai-sdk/xai": { baseUrl: "https://api.x.ai/v1" },
  "@openrouter/ai-sdk-provider": {
    baseUrl: "https://openrouter.ai/api/v1",
    providerOptions: {
      headers: {
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      },
    },
    disabledModels: ["gpt-5-chat-latest", "openai/gpt-5-chat"],
  },
  "venice-ai-sdk-provider": { baseUrl: "https://api.venice.ai/api/v1" },
};

function openAiCompatibleDefaultFromNpm(npmPackage) {
  const npm = String(npmPackage || "").trim().toLowerCase();
  return openAiCompatibleSdkPackageDefaults[npm];
}

const MODELS_DEV_API_URL = process.env.MODELS_DEV_API_URL || "https://models.dev/api.json";
let modelsDevAuthProviderCache = null;

function sanitizeProviderId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function firstStringValue(source, keys) {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function expandEnvTemplates(value, env = process.env) {
  let missing = false;
  const expanded = String(value || "")
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => {
      const found = env[String(name)];
      if (found === undefined || found === "") {
        missing = true;
        return "";
      }
      return found;
    })
    .replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => {
      const found = env[String(name)];
      if (found === undefined || found === "") {
        missing = true;
        return "";
      }
      return found;
    });
  return missing ? undefined : expanded;
}

function isLocalHttpBaseUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "localhost" ||
        parsed.hostname === "::1")
    );
  } catch {
    return false;
  }
}

function sourceOptionsCarrySecret(options) {
  if (!options) return false;
  for (const key of [
    "apiKey",
    "apikey",
    "api_key",
    "token",
    "accessToken",
    "access_token",
    "bearer",
  ]) {
    if (typeof options[key] === "string" && options[key].trim()) return true;
  }
  const headers = options.headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return false;
  return Object.entries(headers).some(
    ([key, value]) =>
      typeof value === "string" &&
      value.trim().length > 0 &&
      ["authorization", "x-api-key", "api-key"].includes(key.toLowerCase()),
  );
}

function tokenEnvHasSecret(tokenEnv, env = process.env) {
  return tokenEnv.some((name) => Boolean(env[name]?.trim()));
}

function cloudflareAiGatewayBaseUrlFromOptions(options = {}, env = process.env) {
  const explicit = firstStringValue(options, ["baseURL", "baseUrl", "base_url", "url", "endpoint"]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;
  const accountId =
    firstStringValue(options, ["accountId", "accountID", "account_id", "account"]) ||
    env.CLOUDFLARE_ACCOUNT_ID;
  const gatewayId =
    firstStringValue(options, ["gatewayId", "gatewayID", "gateway_id", "gateway"]) ||
    env.CLOUDFLARE_GATEWAY_ID;
  if (!accountId?.trim() || !gatewayId?.trim()) return undefined;
  return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId.trim())}/${encodeURIComponent(gatewayId.trim())}/openai`;
}

function cloudflareWorkersAiBaseUrlFromOptions(options = {}, env = process.env) {
  const explicit = firstStringValue(options, ["baseURL", "baseUrl", "base_url", "url", "endpoint"]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;
  const accountId =
    firstStringValue(options, ["accountId", "accountID", "account_id", "account"]) ||
    env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId?.trim()) return undefined;
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId.trim())}/ai`;
}

function cloudflareGatewayProviderOptionsFromSource(source = {}, env = process.env) {
  const options = source?.options || {};
  for (const key of ["gatewayId", "gatewayID", "gateway_id", "gateway"]) {
    const value = options[key];
    if (typeof value === "string" && value.trim()) return { gatewayId: value.trim() };
  }
  if (env.CLOUDFLARE_GATEWAY_ID?.trim()) return { gatewayId: env.CLOUDFLARE_GATEWAY_ID.trim() };
  return undefined;
}

const azureOpenAiProviderIds = new Set(["azure", "azure-cognitive-services"]);

function isAzureOpenAiProviderSource(providerId, npmPackage) {
  return (
    azureOpenAiProviderIds.has(sanitizeProviderId(providerId)) ||
    String(npmPackage || "").trim().toLowerCase() === "@ai-sdk/azure"
  );
}

function azureOpenAiBaseUrlFromOptions(providerId, options = {}, env = process.env, allowCustomProviderId = false) {
  const id = sanitizeProviderId(providerId);
  if (!allowCustomProviderId && !azureOpenAiProviderIds.has(id)) return undefined;
  const explicit = firstStringValue(options, ["baseURL", "baseUrl", "base_url", "url", "endpoint"]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;
  const resourceName =
    firstStringValue(options, ["resourceName", "resource_name", "resource", "resourceId", "resource_id"]) ||
    (id === "azure-cognitive-services"
      ? env.AZURE_COGNITIVE_SERVICES_RESOURCE_NAME
      : env.AZURE_RESOURCE_NAME);
  if (!resourceName?.trim()) return undefined;
  return `https://${resourceName.trim()}.openai.azure.com/openai/v1`;
}

function amazonBedrockBaseUrlFromOptions(options = {}, env = process.env) {
  const explicit = firstStringValue(options, ["baseURL", "baseUrl", "base_url", "url", "endpoint"]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;
  const region =
    firstStringValue(options, ["region", "awsRegion", "aws_region"]) ||
    env.AWS_REGION ||
    env.AWS_DEFAULT_REGION;
  if (!region?.trim()) return undefined;
  return `https://bedrock-runtime.${region.trim()}.amazonaws.com`;
}

function amazonBedrockProviderOptionsFromSource(source = {}) {
  const options = source?.options || {};
  const out = {};
  for (const key of [
    "region",
    "awsRegion",
    "aws_region",
    "profile",
    "awsProfile",
    "aws_profile",
    "credentialsFile",
    "credentials_file",
    "sharedCredentialsFile",
    "shared_credentials_file",
  ]) {
    const value = options[key];
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

function parseAwsCredentialsFile(source, profile = "default") {
  const target = profile.trim() || "default";
  const sections = new Map();
  let current;
  for (const rawLine of String(source || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      const name = (sectionMatch[1] || "").trim().replace(/^profile\s+/i, "");
      current = {};
      sections.set(name, current);
      continue;
    }
    if (!current) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    current[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  const section = sections.get(target);
  if (!section?.aws_access_key_id || !section?.aws_secret_access_key) return undefined;
  return {
    accessKeyId: section.aws_access_key_id,
    secretAccessKey: section.aws_secret_access_key,
    ...(section.aws_session_token ? { sessionToken: section.aws_session_token } : {}),
  };
}

function awsBedrockRegion(options = {}, env = process.env) {
  return (
    firstStringValue(options, ["region", "awsRegion", "aws_region"]) ||
    env.AWS_REGION ||
    env.AWS_DEFAULT_REGION
  )?.trim();
}

function resolveAwsBedrockCredentials(options = {}, env = process.env) {
  const region = awsBedrockRegion(options, env);
  if (!region) return undefined;
  if (env.AWS_ACCESS_KEY_ID?.trim() && env.AWS_SECRET_ACCESS_KEY?.trim()) {
    return {
      accessKeyId: env.AWS_ACCESS_KEY_ID.trim(),
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY.trim(),
      ...(env.AWS_SESSION_TOKEN?.trim() ? { sessionToken: env.AWS_SESSION_TOKEN.trim() } : {}),
      region,
    };
  }
  try {
    const profile =
      firstStringValue(options, ["profile", "awsProfile", "aws_profile"]) ||
      env.AWS_PROFILE ||
      env.AWS_DEFAULT_PROFILE ||
      "default";
    const credentialsFile =
      firstStringValue(options, [
        "credentialsFile",
        "credentials_file",
        "sharedCredentialsFile",
        "shared_credentials_file",
      ]) ||
      env.AWS_SHARED_CREDENTIALS_FILE ||
      path.join(HOME, ".aws", "credentials");
    const parsed = parseAwsCredentialsFile(fs.readFileSync(credentialsFile, "utf8"), profile);
    return parsed ? { ...parsed, region } : undefined;
  } catch {
    return undefined;
  }
}

function vertexBaseUrlFromOptions(options = {}, env = process.env) {
  const explicit = firstStringValue(options, ["baseURL", "baseUrl", "base_url", "url", "endpoint"]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;
  const project =
    firstStringValue(options, [
      "project",
      "projectId",
      "projectID",
      "googleCloudProject",
      "google_cloud_project",
      "googleVertexProject",
      "google_vertex_project",
    ]) ||
    env.GOOGLE_CLOUD_PROJECT ||
    env.GCLOUD_PROJECT ||
    env.GOOGLE_VERTEX_PROJECT;
  const location =
    firstStringValue(options, [
      "location",
      "region",
      "vertexLocation",
      "vertex_location",
      "googleVertexLocation",
      "google_vertex_location",
    ]) ||
    env.VERTEX_LOCATION ||
    env.GOOGLE_VERTEX_LOCATION;
  const resolvedLocation = location || (project?.trim() ? "global" : undefined);
  if (!project?.trim() || !resolvedLocation?.trim()) return undefined;
  const trimmedLocation = resolvedLocation.trim();
  const endpoint = trimmedLocation === "global"
    ? "https://aiplatform.googleapis.com"
    : `https://${trimmedLocation}-aiplatform.googleapis.com`;
  return `${endpoint}/v1/projects/${encodeURIComponent(project.trim())}/locations/${encodeURIComponent(trimmedLocation)}`;
}

function googleVertexProviderOptionsFromSource(source = {}) {
  const options = source?.options || {};
  const out = {};
  const project = firstStringValue(options, [
    "project",
    "projectId",
    "projectID",
    "googleCloudProject",
    "google_cloud_project",
    "googleVertexProject",
    "google_vertex_project",
  ]);
  const location = firstStringValue(options, [
    "location",
    "region",
    "vertexLocation",
    "vertex_location",
    "googleVertexLocation",
    "google_vertex_location",
  ]);
  if (project) out.project = project;
  if (location) out.location = location;

  for (const key of [
    "credentialsFile",
    "credentials_file",
    "keyFile",
    "keyfile",
    "keyFilename",
    "key_filename",
    "googleApplicationCredentials",
    "google_application_credentials",
  ]) {
    const value = options[key];
    if (typeof value === "string" && value.trim()) {
      out.credentialsFile = value.trim();
      break;
    }
  }

  for (const key of [
    "googleAuthCredentials",
    "authCredentials",
    "credentials",
    "serviceAccount",
    "service_account",
    "adcCredentials",
    "adc_credentials",
  ]) {
    const value = options[key];
    if (value && (typeof value === "string" || typeof value === "object")) {
      out.googleAuthCredentials = value;
      break;
    }
  }

  return Object.keys(out).length ? out : undefined;
}

function parseGoogleAuthCredentials(value) {
  const root = serviceKeyObjectFromUnknown(value) || {};
  const source = root.credentials && typeof root.credentials === "object" && !Array.isArray(root.credentials)
    ? root.credentials
    : root;
  if (source.type === "service_account") {
    return typeof source.client_email === "string" &&
      source.client_email.trim() &&
      typeof source.private_key === "string" &&
      source.private_key.trim()
      ? source
      : undefined;
  }
  if (source.type === "authorized_user") {
    return typeof source.client_id === "string" &&
      source.client_id.trim() &&
      typeof source.client_secret === "string" &&
      source.client_secret.trim() &&
      typeof source.refresh_token === "string" &&
      source.refresh_token.trim()
      ? source
      : undefined;
  }
  return undefined;
}

function googleAuthCredentialsFromFile(filePath) {
  try {
    return parseGoogleAuthCredentials(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function resolveGoogleAuthCredentials(options = {}, env = process.env) {
  for (const key of [
    "googleAuthCredentials",
    "authCredentials",
    "credentials",
    "serviceAccount",
    "service_account",
    "adcCredentials",
    "adc_credentials",
  ]) {
    const parsed = parseGoogleAuthCredentials(options?.[key]);
    if (parsed) return parsed;
  }
  const credentialsFile =
    firstStringValue(options, [
      "credentialsFile",
      "credentials_file",
      "keyFile",
      "keyfile",
      "keyFilename",
      "key_filename",
      "googleApplicationCredentials",
      "google_application_credentials",
      "credentials",
    ]) ||
    env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialsFile?.trim()) {
    const parsed = googleAuthCredentialsFromFile(credentialsFile.trim());
    if (parsed) return parsed;
  }
  return googleAuthCredentialsFromFile(path.join(HOME, ".config", "gcloud", "application_default_credentials.json"));
}

function serviceKeyObjectFromUnknown(value) {
  if (!value) return undefined;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return undefined;
}

function sapAiCoreBaseUrlFromServiceKey(serviceKey) {
  if (!serviceKey) return undefined;
  const credentials = serviceKey.credentials && typeof serviceKey.credentials === "object" && !Array.isArray(serviceKey.credentials)
    ? serviceKey.credentials
    : serviceKey;
  const serviceUrls = credentials.serviceurls && typeof credentials.serviceurls === "object" && !Array.isArray(credentials.serviceurls)
    ? credentials.serviceurls
    : {};
  const found =
    firstStringValue(serviceUrls, ["AI_API_URL", "AI_API_URL_V2", "ai_api_url", "apiUrl"]) ||
    firstStringValue(credentials, ["aiApiUrl", "ai_api_url", "apiUrl"]);
  return found && /^https?:\/\//.test(found) ? found : undefined;
}

function sapAiCoreBaseUrlFromOptions(options = {}, env = process.env) {
  const explicit = firstStringValue(options, ["baseURL", "baseUrl", "base_url", "endpoint", "apiUrl", "AI_API_URL"]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;
  for (const key of ["serviceKey", "service_key", "aicoreServiceKey", "aicore_service_key", "apiKey", "api_key"]) {
    const fromOption = sapAiCoreBaseUrlFromServiceKey(serviceKeyObjectFromUnknown(options[key]));
    if (fromOption) return fromOption;
  }
  return sapAiCoreBaseUrlFromServiceKey(serviceKeyObjectFromUnknown(env.AICORE_SERVICE_KEY));
}

function sapAiCoreProviderOptionsFromSource(source) {
  const options = source?.options || {};
  const out = {};
  for (const key of ["deploymentId", "deployment_id", "resourceGroup", "resource_group", "modelVersion", "model_version"]) {
    const value = options[key];
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

function providerAdapterFromNpm(providerId, npmPackage) {
  const id = sanitizeProviderId(providerId);
  const npm = String(npmPackage || "").trim().toLowerCase();
  if (id === "openai-chatgpt") return "openai";
  if (id === "mistral") return "mistral";
  if (id === "zai") return "zai";
  if (id === "vercel" || npm === "@ai-sdk/gateway") return "gateway";
  if (openAiCompatibleSdkProviderDefaults[id]) return "openai-compatible";
  if (id === "cloudflare-ai-gateway" || npm.includes("ai-gateway-provider")) return "openai-compatible";
  if (openAiCompatibleDefaultFromNpm(npm)) return "openai-compatible";
  if (npm === "@ai-sdk/openai" || npm.includes("openai-compatible")) return "openai-compatible";
  if (npm === "@openrouter/ai-sdk-provider") return "openai-compatible";
  if (npm === "@ai-sdk/mistral") return "mistral";
  if (npm === "@ai-sdk/anthropic") return "anthropic";
  if (npm === "@ai-sdk/google") return "google";
  if (npm === "@ai-sdk/cohere") return "cohere";
  if (npm === "@ai-sdk/vercel") return "openai-compatible";
  if (npm === "@ai-sdk/azure") return "azure";
  if (npm === "@ai-sdk/amazon-bedrock/mantle") return "openai-compatible";
  if (npm === "@ai-sdk/amazon-bedrock") return "amazon-bedrock";
  if (npm === "@ai-sdk/google-vertex/anthropic") return "vertex-anthropic";
  if (npm === "@ai-sdk/google-vertex") return "vertex";
  if (npm === "gitlab-ai-provider" || npm === "@gitlab/gitlab-ai-provider") return "gitlab";
  if (id === "sap-ai-core" || npm.includes("sap-ai-provider") || npm.includes("@sap-ai-sdk")) return "sap-ai-core";
  if (npm.includes("google-vertex")) return "unsupported";
  return "unsupported";
}

function isRuntimeSupportedAdapter(adapter) {
  return adapter === "openai" || adapter === "openai-compatible" || adapter === "mistral" || adapter === "zai" || adapter === "anthropic" || adapter === "google" || adapter === "cohere" || adapter === "gateway" || adapter === "amazon-bedrock" || adapter === "vertex" || adapter === "vertex-anthropic" || adapter === "gitlab" || adapter === "sap-ai-core";
}

function providerForAdapter(providerId, adapter) {
  return isRuntimeSupportedAdapter(adapter) ? adapter : sanitizeProviderId(providerId);
}

function tokenEnvForProvider(providerId, adapter, env) {
  const sourceEnv = Array.isArray(env) ? env.filter((value) => typeof value === "string") : [];
  if (providerId === "vercel" || adapter === "gateway") {
    return sourceEnv.length ? sourceEnv : ["AI_GATEWAY_API_KEY"];
  }
  if (providerId === "amazon-bedrock" || adapter === "amazon-bedrock") {
    return [
      "AWS_BEARER_TOKEN_BEDROCK",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_PROFILE",
      "AWS_DEFAULT_PROFILE",
      "AWS_REGION",
      "AWS_DEFAULT_REGION",
      "AWS_SHARED_CREDENTIALS_FILE",
    ];
  }
  if (
    providerId === "google-vertex" ||
    providerId === "google-vertex-anthropic" ||
    adapter === "vertex" ||
    adapter === "vertex-anthropic"
  ) {
    return [
      "GOOGLE_VERTEX_ACCESS_TOKEN",
      "GOOGLE_ACCESS_TOKEN",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "GOOGLE_CLOUD_PROJECT",
      "GOOGLE_VERTEX_PROJECT",
      "VERTEX_LOCATION",
      "GOOGLE_VERTEX_LOCATION",
    ];
  }
  if (providerId === "snowflake-cortex") {
    return [
      "SNOWFLAKE_ACCOUNT",
      "SNOWFLAKE_CORTEX_TOKEN",
      "SNOWFLAKE_CORTEX_PAT",
    ];
  }
  if (providerId === "cloudflare-workers-ai") {
    return [
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_KEY",
      "CLOUDFLARE_GATEWAY_ID",
    ];
  }
  if (providerId === "sap-ai-core" || adapter === "sap-ai-core") {
    return ["AICORE_SERVICE_KEY"];
  }
  return sourceEnv;
}

function modelsDevProviderToPreset(providerId, source) {
  const id = sanitizeProviderId(source?.id || providerId);
  const openAiCompatibleDefault =
    openAiCompatibleSdkProviderDefaults[id] ||
    openAiCompatibleDefaultFromNpm(source?.npm);
  const cloudflareAiGatewayBaseUrl =
    id === "cloudflare-ai-gateway"
      ? cloudflareAiGatewayBaseUrlFromOptions(source?.options)
      : undefined;
  const cloudflareWorkersAiBaseUrl =
    id === "cloudflare-workers-ai"
      ? cloudflareWorkersAiBaseUrlFromOptions(source?.options)
      : undefined;
  const isAzureOpenAiProvider = isAzureOpenAiProviderSource(id, source?.npm);
  const azureOpenAiBaseUrl = isAzureOpenAiProvider
    ? azureOpenAiBaseUrlFromOptions(id, source?.options, process.env, true)
    : undefined;
  const bedrockBaseUrl =
    id === "amazon-bedrock"
      ? amazonBedrockBaseUrlFromOptions(source?.options)
      : undefined;
  const vertexBaseUrl =
    id === "google-vertex" || id === "google-vertex-anthropic"
      ? vertexBaseUrlFromOptions(source?.options)
      : undefined;
  const sapBaseUrl = id === "sap-ai-core" ? sapAiCoreBaseUrlFromOptions(source?.options) : undefined;
  const gatewayBaseUrl =
    id === "vercel" || String(source?.npm || "").trim().toLowerCase() === "@ai-sdk/gateway"
      ? (source?.api || "https://ai-gateway.vercel.sh/v3/ai")
      : undefined;
  const openAiCompatibleBaseUrl =
    source?.api || openAiCompatibleDefault?.baseUrl || cloudflareAiGatewayBaseUrl || cloudflareWorkersAiBaseUrl || azureOpenAiBaseUrl;
  const requiresOpenAiCompatibleEndpoint =
    id === "cloudflare-ai-gateway" || id === "cloudflare-workers-ai" || isAzureOpenAiProvider;
  const adapter =
    requiresOpenAiCompatibleEndpoint
      ? "openai-compatible"
      : providerAdapterFromNpm(id, source?.npm);
  const baseUrl = adapter === "openai-compatible"
    ? normalizeOpenAiCompatibleBaseUrl(openAiCompatibleBaseUrl)
    : normalizeBaseUrl(source?.api || (adapter === "anthropic" ? "https://api.anthropic.com" : adapter === "google" ? "https://generativelanguage.googleapis.com" : adapter === "cohere" ? "https://api.cohere.com" : adapter === "gateway" ? gatewayBaseUrl : adapter === "amazon-bedrock" ? bedrockBaseUrl : adapter === "vertex" || adapter === "vertex-anthropic" ? vertexBaseUrl : adapter === "gitlab" ? "https://gitlab.com" : adapter === "sap-ai-core" ? sapBaseUrl : undefined));
  const runtimeSupported =
    isRuntimeSupportedAdapter(adapter) &&
    ((adapter !== "vertex" && adapter !== "vertex-anthropic") || Boolean(vertexBaseUrl)) &&
    (!requiresOpenAiCompatibleEndpoint || Boolean(baseUrl)) &&
    (adapter !== "openai-compatible" ||
      openAiCompatibleBaseUrl === undefined ||
      Boolean(baseUrl));
  const tokenEnv = tokenEnvForProvider(id, adapter, source?.env);
  const authType =
    adapter === "openai-compatible" &&
    isLocalHttpBaseUrl(baseUrl) &&
    !sourceOptionsCarrySecret(source?.options) &&
    !tokenEnvHasSecret(tokenEnv)
      ? "none"
      : "api-key";
  return {
    label: source?.name || id,
    provider: providerForAdapter(id, adapter),
    providerId: id,
    providerAdapter: adapter,
    providerNpm: source?.npm,
    providerSource: "models.dev",
    providerDoc: source?.doc,
    baseUrl,
    openAiPathPrefix: openAiCompatibleDefault?.openAiPathPrefix,
    upstreamMode: adapter === "openai-compatible" ? (isAzureOpenAiProvider ? "responses" : (openAiCompatibleDefault?.upstreamMode || "chat/completions")) : undefined,
    compatibilityMode: adapter === "openai-compatible" ? (isAzureOpenAiProvider ? "responses" : (openAiCompatibleDefault?.compatibilityMode || "chat-completions-bridge")) : undefined,
    disabledModels: openAiCompatibleDefault?.disabledModels,
    providerOptions: adapter === "amazon-bedrock"
      ? amazonBedrockProviderOptionsFromSource(source)
      : adapter === "vertex" || adapter === "vertex-anthropic"
        ? googleVertexProviderOptionsFromSource(source)
      : adapter === "sap-ai-core"
        ? sapAiCoreProviderOptionsFromSource(source)
      : id === "cloudflare-ai-gateway" || id === "cloudflare-workers-ai"
        ? cloudflareGatewayProviderOptionsFromSource(source)
        : undefined,
    tokenEnv,
    authType,
    models: source?.models && typeof source.models === "object" ? source.models : undefined,
    runtimeSupported,
  };
}

async function loadModelsDevAuthProviders() {
  if (modelsDevAuthProviderCache) return new Map(modelsDevAuthProviderCache);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.MODELS_DEV_TIMEOUT_MS || 2500));
  try {
    const res = await fetch(MODELS_DEV_API_URL, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`models.dev returned ${res.status}`);
    const payload = await res.json();
    const entries = new Map();
    for (const [id, body] of Object.entries(payload || {})) {
      if (!body || typeof body !== "object") continue;
      try {
        const preset = modelsDevProviderToPreset(id, body);
        entries.set(preset.providerId, preset);
      } catch {
        // Keep one malformed upstream provider from disabling the whole catalog.
      }
    }
    modelsDevAuthProviderCache = entries;
    return new Map(entries);
  } catch {
    return new Map();
  } finally {
    clearTimeout(timeout);
  }
}

const reasoning = [
  { effort: "low", description: "Fast responses with lighter reasoning" },
  { effort: "medium", description: "Balances speed and reasoning depth" },
  { effort: "high", description: "Greater reasoning depth for complex tasks" },
];

const xReasoning = [
  ...reasoning,
  { effort: "xhigh", description: "Extra high reasoning depth for complex tasks" },
];

const fastTier = {
  additional_speed_tiers: ["fast"],
  service_tiers: [
    {
      id: FAST_SERVICE_TIER,
      name: "Fast",
      description: "1.5x speed, increased usage",
    },
  ],
  default_service_tier: FAST_SERVICE_TIER,
};

const visibleFastTier = {
  service_tiers: fastTier.service_tiers,
  additional_speed_tiers: fastTier.additional_speed_tiers,
};

const baseInstructions = `You are Codex, a coding agent based on GPT-5. You and the user share one workspace, and your job is to collaborate with them until their goal is genuinely handled.

# General
You are a pragmatic software engineering agent. Read the local state before acting, make scoped changes, and verify results before claiming completion.
`;

const modelCapabilities = {
  supports_reasoning_summaries: true,
  default_reasoning_summary: "none",
  support_verbosity: true,
  default_verbosity: "low",
  apply_patch_tool_type: "freeform",
  web_search_tool_type: "text_and_image",
  truncation_policy: {
    mode: "tokens",
    limit: 10000,
  },
  supports_parallel_tool_calls: true,
  supports_image_detail_original: true,
  context_window: 819200,
  max_context_window: 819200,
  comp_hash: "multicodex",
  effective_context_window_percent: 95,
  experimental_supported_tools: [],
  input_modalities: ["text", "image"],
  supports_search_tool: true,
  use_responses_lite: false,
};

const gptMetadata = {
  "gpt-5.5": {
    display_name: "GPT-5.5",
    description: "Frontier model for complex coding, research, and real-world work.",
    priority: 0,
    default_reasoning_level: "medium",
    supported_reasoning_levels: xReasoning,
    ...fastTier,
  },
  "gpt-5.4": {
    display_name: "GPT-5.4",
    description: "Strong model for everyday coding.",
    priority: 1,
    default_reasoning_level: "medium",
    supported_reasoning_levels: xReasoning,
    ...fastTier,
  },
  "gpt-5.4-mini": {
    display_name: "GPT-5.4 Mini",
    description: "Small, fast, and cost-efficient model for simpler coding tasks.",
    priority: 2,
    default_reasoning_level: "medium",
    supported_reasoning_levels: xReasoning,
  },
  "gpt-5.3-codex-spark": {
    display_name: "GPT-5.3 Codex Spark",
    description: "Ultra-fast coding model.",
    priority: 6,
    default_reasoning_level: "medium",
    supported_reasoning_levels: xReasoning,
  },
  "codex-auto-review": {
    display_name: "Codex Auto Review",
    description: "Codex auto-review model.",
    priority: 40,
    default_reasoning_level: "medium",
    supported_reasoning_levels: xReasoning,
    visibility: "hide",
  },
};

function titleCaseModel(id) {
  return id
    .replace(/^zai-org\//, "")
    .replace(/^moonshotai\//, "")
    .replace(/[-_/]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bGpt\b/g, "GPT")
    .replace(/\bGlm\b/g, "GLM")
    .replace(/\bQwen\b/g, "Qwen")
    .replace(/\bKimi\b/g, "Kimi");
}

function priorityFor(id, index) {
  if (gptMetadata[id]) return gptMetadata[id].priority;
  if (id.includes("glm-5.2-fast")) return 102;
  if (id.includes("glm-5.2")) return 103;
  if (id.includes("glm-5.1-fast")) return 104;
  if (id.includes("kimi-k2.7-code")) return 105;
  if (id.includes("qwen")) return 130 + index;
  if (id.toLowerCase().includes("kimi")) return 150 + index;
  if (id.toLowerCase().includes("glm")) return 170 + index;
  return 200 + index;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

async function healthOk() {
  try {
    await fetchJson(`${BASE}/health`);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function migrateLegacyData() {
  if (
    process.env.MULTICODEX_DATA_DIR ||
    process.env.MULTICODEX_STORE_PATH ||
    process.env.STORE_PATH
  ) {
    return;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const legacyDataDir of LEGACY_DATA_DIRS) {
    if (!fs.existsSync(legacyDataDir) || path.resolve(DATA_DIR) === path.resolve(legacyDataDir)) {
      continue;
    }

    for (const fileName of ["accounts.json", "oauth-state.json", "requests-trace.jsonl", "requests-stats-history.jsonl"]) {
      const from = path.join(legacyDataDir, fileName);
      const to = path.join(DATA_DIR, fileName);
      if (!fs.existsSync(to) && fs.existsSync(from)) {
        fs.copyFileSync(from, to);
        fs.chmodSync(to, 0o600);
      }
    }
  }
}

function findServerPids() {
  if (process.platform !== "linux") return [];
  const procDir = "/proc";
  let entries = [];
  try {
    entries = fs.readdirSync(procDir);
  } catch {
    return [];
  }

  const pids = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;

    try {
      const cwd = fs.realpathSync(path.join(procDir, entry, "cwd"));
      if (cwd !== ROOT) continue;
      const cmdline = fs.readFileSync(path.join(procDir, entry, "cmdline"), "utf8").replace(/\0/g, " ");
      if (!cmdline.includes("node") || !cmdline.includes("dist/server.js")) continue;

      const env = Object.fromEntries(
        fs
          .readFileSync(path.join(procDir, entry, "environ"), "utf8")
          .split("\0")
          .filter(Boolean)
          .map((line) => {
            const index = line.indexOf("=");
            return index === -1 ? [line, ""] : [line.slice(0, index), line.slice(index + 1)];
          }),
      );
      if (env.PORT === PORT) {
        pids.push(pid);
      }
    } catch {
      // Process exited or is not readable.
    }
  }
  return pids;
}

async function stopServer() {
  const pids = findServerPids();
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }

  if (!pids.length) return;
  for (let i = 0; i < 30; i += 1) {
    if (findServerPids().length === 0 && !(await healthOk())) return;
    await sleep(100);
  }

  for (const pid of findServerPids()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

async function startServer() {
  if (await healthOk()) return;

  migrateLegacyData();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const out = fs.openSync(path.join(DATA_DIR, "server.log"), "a");
  const child = spawn(process.execPath, ["dist/server.js"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", out, out],
    env: {
      ...process.env,
      PORT,
      STORE_PATH,
      OAUTH_STATE_PATH,
      TRACE_FILE_PATH,
      TRACE_STATS_HISTORY_PATH,
      PROXY_MODELS: process.env.MULTICODEX_PROXY_MODELS || DEFAULT_PROXY_MODELS,
    },
  });
  child.unref();

  for (let i = 0; i < 40; i += 1) {
    if (await healthOk()) return;
    await sleep(250);
  }
  throw new Error(`MultiCodex proxy did not start at ${BASE}`);
}

async function listModels() {
  await startServer();
  const payload = await fetchJson(`${BASE}/v1/models`);
  return (payload.data || []).map((model) => model.id).filter(Boolean);
}

async function printModels(opts = {}) {
  const models = await listModels();
  if (opts.json) {
    console.log(JSON.stringify({ baseUrl: BASE, count: models.length, models }, null, 2));
    return;
  }

  console.log(`proxy: ${BASE}`);
  console.log(`models: ${models.length}`);
  for (const model of models) console.log(model);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadBundledCatalog() {
  const result = spawnSync(CODEX_BIN, ["debug", "models", "--bundled"], {
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_MODEL_PICKER: "0",
    },
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "").trim();
    console.warn(`Warning: failed to read bundled Codex model catalog via ${CODEX_BIN}${details ? `: ${details}` : ""}`);
    return new Map();
  }

  try {
    const payload = JSON.parse(result.stdout);
    return new Map((payload.models || []).filter((model) => model?.slug).map((model) => [model.slug, model]));
  } catch (err) {
    console.warn(`Warning: failed to parse bundled Codex model catalog: ${err instanceof Error ? err.message : String(err)}`);
    return new Map();
  }
}

function fallbackTemplate() {
  return {
    shell_type: "shell_command",
    visibility: "list",
    supported_in_api: true,
    availability_nux: null,
    upgrade: null,
    base_instructions: baseInstructions,
    ...modelCapabilities,
  };
}

function templateFor(id, bundledCatalog) {
  if (bundledCatalog.has(id)) return clone(bundledCatalog.get(id));
  if (id === "gpt-5.3-codex-spark" && bundledCatalog.has("gpt-5.3-codex")) {
    return clone(bundledCatalog.get("gpt-5.3-codex"));
  }
  if (bundledCatalog.has("gpt-5.5")) return clone(bundledCatalog.get("gpt-5.5"));
  return fallbackTemplate();
}

function makeCatalog(models, bundledCatalog = loadBundledCatalog()) {
  return {
    models: models.map((id, index) => {
      const gpt = gptMetadata[id];
      const template = templateFor(id, bundledCatalog);
      const customModel = !gpt;
      const contextWindow = id === "gpt-5.3-codex-spark" ? 128000 : 819200;

      return {
        ...template,
        slug: id,
        display_name: gpt?.display_name || titleCaseModel(id),
        description: gpt?.description || `MultiCodex routed model ${id}`,
        default_reasoning_level: gpt?.default_reasoning_level || "medium",
        supported_reasoning_levels: gpt?.supported_reasoning_levels || reasoning,
        shell_type: template.shell_type || "shell_command",
        visibility: gpt?.visibility || "list",
        supported_in_api: true,
        priority: priorityFor(id, index),
        additional_speed_tiers: gpt?.additional_speed_tiers || visibleFastTier.additional_speed_tiers,
        service_tiers: gpt?.service_tiers || visibleFastTier.service_tiers,
        default_service_tier: gpt?.default_service_tier || FAST_SERVICE_TIER,
        availability_nux: null,
        upgrade: null,
        web_search_tool_type: customModel ? "text" : template.web_search_tool_type,
        context_window: contextWindow,
        max_context_window: contextWindow,
        comp_hash: "multicodex",
      };
    }),
  };
}

function replaceTopLevelToml(source, key, value) {
  const line = `${key} = ${JSON.stringify(value)}`;
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=.*$`, "m");
  if (re.test(source)) return source.replace(re, line);
  return `${line}\n${source}`;
}

function upsertProviderBlock(source) {
  const block = `[model_providers.multicodex]
name = "MultiCodex Proxy"
base_url = "${BASE}/v1"
wire_api = "responses"
`;
  const re = /\n?\[model_providers\.multicodex\]\n(?:[^\n]*\n)*(?=\n\[|$)/m;
  if (re.test(source)) return source.replace(re, `\n${block}`);
  return `${source.trimEnd()}\n\n${block}`;
}

function removeProviderBlock(source) {
  return source.replace(/\n?\[model_providers\.multicodex\]\n(?:[^\n]*\n)*(?=\n\[|$)/m, "\n");
}

function upsertTableValue(source, table, key, value) {
  const header = `[${table}]`;
  const line = `${key} = ${JSON.stringify(value)}`;
  const tableRe = new RegExp(`(^\\[${table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\n)([\\s\\S]*?)(?=^\\[|\\z)`, "m");
  const match = source.match(tableRe);
  if (!match) return `${source.trimEnd()}\n\n${header}\n${line}\n`;

  const body = match[2];
  const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=.*$`, "m");
  const nextBody = keyRe.test(body) ? body.replace(keyRe, line) : `${line}\n${body}`;
  return source.replace(tableRe, `${match[1]}${nextBody}`);
}

function removeTopLevelToml(source, key, predicate = () => true) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}\\s*=\\s*(.*)$`, "m");
  const match = source.match(re);
  if (!match) return source;
  return predicate(match[1].trim()) ? source.replace(re, "").replace(/\n{3,}/g, "\n\n") : source;
}

function writeExecutable(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { mode: 0o755 });
  fs.chmodSync(filePath, 0o755);
}

function shellDefault(value) {
  return String(value).replace(/(["\\$`])/g, "\\$1");
}

async function canonicalAuthProvider(name, opts = {}) {
  const raw = String(name || "").trim().toLowerCase();
  const canonical = authProviderAliases[raw] || raw;
  const builtin = authProviderPresets[canonical];
  if (builtin) return { name: canonical, preset: builtin };

  const modelsDev = await loadModelsDevAuthProviders();
  const modelsDevPreset = modelsDev.get(canonical);
  if (modelsDevPreset) {
    return {
      name: canonical,
      preset: {
        ...modelsDevPreset,
        baseUrl:
          modelsDevPreset.providerAdapter === "openai-compatible"
            ? normalizeOpenAiCompatibleBaseUrl(optionValue(opts, "base-url", "baseUrl") || modelsDevPreset.baseUrl)
            : normalizeBaseUrl(optionValue(opts, "base-url", "baseUrl") || modelsDevPreset.baseUrl),
      },
    };
  }

  const baseUrl = optionValue(opts, "base-url", "baseUrl");
  if (baseUrl) {
    const providerId = sanitizeProviderId(name) || "openai-compatible";
    return {
      name: providerId,
      preset: {
        label: providerId,
        provider: "openai-compatible",
        providerId,
        providerAdapter: "openai-compatible",
        providerNpm: "@ai-sdk/openai-compatible",
        providerSource: "manual",
        baseUrl: normalizeOpenAiCompatibleBaseUrl(baseUrl),
        upstreamMode: "chat/completions",
        compatibilityMode: "chat-completions-bridge",
        tokenEnv: [],
        runtimeSupported: true,
      },
    };
  }

  const providerId = sanitizeProviderId(name);
  if (providerId) {
    return {
      name: providerId,
      preset: {
        label: providerId,
        provider: providerId,
        providerId,
        providerAdapter: "unsupported",
        providerSource: "manual",
        tokenEnv: [],
        runtimeSupported: false,
      },
    };
  }

  throw new Error(`Unknown auth provider "${name}". Run: opencodex auth providers`);
}

function parseCliOptions(argv) {
  const opts = { _: [] };
  const booleanFlags = new Set(["stdin", "disabled", "enabled", "reset-state", "json"]);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      opts._.push(arg);
      continue;
    }

    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      opts[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }

    if (booleanFlags.has(body)) {
      opts[body] = true;
      continue;
    }

    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      opts[body] = true;
      continue;
    }

    opts[body] = next;
    i += 1;
  }

  return opts;
}

function optionValue(opts, ...names) {
  for (const name of names) {
    if (opts[name] !== undefined && opts[name] !== true) return String(opts[name]);
  }
  return undefined;
}

function normalizeBaseUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const expanded = expandEnvTemplates(raw);
  if (!expanded?.trim()) return undefined;
  try {
    const parsed = new URL(expanded);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("base URL must use http or https");
    }
  } catch (err) {
    throw new Error(`Invalid base URL "${expanded}": ${err instanceof Error ? err.message : String(err)}`);
  }
  return expanded.replace(/\/+$/, "");
}

function normalizeOpenAiCompatibleBaseUrl(value) {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return undefined;
  return normalized.replace(/\/v1$/i, "");
}

function normalizeUpstreamMode(value) {
  if (value === undefined || value === true || value === "") return undefined;
  if (value === "responses" || value === "chat/completions") return value;
  throw new Error(`Invalid upstream mode "${value}". Use responses or chat/completions.`);
}

function normalizeCompatibilityMode(value) {
  if (value === undefined || value === true || value === "") return undefined;
  if (value === "auto" || value === "responses" || value === "chat-completions-bridge") return value;
  throw new Error(`Invalid compatibility mode "${value}". Use auto, responses, or chat-completions-bridge.`);
}

function parseOptionalNumber(value, label) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a finite number`);
  return n;
}

function defaultStoreFile() {
  return { accounts: [], modelAliases: [], settings: {} };
}

function readStoreFile() {
  migrateLegacyData();
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  if (!fs.existsSync(STORE_PATH)) return defaultStoreFile();
  const raw = fs.readFileSync(STORE_PATH, "utf8").trim();
  if (!raw) return defaultStoreFile();
  const data = JSON.parse(raw);
  return {
    accounts: Array.isArray(data.accounts) ? data.accounts : [],
    modelAliases: Array.isArray(data.modelAliases) ? data.modelAliases : [],
    settings: data.settings && typeof data.settings === "object" && !Array.isArray(data.settings) ? data.settings : {},
  };
}

function writeStoreFile(store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.tmp-${randomUUID()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, STORE_PATH);
}

function redactSecret(value) {
  const raw = String(value || "");
  if (!raw) return "";
  if (raw.length <= 12) return `${raw.slice(0, 3)}...`;
  return `${raw.slice(0, 8)}...${raw.slice(-4)}`;
}

function redactAccount(account) {
  return {
    id: account.id,
    provider: account.provider || "openai",
    enabled: account.enabled !== false,
    priority: account.priority ?? 0,
    upstreamMode: account.upstreamMode,
    compatibilityMode: account.compatibilityMode,
    baseUrl: account.baseUrl,
    email: account.email,
    accessToken: redactSecret(account.accessToken),
    refreshToken: account.refreshToken ? redactSecret(account.refreshToken) : undefined,
    chatgptAccountId: account.chatgptAccountId,
  };
}

function readToken(opts, preset) {
  const direct = optionValue(opts, "token");
  if (direct) return direct.trim();

  const tokenEnv = optionValue(opts, "token-env");
  if (tokenEnv) {
    const value = process.env[tokenEnv];
    if (!value) throw new Error(`Environment variable ${tokenEnv} is empty or unset`);
    return value.trim();
  }

  if (opts.stdin) {
    return fs.readFileSync(0, "utf8").trim();
  }

  for (const envName of preset.tokenEnv || []) {
    const value = process.env[envName];
    if (value) return value.trim();
  }

  throw new Error("No token provided. Use --token, --token-env ENV, --stdin, or the provider's default env var.");
}

async function printAuthProviders() {
  const providers = await loadModelsDevAuthProviders();
  for (const [name, preset] of Object.entries(authProviderPresets)) {
    providers.set(name, preset);
  }
  const sorted = Array.from(providers.entries()).sort((a, b) =>
    String(a[1].label || a[0]).localeCompare(String(b[1].label || b[0])),
  );
  for (const [name, preset] of sorted) {
    const pieces = [
      name.padEnd(18),
      preset.provider,
      preset.providerAdapter ? `adapter=${preset.providerAdapter}` : "",
      preset.baseUrl ? `base=${preset.baseUrl}` : "",
      preset.upstreamMode ? `mode=${preset.upstreamMode}` : "",
      preset.compatibilityMode ? `compat=${preset.compatibilityMode}` : "",
      preset.tokenEnv?.length ? `env=${preset.tokenEnv.join("|")}` : "",
      preset.runtimeSupported === false ? "auth-only" : "",
      `- ${preset.label}`,
    ].filter(Boolean);
    console.log(pieces.join("  "));
  }
}

function authList(opts = {}) {
  const store = readStoreFile();
  if (opts.json) {
    console.log(JSON.stringify({ storePath: STORE_PATH, accounts: store.accounts.map(redactAccount) }, null, 2));
    return;
  }

  console.log(`store: ${STORE_PATH}`);
  if (!store.accounts.length) {
    console.log("accounts: none");
    return;
  }

  for (const account of store.accounts) {
    const redacted = redactAccount(account);
    console.log(
      [
        redacted.id,
        `provider=${redacted.provider}`,
        `enabled=${redacted.enabled}`,
        `priority=${redacted.priority}`,
        redacted.baseUrl ? `base=${redacted.baseUrl}` : "",
        redacted.upstreamMode ? `mode=${redacted.upstreamMode}` : "",
        redacted.compatibilityMode ? `compat=${redacted.compatibilityMode}` : "",
        redacted.accessToken ? `token=${redacted.accessToken}` : "",
        redacted.email ? `email=${redacted.email}` : "",
      ]
        .filter(Boolean)
        .join("  "),
    );
  }
}

function upsertAccount(account, resetState = false) {
  const store = readStoreFile();
  const existingIndex = store.accounts.findIndex((entry) => entry.id === account.id);
  const existing = existingIndex === -1 ? undefined : store.accounts[existingIndex];
  const next = {
    ...existing,
    ...account,
    usage: resetState ? undefined : (account.usage ?? existing?.usage),
    state: resetState ? undefined : (account.state ?? existing?.state),
  };

  if (existingIndex === -1) {
    store.accounts.push(next);
  } else {
    store.accounts[existingIndex] = next;
  }

  writeStoreFile(store);
  return next;
}

async function authLogin(providerName, opts = {}) {
  let name;
  let preset;
  ({ name, preset } = await canonicalAuthProvider(providerName, opts));
  const token =
    preset.authType === "none" ? NO_AUTH_ACCESS_TOKEN : readToken(opts, preset);
  if (!token) throw new Error("Token is empty");

  const providerAdapter = optionValue(opts, "provider-adapter", "providerAdapter") || preset.providerAdapter || preset.provider;
  const baseUrl = providerAdapter === "openai-compatible"
    ? normalizeOpenAiCompatibleBaseUrl(optionValue(opts, "base-url", "baseUrl") || preset.baseUrl)
    : normalizeBaseUrl(optionValue(opts, "base-url", "baseUrl") || preset.baseUrl);
  const provider = optionValue(opts, "provider") || preset.provider;
  if (providerAdapter === "openai-compatible" && !baseUrl) {
    throw new Error("--base-url is required for openai-compatible accounts");
  }

  const upstreamMode = normalizeUpstreamMode(optionValue(opts, "upstream-mode", "upstreamMode") || preset.upstreamMode);
  const compatibilityMode = normalizeCompatibilityMode(
    optionValue(opts, "compatibility-mode", "compatibilityMode") || preset.compatibilityMode,
  );
  const id = optionValue(opts, "id") || `${name}-${randomUUID().slice(0, 8)}`;
  const priority = parseOptionalNumber(optionValue(opts, "priority"), "priority") ?? 0;
  const expiresAt = parseOptionalNumber(optionValue(opts, "expires-at", "expiresAt"), "expiresAt");
  const refreshToken = optionValue(opts, "refresh-token", "refreshToken");
  const chatgptAccountId = optionValue(opts, "chatgpt-account-id", "chatgptAccountId");
  const email = optionValue(opts, "email") || id;
  const runtimeSupported = preset.runtimeSupported !== false && isRuntimeSupportedAdapter(providerAdapter);
  const enabled = opts.enabled ? runtimeSupported : !opts.disabled && runtimeSupported;

  const account = {
    id,
    provider,
    providerId: preset.providerId || name,
    providerAdapter,
    providerLabel: preset.label,
    providerNpm: preset.providerNpm,
    providerSource: preset.providerSource || "manual",
    providerDoc: preset.providerDoc,
    providerAuthEnv: preset.tokenEnv,
    providerAuthType: preset.authType,
    providerOptions: preset.providerOptions,
    providerModels: preset.models,
    upstreamMode,
    compatibilityMode,
    openAiPathPrefix: preset.openAiPathPrefix,
    email,
    accessToken: token,
    refreshToken,
    expiresAt,
    chatgptAccountId,
    baseUrl,
    enabled,
    priority,
    state: runtimeSupported ? undefined : { lastError: `${providerAdapter} adapter not implemented yet` },
  };
  const saved = upsertAccount(account, Boolean(opts["reset-state"]));
  console.log(`saved: ${saved.id} provider=${saved.provider || "openai"} enabled=${saved.enabled !== false}`);
  if (!runtimeSupported) {
    console.log(`auth-only: ${providerAdapter} adapter is not implemented in the proxy yet`);
  }
}

function authRemove(id) {
  if (!id) throw new Error("account id required");
  const store = readStoreFile();
  const before = store.accounts.length;
  store.accounts = store.accounts.filter((account) => account.id !== id);
  if (store.accounts.length === before) throw new Error(`account not found: ${id}`);
  writeStoreFile(store);
  console.log(`removed: ${id}`);
}

function authSetEnabled(id, enabled) {
  if (!id) throw new Error("account id required");
  const store = readStoreFile();
  const account = store.accounts.find((entry) => entry.id === id);
  if (!account) throw new Error(`account not found: ${id}`);
  account.enabled = enabled;
  writeStoreFile(store);
  console.log(`${enabled ? "enabled" : "disabled"}: ${id}`);
}

function normalizeSecret(value) {
  return String(value || "").trim().replace(/^Bearer\s+/i, "").trim();
}

function isSapServiceKeyObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const credentials = value.credentials && typeof value.credentials === "object" && !Array.isArray(value.credentials)
    ? value.credentials
    : value;
  const serviceUrls = credentials.serviceurls && typeof credentials.serviceurls === "object" && !Array.isArray(credentials.serviceurls)
    ? credentials.serviceurls
    : {};
  return Boolean(
    typeof credentials.clientid === "string" &&
      typeof credentials.clientsecret === "string" &&
      (typeof credentials.url === "string" || typeof credentials.tokenurl === "string") &&
      typeof serviceUrls.AI_API_URL === "string",
  );
}

function secretStringFromValue(value) {
  if (typeof value === "string" && value.trim()) return normalizeSecret(value);
  if (isSapServiceKeyObject(value)) return JSON.stringify(value);
  return undefined;
}

function findSecretInObject(value, seen = new Set()) {
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  const wholeServiceKey = secretStringFromValue(value);
  if (wholeServiceKey) return wholeServiceKey;

  const directKeys = ["apiKey", "apikey", "api_key", "serviceKey", "service_key", "aicoreServiceKey", "aicore_service_key", "key", "token", "access", "accessToken", "access_token", "bearer", "value"];
  for (const key of directKeys) {
    const found = value[key];
    const secret = secretStringFromValue(found);
    if (secret) return secret;
  }

  for (const child of Object.values(value)) {
    const found = findSecretInObject(child, seen);
    if (found) return found;
  }

  return undefined;
}

function nonNegativeNumber(value) {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function openCodeCredentialFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  if (value.type === "oauth") {
    const accessToken = secretStringFromValue(value.access);
    const expiresAt = nonNegativeNumber(value.expires);
    return {
      ...(accessToken ? { accessToken } : {}),
      ...(typeof value.refresh === "string" && value.refresh.trim() ? { refreshToken: value.refresh.trim() } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      providerAuthType: "oauth",
    };
  }
  if (value.type === "key" || value.type === "api") {
    const accessToken = secretStringFromValue(value.key);
    return {
      ...(accessToken ? { accessToken } : {}),
      providerAuthType: "api-key",
    };
  }
  if (value.type === "wellknown") {
    const accessToken = secretStringFromValue(value.token);
    return {
      ...(accessToken ? { accessToken } : {}),
      providerAuthType: "api-key",
    };
  }
  return {};
}

function trimmedString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function storedCredentialEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const name = trimmedString(value.integrationID) || trimmedString(value.integration_id);
  if (!name) return undefined;
  const body = value.value;
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const label = trimmedString(value.label);
  const credentialId = trimmedString(value.id);
  return {
    name,
    body,
    ...(label ? { label } : {}),
    ...(credentialId ? { credentialId } : {}),
  };
}

function entriesFromOpenCodeAuthPayload(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return Object.entries(payload)
      .filter(([key]) => key !== "$schema")
      .map(([name, body]) => ({ name, body }));
  }
  if (Array.isArray(payload)) {
    return payload.map((entry, index) => storedCredentialEntry(entry) || { name: String(index), body: entry });
  }
  return [];
}

function isSqliteDatabase(bytes) {
  return Buffer.from(bytes.subarray(0, 16)).toString("latin1") === "SQLite format 3\u0000";
}

function parseCredentialRowValue(value) {
  if (typeof value === "string" && value.trim()) return JSON.parse(value);
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return undefined;
}

async function readOpenCodeCredentialDatabase(filePath) {
  let sqliteModule;
  try {
    sqliteModule = await import("node:sqlite");
  } catch {
    throw new Error(
      "OpenCode opencode.db import requires a Node.js runtime with node:sqlite support. Export credentials to JSON or run with Node 22.5+/24+.",
    );
  }

  const db = new sqliteModule.DatabaseSync(filePath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        "SELECT id, integration_id, label, value FROM credential WHERE integration_id IS NOT NULL ORDER BY time_created",
      )
      .all();
    return rows.flatMap((row) => {
      const integrationID = trimmedString(row.integration_id);
      const value = parseCredentialRowValue(row.value);
      if (!integrationID || !value) return [];
      const label = trimmedString(row.label) || "default";
      const id = trimmedString(row.id);
      return [
        {
          ...(id ? { id } : {}),
          integrationID,
          label,
          value,
        },
      ];
    });
  } finally {
    db.close();
  }
}

async function readOpenCodeAuthPayloadFromPath(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (isSqliteDatabase(bytes)) {
    return readOpenCodeCredentialDatabase(filePath);
  }
  return JSON.parse(bytes.toString("utf8"));
}

function findSecretInHeaders(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === "authorization" ||
      normalizedKey === "x-api-key" ||
      normalizedKey === "api-key"
    ) {
      return normalizeSecret(raw);
    }
  }
  return undefined;
}

function findSecretInProviderConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const options = value.options && typeof value.options === "object" ? value.options : {};
  return findSecretInObject(options) || findSecretInHeaders(options.headers) || findSecretInHeaders(value.headers);
}

function isSecretEnvName(name) {
  return /(API_)?KEY|TOKEN|PAT|SECRET|BEARER/i.test(name);
}

function envSecretFromTokenEnv(tokenEnv, env) {
  for (const name of tokenEnv || []) {
    if (!isSecretEnvName(name)) continue;
    const value = env[name];
    if (value?.trim()) return normalizeSecret(value);
  }
  return undefined;
}

function envSecretForProvider(providerId, preset, env = process.env) {
  const providerAdapter = preset.providerAdapter || preset.provider;
  if (providerId === "amazon-bedrock" || providerAdapter === "amazon-bedrock") {
    return env.AWS_BEARER_TOKEN_BEDROCK?.trim()
      ? normalizeSecret(env.AWS_BEARER_TOKEN_BEDROCK)
      : undefined;
  }
  if (
    providerId === "google-vertex" ||
    providerId === "google-vertex-anthropic" ||
    providerAdapter === "vertex" ||
    providerAdapter === "vertex-anthropic"
  ) {
    if (env.GOOGLE_VERTEX_ACCESS_TOKEN?.trim()) {
      return normalizeSecret(env.GOOGLE_VERTEX_ACCESS_TOKEN);
    }
    if (env.GOOGLE_ACCESS_TOKEN?.trim()) {
      return normalizeSecret(env.GOOGLE_ACCESS_TOKEN);
    }
    return undefined;
  }
  return envSecretFromTokenEnv(preset.tokenEnv, env);
}

function credentialChainTokenForProvider(providerId, preset) {
  const providerAdapter = preset.providerAdapter || preset.provider;
  if (providerId === "amazon-bedrock" || providerAdapter === "amazon-bedrock") {
    return resolveAwsBedrockCredentials(preset.providerOptions)
      ? AWS_BEDROCK_SIGV4_PLACEHOLDER
      : undefined;
  }
  if (
    providerId === "google-vertex" ||
    providerId === "google-vertex-anthropic" ||
    providerAdapter === "vertex" ||
    providerAdapter === "vertex-anthropic"
  ) {
    return resolveGoogleAuthCredentials(preset.providerOptions)
      ? GOOGLE_VERTEX_ADC_PLACEHOLDER
      : undefined;
  }
  return undefined;
}

function publicFallbackTokenForProvider(providerId, preset) {
  const id = sanitizeProviderId(preset.providerId || providerId);
  return id === "opencode" || id === "opencode-go" ? "public" : undefined;
}

function baseUrlForPreset(preset, detectedBaseUrl) {
  const providerAdapter = preset.providerAdapter || preset.provider;
  if (providerAdapter === "openai-compatible") {
    return normalizeOpenAiCompatibleBaseUrl(detectedBaseUrl || preset.baseUrl);
  }
  if (providerAdapter === "amazon-bedrock") {
    return normalizeBaseUrl(
      detectedBaseUrl ||
        preset.baseUrl ||
        amazonBedrockBaseUrlFromOptions(preset.providerOptions),
    );
  }
  if (providerAdapter === "vertex" || providerAdapter === "vertex-anthropic") {
    return normalizeBaseUrl(
      detectedBaseUrl ||
        preset.baseUrl ||
        vertexBaseUrlFromOptions(preset.providerOptions),
    );
  }
  return normalizeBaseUrl(detectedBaseUrl || preset.baseUrl);
}

function providerOverrideObject(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  const provider = metadata.provider;
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    return undefined;
  }
  return provider;
}

function firstProviderOverrideString(source, keys) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function canSharePresetBaseForModelOverride(preset, adapter) {
  const presetAdapter = preset.providerAdapter || preset.provider;
  return presetAdapter === "vertex" && adapter === "vertex-anthropic";
}

function modelOverrideBaseUrlForPreset(adapter, api, preset) {
  if (adapter === "openai-compatible") {
    return normalizeOpenAiCompatibleBaseUrl(api || preset.baseUrl);
  }
  return normalizeBaseUrl(api || preset.baseUrl);
}

function modelProviderOverrideForPreset(preset, modelId, metadata) {
  const provider = providerOverrideObject(metadata);
  if (!provider) return undefined;

  const npm = firstProviderOverrideString(provider, ["npm", "package"]);
  const adapter = providerAdapterFromNpm(modelId, npm);
  if (!isRuntimeSupportedAdapter(adapter)) return undefined;

  const api = firstProviderOverrideString(provider, [
    "api",
    "baseURL",
    "baseUrl",
    "base_url",
    "url",
    "endpoint",
  ]);
  if (!api && !canSharePresetBaseForModelOverride(preset, adapter)) {
    return undefined;
  }
  const baseUrl = modelOverrideBaseUrlForPreset(adapter, api, preset);
  if (adapter === "openai-compatible" && !baseUrl) return undefined;
  const shape = firstProviderOverrideString(provider, ["shape"]);
  const upstreamMode =
    adapter === "openai-compatible" && shape === "responses"
      ? "responses"
      : adapter === "openai-compatible"
        ? "chat/completions"
        : undefined;
  const compatibilityMode =
    upstreamMode === "responses"
      ? "responses"
      : upstreamMode === "chat/completions"
        ? "chat-completions-bridge"
        : undefined;

  return {
    adapter,
    providerNpm: npm,
    baseUrl,
    upstreamMode,
    compatibilityMode,
    models: { [modelId]: metadata },
  };
}

function baseProviderModelsForPreset(preset) {
  if (!preset.models || typeof preset.models !== "object") return undefined;
  const disabledModels = new Set((preset.disabledModels || []).map((model) => String(model).trim().toLowerCase()));
  const out = {};
  for (const [modelId, metadata] of Object.entries(preset.models)) {
    if (disabledModels.has(String(modelId).trim().toLowerCase())) continue;
    if (modelProviderOverrideForPreset(preset, modelId, metadata)) continue;
    out[modelId] = metadata;
  }
  return Object.keys(out).length ? out : undefined;
}

function parseDigitalOceanRouters(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const metadata = body.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const raw = metadata.routers;
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((router) => {
      if (!router || typeof router !== "object" || Array.isArray(router)) return [];
      const name = typeof router.name === "string" ? router.name.trim() : "";
      if (!name) return [];
      return [{ ...router, name }];
    });
  } catch {
    return [];
  }
}

function digitalOceanRouterModel(router) {
  const name = String(router.name);
  const id = `router:${name}`;
  return {
    id,
    name,
    description: typeof router.description === "string" ? router.description : undefined,
    family: "digitalocean-inference-routers",
    api: {
      id,
      url: "https://inference.do-ai.run/v1",
      npm: "@ai-sdk/openai-compatible",
    },
    status: "active",
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128_000, output: 8_192 },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    variants: {},
    routerUuid: typeof router.uuid === "string" ? router.uuid : undefined,
  };
}

function providerModelsForAuthEntry(providerKey, preset, body, token) {
  const models = { ...(baseProviderModelsForPreset(preset) || {}) };
  if (sanitizeProviderId(providerKey) === "digitalocean") {
    for (const router of parseDigitalOceanRouters(body)) {
      const id = `router:${router.name}`;
      if (!models[id]) models[id] = digitalOceanRouterModel(router);
    }
  }

  if (token === "public" && isOpenCodePublicFallbackProvider(providerKey, preset)) {
    for (const [modelId, metadata] of Object.entries(models)) {
      if (isPaidOpenCodeModel(metadata)) delete models[modelId];
    }
  }
  return Object.keys(models).length ? models : undefined;
}

function isOpenCodePublicFallbackProvider(providerId, preset) {
  const id = sanitizeProviderId(preset.providerId || providerId);
  return id === "opencode" || id === "opencode-go";
}

function isPaidOpenCodeModel(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const cost = metadata.cost;
  if (!Array.isArray(cost)) return false;
  return cost.some(
    (entry) =>
      Boolean(entry) &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof entry.input === "number" &&
      entry.input > 0,
  );
}

function modelProviderOverrideAccountsForPreset(baseAccount, preset, token) {
  if (!preset.models || typeof preset.models !== "object") return [];

  const groups = new Map();
  for (const [modelId, metadata] of Object.entries(preset.models)) {
    const override = modelProviderOverrideForPreset(preset, modelId, metadata);
    if (!override) continue;
    const key = JSON.stringify({
      adapter: override.adapter,
      providerNpm: override.providerNpm,
      baseUrl: override.baseUrl,
      upstreamMode: override.upstreamMode,
      compatibilityMode: override.compatibilityMode,
      openAiPathPrefix: override.openAiPathPrefix,
    });
    const existing = groups.get(key);
    if (existing) {
      existing.models[modelId] = metadata;
    } else {
      groups.set(key, override);
    }
  }

  return Array.from(groups.values()).map((override) => {
    const suffix =
      sanitizeProviderId(`${override.adapter}-${override.baseUrl || "default"}`) ||
      override.adapter;
    const enabled =
      isRuntimeSupportedAdapter(override.adapter) &&
      (override.adapter !== "openai-compatible" || Boolean(override.baseUrl));
    return {
      ...baseAccount,
      id: `${baseAccount.id}-${suffix}`,
      provider: override.adapter,
      providerAdapter: override.adapter,
      providerLabel: `${baseAccount.providerLabel || preset.label} (${override.adapter})`,
      providerNpm: override.providerNpm || baseAccount.providerNpm,
      providerModels: override.models,
      upstreamMode: override.upstreamMode,
      compatibilityMode: override.compatibilityMode,
      openAiPathPrefix: override.openAiPathPrefix,
      email: `${baseAccount.email || baseAccount.id}-${suffix}`,
      accessToken: token,
      baseUrl: override.baseUrl,
      enabled,
      state: enabled ? undefined : { lastError: `${override.adapter} adapter not implemented yet` },
    };
  });
}

function upsertOpenCodeAccountWithModelOverrides(account, preset, token) {
  const accounts = [
    ...modelProviderOverrideAccountsForPreset(account, preset, token),
    account,
  ];
  for (const next of accounts) {
    upsertAccount(next, false);
    console.log(`imported: ${next.id}${next.enabled ? "" : " (auth-only)"}`);
  }
  return accounts.length;
}

function findBaseUrlInObject(value, seen = new Set()) {
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  const sapBaseUrl = sapAiCoreBaseUrlFromServiceKey(value);
  if (sapBaseUrl) return sapBaseUrl;

  for (const key of ["baseURL", "baseUrl", "base_url", "url", "endpoint"]) {
    const found = value[key];
    if (typeof found === "string" && /^https?:\/\//.test(found.trim())) return found.trim();
  }

  for (const child of Object.values(value)) {
    const found = findBaseUrlInObject(child, seen);
    if (found) return found;
  }

  return undefined;
}

function credentialMetadataOptions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out = {};
  const metadata = value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
    ? value.metadata
    : {};
  Object.assign(out, metadata);
  for (const key of [
    "accountId",
    "accountID",
    "account_id",
    "account",
    "gatewayId",
    "gatewayID",
    "gateway_id",
    "gateway",
    "resourceName",
    "resource_name",
    "resource",
    "resourceId",
    "resource_id",
  ]) {
    if (typeof value[key] === "string" && value[key].trim()) out[key] = value[key];
  }
  return Object.keys(out).length ? out : undefined;
}

function detectedBaseUrlForAuthEntry(providerId, body) {
  const id = sanitizeProviderId(providerId);
  const metadataOptions = credentialMetadataOptions(body);
  return (
    findBaseUrlInObject(body) ||
    (id === "cloudflare-ai-gateway"
      ? cloudflareAiGatewayBaseUrlFromOptions(metadataOptions)
      : id === "cloudflare-workers-ai"
        ? cloudflareWorkersAiBaseUrlFromOptions(metadataOptions)
        : undefined) ||
    azureOpenAiBaseUrlFromOptions(providerId, metadataOptions)
  );
}

function gatewayIdFromOptions(options) {
  if (!options) return undefined;
  for (const key of ["gatewayId", "gatewayID", "gateway_id", "gateway"]) {
    const value = options[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function providerOptionsForAuthEntry(providerId, preset, body) {
  const base = preset.providerOptions || {};
  const id = sanitizeProviderId(providerId);
  const gatewayId =
    id === "cloudflare-ai-gateway" || id === "cloudflare-workers-ai"
      ? gatewayIdFromOptions(credentialMetadataOptions(body))
      : undefined;
  const merged = {
    ...base,
    ...(gatewayId ? { gatewayId } : {}),
  };
  return Object.keys(merged).length ? merged : undefined;
}

function stripJsonComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function substituteEnvVariables(source) {
  return source.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) =>
    JSON.stringify(process.env[String(name)] || "").slice(1, -1),
  );
}

function providerConfigFromOpenCodeConfigPayload(payload) {
  const providers = payload?.provider;
  const out = new Map();
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return out;
  }

  for (const [providerId, raw] of Object.entries(providers)) {
    if (!raw || typeof raw !== "object") continue;
    const options = raw.options && typeof raw.options === "object" ? raw.options : {};
    const metadata = {
      id: providerId,
      name: typeof raw.name === "string" ? raw.name : providerId,
      npm: typeof raw.npm === "string" ? raw.npm : undefined,
      api:
        typeof options.baseURL === "string"
          ? options.baseURL
          : typeof options.baseUrl === "string"
            ? options.baseUrl
            : typeof options.base_url === "string"
              ? options.base_url
              : sanitizeProviderId(providerId) === "cloudflare-ai-gateway"
                ? cloudflareAiGatewayBaseUrlFromOptions(options)
                : sanitizeProviderId(providerId) === "cloudflare-workers-ai"
                  ? cloudflareWorkersAiBaseUrlFromOptions(options)
                  : sanitizeProviderId(providerId) === "sap-ai-core"
                    ? sapAiCoreBaseUrlFromOptions(options)
                : undefined,
      env: Array.isArray(raw.env)
        ? raw.env.filter((value) => typeof value === "string")
        : typeof raw.env === "string"
          ? [raw.env]
          : [],
      doc: typeof raw.doc === "string" ? raw.doc : undefined,
      options,
      models: raw.models && typeof raw.models === "object" ? raw.models : undefined,
    };
    out.set(sanitizeProviderId(providerId), {
      ...modelsDevProviderToPreset(providerId, metadata),
      providerSource: "manual",
    });
  }
  return out;
}

function providerSecretsFromOpenCodeConfigPayload(payload) {
  const providers = payload?.provider;
  const out = new Map();
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return out;
  }

  for (const [providerId, raw] of Object.entries(providers)) {
    const secret = findSecretInProviderConfig(raw);
    if (secret) out.set(sanitizeProviderId(providerId), secret);
  }
  return out;
}

function readOpenCodeProviderConfig(opts = {}) {
  const explicit = optionValue(opts, "config", "config-path", "configPath");
  const candidates = explicit
    ? [explicit]
    : [
        path.join(process.cwd(), "opencode.jsonc"),
        path.join(process.cwd(), "opencode.json"),
        path.join(HOME, ".config", "opencode", "opencode.jsonc"),
        path.join(HOME, ".config", "opencode", "opencode.json"),
      ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const payload = JSON.parse(stripJsonComments(substituteEnvVariables(fs.readFileSync(candidate, "utf8"))));
      return {
        path: candidate,
        providers: providerConfigFromOpenCodeConfigPayload(payload),
        secrets: providerSecretsFromOpenCodeConfigPayload(payload),
      };
    } catch (err) {
      throw new Error(`Failed to parse OpenCode config ${candidate}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { path: undefined, providers: new Map(), secrets: new Map() };
}

function inferAuthPresetFromName(name, body) {
  const key = String(name || "").toLowerCase();
  if (key.includes("openrouter")) return "openrouter";
  if (key.includes("mistral")) return "mistral";
  if (key.includes("zai") || key.includes("z.ai") || key.includes("glm")) return "zai";
  if (key.includes("neuralwatt")) return "neuralwatt";
  if (key.includes("openai")) {
    const baseUrl = findBaseUrlInObject(body);
    if (baseUrl && !baseUrl.includes("api.openai.com")) return "openai-compatible";
    return "openai-api";
  }
  return undefined;
}

async function authImportOpenCode(filePath = OPENCODE_AUTH_PATH, opts = {}) {
  if (!fs.existsSync(filePath)) throw new Error(`OpenCode auth file not found: ${filePath}`);
  const payload = await readOpenCodeAuthPayloadFromPath(filePath);
  const providerConfig = readOpenCodeProviderConfig(opts);
  const entries = entriesFromOpenCodeAuthPayload(payload);
  let imported = 0;
  const seenProviderIds = new Set();

  for (const entry of entries) {
    const { name, body } = entry;
    const providerKey = sanitizeProviderId(name);
    seenProviderIds.add(providerKey);
    const detectedBaseUrl = detectedBaseUrlForAuthEntry(providerKey, body);
    const configPreset = providerConfig.providers.get(providerKey);
    const resolved = configPreset
      ? { name: providerKey, preset: configPreset }
      : await canonicalAuthProvider(name, {
          "base-url": detectedBaseUrl,
        });
    const { name: presetName, preset } = resolved;
    const credential = openCodeCredentialFields(body);
    const token =
      credential.accessToken ||
      findSecretInObject(body) ||
      providerConfig.secrets.get(providerKey) ||
      envSecretForProvider(providerKey, preset) ||
      credentialChainTokenForProvider(providerKey, preset) ||
      publicFallbackTokenForProvider(providerKey, preset) ||
      (preset.authType === "none" ? NO_AUTH_ACCESS_TOKEN : undefined);
    if (!token) continue;

    const providerAdapter = preset.providerAdapter || preset.provider;
    const baseUrl = baseUrlForPreset(preset, detectedBaseUrl);
    const providerId = preset.providerId || presetName;
    const runtimeSupported =
      (preset.runtimeSupported !== false ||
        (providerAdapter === "openai-compatible" && Boolean(baseUrl))) &&
      isRuntimeSupportedAdapter(providerAdapter);
    const accountSuffix = sanitizeProviderId(entry.label || entry.credentialId || name) || randomUUID().slice(0, 8);
    const id = `${sanitizeProviderId(providerId)}-${accountSuffix}`;
    imported += upsertOpenCodeAccountWithModelOverrides(
      {
        id,
        provider: preset.provider,
        providerId,
        providerAdapter,
        providerLabel: preset.label,
        providerNpm: preset.providerNpm,
        providerSource: "opencode",
        providerDoc: preset.providerDoc,
        providerAuthEnv: preset.tokenEnv,
        providerAuthType: credential.providerAuthType || preset.authType,
        providerOptions: providerOptionsForAuthEntry(providerKey, preset, body),
        providerModels: providerModelsForAuthEntry(providerKey, preset, body, token),
        upstreamMode: preset.upstreamMode,
        compatibilityMode: preset.compatibilityMode,
        openAiPathPrefix: preset.openAiPathPrefix,
        email: id,
        accessToken: token,
        refreshToken: credential.refreshToken,
        expiresAt: credential.expiresAt,
        baseUrl,
        enabled: runtimeSupported,
        priority: 0,
        state: runtimeSupported ? undefined : { lastError: `${providerAdapter} adapter not implemented yet` },
      },
      preset,
      token,
    );
  }

  for (const [providerKey, token] of providerConfig.secrets) {
    if (seenProviderIds.has(providerKey)) continue;
    const preset = providerConfig.providers.get(providerKey);
    if (!preset) continue;

    const providerAdapter = preset.providerAdapter || preset.provider;
    const baseUrl = baseUrlForPreset(preset);
    const providerId = preset.providerId || providerKey;
    const runtimeSupported = preset.runtimeSupported !== false && isRuntimeSupportedAdapter(providerAdapter);
    const id = `${sanitizeProviderId(providerId)}-${providerKey || randomUUID().slice(0, 8)}`;
    imported += upsertOpenCodeAccountWithModelOverrides(
      {
        id,
        provider: preset.provider,
        providerId,
        providerAdapter,
        providerLabel: preset.label,
        providerNpm: preset.providerNpm,
        providerSource: "opencode",
        providerDoc: preset.providerDoc,
        providerAuthEnv: preset.tokenEnv,
        providerAuthType: preset.authType,
        providerOptions: preset.providerOptions,
        providerModels: providerModelsForAuthEntry(providerKey, preset, undefined, token),
        upstreamMode: preset.upstreamMode,
        compatibilityMode: preset.compatibilityMode,
        openAiPathPrefix: preset.openAiPathPrefix,
        email: id,
        accessToken: token,
        baseUrl,
        enabled: runtimeSupported,
        priority: 0,
        state: runtimeSupported ? undefined : { lastError: `${providerAdapter} adapter not implemented yet` },
      },
      preset,
      token,
    );
  }

  for (const [providerKey, preset] of providerConfig.providers) {
    if (seenProviderIds.has(providerKey)) continue;
    if (providerConfig.secrets.has(providerKey)) continue;

    const providerAdapter = preset.providerAdapter || preset.provider;
    const providerId = preset.providerId || providerKey;
    const token =
      envSecretForProvider(providerId, preset) ||
      credentialChainTokenForProvider(providerId, preset) ||
      publicFallbackTokenForProvider(providerId, preset) ||
      (preset.authType === "none" ? NO_AUTH_ACCESS_TOKEN : undefined);
    if (!token) continue;
    const baseUrl = baseUrlForPreset(preset);
    const runtimeSupported = preset.runtimeSupported !== false && isRuntimeSupportedAdapter(providerAdapter);
    const id = `${sanitizeProviderId(providerId)}-${providerKey || randomUUID().slice(0, 8)}`;
    imported += upsertOpenCodeAccountWithModelOverrides(
      {
        id,
        provider: preset.provider,
        providerId,
        providerAdapter,
        providerLabel: preset.label,
        providerNpm: preset.providerNpm,
        providerSource: "opencode",
        providerDoc: preset.providerDoc,
        providerAuthEnv: preset.tokenEnv,
        providerAuthType: preset.authType,
        providerOptions: preset.providerOptions,
        providerModels: providerModelsForAuthEntry(providerKey, preset, undefined, token),
        upstreamMode: preset.upstreamMode,
        compatibilityMode: preset.compatibilityMode,
        openAiPathPrefix: preset.openAiPathPrefix,
        email: id,
        accessToken: token,
        baseUrl,
        enabled: runtimeSupported,
        priority: 0,
        state: runtimeSupported ? undefined : { lastError: `${providerAdapter} adapter not implemented yet` },
      },
      preset,
      token,
    );
  }

  if (!imported) {
    console.log(`no supported provider tokens found in ${filePath}`);
  }
  if (providerConfig.path) {
    console.log(`config: ${providerConfig.path}`);
  }
}

function adminHeaders() {
  const headers = { "content-type": "application/json" };
  if (process.env.ADMIN_TOKEN) headers.authorization = `Bearer ${process.env.ADMIN_TOKEN}`;
  return headers;
}

async function adminFetchJson(pathname, options = {}) {
  await startServer();
  const res = await fetch(`${BASE}${pathname}`, {
    ...options,
    headers: {
      ...adminHeaders(),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(payload?.error || `${pathname} returned ${res.status}`);
  }
  return payload;
}

async function authOauthStart(opts = {}) {
  const email = optionValue(opts, "email");
  if (!email) throw new Error("--email is required");
  const body = {
    email,
    accountId: optionValue(opts, "account-id", "accountId"),
  };
  const payload = await adminFetchJson("/admin/oauth/start", {
    method: "POST",
    body: JSON.stringify(body),
  });
  console.log(`flowId: ${payload.flowId}`);
  console.log(`redirect: ${payload.expectedRedirectUri}`);
  console.log(`authorizeUrl: ${payload.authorizeUrl}`);
  console.log("complete: opencodex auth oauth-complete --flow-id <flowId> --input '<redirect-url-or-code>'");
}

async function authOauthStatus(flowId) {
  if (!flowId) throw new Error("flow id required");
  const payload = await adminFetchJson(`/admin/oauth/status/${encodeURIComponent(flowId)}`);
  console.log(JSON.stringify(payload.flow, null, 2));
}

async function authOauthComplete(opts = {}) {
  const flowId = optionValue(opts, "flow-id", "flowId") || opts._[0];
  if (!flowId) throw new Error("--flow-id is required");
  const input = optionValue(opts, "input") || (opts.stdin ? fs.readFileSync(0, "utf8").trim() : undefined);
  if (!input) throw new Error("--input or --stdin is required");
  const payload = await adminFetchJson("/admin/oauth/complete", {
    method: "POST",
    body: JSON.stringify({ flowId, input }),
  });
  console.log(`saved: ${payload.account?.id || "openai"} provider=openai enabled=${payload.account?.enabled !== false}`);
}

function printAuthUsage() {
  console.error(`Usage:
  opencodex auth providers
  opencodex auth list [--json]
  opencodex auth login <provider> --id <id> (--token <token>|--token-env ENV|--stdin) [--base-url URL]
  opencodex auth login <provider> --id <id> --base-url URL --token-env ENV [--upstream-mode responses|chat/completions]
  opencodex auth oauth-start --email <email> [--account-id <id>]
  opencodex auth oauth-status <flowId>
  opencodex auth oauth-complete --flow-id <flowId> (--input <redirect-url-or-code>|--stdin)
  opencodex auth remove <id>
  opencodex auth enable <id>
  opencodex auth disable <id>
  opencodex auth import-opencode [auth.json] [--config opencode.jsonc]

Examples:
  opencodex auth providers
  opencodex auth list --json
  opencodex auth login openrouter --id openrouter --token-env OPENROUTER_API_KEY
  opencodex auth login deepseek --id deepseek --token-env DEEPSEEK_API_KEY
  opencodex auth login openai-compatible --id local --base-url http://127.0.0.1:11434/v1 --token none --provider openai-compatible
  opencodex auth import-opencode ~/.local/share/opencode/auth.json --config ./opencode.jsonc

Providers: ${Object.keys(authProviderPresets).join(", ")}
Any provider name is accepted with --base-url and is saved as openai-compatible.
Web UI: run opencodex sync or launch codex once, then open ${BASE} and use Accounts.`);
}

async function auth(argv) {
  const subcommand = argv[0] || "list";
  const opts = parseCliOptions(argv.slice(1));

  if (subcommand === "providers") {
    await printAuthProviders();
  } else if (subcommand === "list" || subcommand === "ls") {
    authList(opts);
  } else if (subcommand === "login" || subcommand === "add") {
    const provider = opts._[0];
    if (!provider) throw new Error("provider required. Run: opencodex auth providers");
    await authLogin(provider, opts);
  } else if (subcommand === "remove" || subcommand === "rm" || subcommand === "delete") {
    authRemove(opts._[0]);
  } else if (subcommand === "enable") {
    authSetEnabled(opts._[0], true);
  } else if (subcommand === "disable") {
    authSetEnabled(opts._[0], false);
  } else if (subcommand === "import-opencode") {
    await authImportOpenCode(opts._[0] || OPENCODE_AUTH_PATH, opts);
  } else if (subcommand === "oauth-start" || subcommand === "connect-openai") {
    await authOauthStart(opts);
  } else if (subcommand === "oauth-status") {
    await authOauthStatus(opts._[0]);
  } else if (subcommand === "oauth-complete") {
    await authOauthComplete(opts);
  } else {
    printAuthUsage();
    process.exitCode = 2;
  }
}

function launcherScript(command) {
  const root = shellDefault(ROOT);
  const real = shellDefault(resolveCodexBin());
  const dataDir = shellDefault(DATA_DIR);
  const defaultProxyModels = shellDefault(DEFAULT_PROXY_MODELS);
  const marker = `# ${SHIM_MARKER}`;
  const realResolver = `REAL_DEFAULT="${real}"
REAL="\${CODEX_REAL_BIN:-$REAL_DEFAULT}"

resolve_real() {
  local candidate="\${REAL:-}"
  local self=""
  local resolved=""
  local dir=""

  if [[ -n "\${CODEX_REAL_BIN:-}" ]]; then
    if [[ -x "$candidate" ]]; then
      REAL="$candidate"
      return 0
    fi
    echo "CODEX_REAL_BIN is not executable: $candidate" >&2
    return 127
  fi

  if [[ -n "$candidate" && "$candidate" != "codex" && -x "$candidate" ]]; then
    REAL="$candidate"
    return 0
  fi

  self="$(readlink -f "$0" 2>/dev/null || printf '%s\\n' "$0")"
  IFS=: read -r -a path_dirs <<< "\${PATH:-}"
  for dir in "\${path_dirs[@]}"; do
    [[ -n "$dir" ]] || continue
    candidate="$dir/codex"
    [[ -x "$candidate" ]] || continue
    resolved="$(readlink -f "$candidate" 2>/dev/null || printf '%s\\n' "$candidate")"
    [[ "$resolved" != "$self" ]] || continue
    if grep -q '${SHIM_MARKER}' "$candidate" 2>/dev/null; then
      continue
    fi
    REAL="$candidate"
    return 0
  done

  echo "Could not find the real Codex CLI binary. Set CODEX_REAL_BIN=/path/to/codex and retry." >&2
  return 127
}

resolve_real`;

  if (command === "opencodex" || command === "codex-multicodex") {
    return `#!/usr/bin/env bash
${marker}
set -euo pipefail
ROOT="\${MULTICODEX_ROOT:-${root}}"
exec node "$ROOT/bin/codex-multicodex.js" "$@"
`;
  }

  const common = `#!/usr/bin/env bash
${marker}
set -euo pipefail

${realResolver}
ROOT="\${MULTICODEX_ROOT:-${root}}"
PORT="\${MULTICODEX_PORT:-1455}"
BASE="\${MULTICODEX_BASE_URL:-http://127.0.0.1:\${PORT}}"
DATA_DIR="\${MULTICODEX_DATA_DIR:-${dataDir}}"

proxy_ready() {
  if curl -fsS "\${BASE}/health" >/dev/null 2>&1; then
    curl -fsS "\${BASE}/v1/models" >/dev/null 2>&1
    return $?
  fi
  return 1
}

ensure_multicodex() {
  if proxy_ready; then
    return 0
  fi

  if [[ ! -f "$ROOT/dist/server.js" ]]; then
    echo "MultiCodex proxy server not found under $ROOT" >&2
    return 1
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "MultiCodex proxy requires node on PATH" >&2
    return 1
  fi

  export PORT
  export STORE_PATH="\${MULTICODEX_STORE_PATH:-$DATA_DIR/accounts.json}"
  export OAUTH_STATE_PATH="\${MULTICODEX_OAUTH_STATE_PATH:-$DATA_DIR/oauth-state.json}"
  export TRACE_FILE_PATH="\${MULTICODEX_TRACE_FILE_PATH:-$DATA_DIR/requests-trace.jsonl}"
  export TRACE_STATS_HISTORY_PATH="\${MULTICODEX_TRACE_STATS_HISTORY_PATH:-$DATA_DIR/requests-stats-history.jsonl}"
  export PROXY_MODELS="\${MULTICODEX_PROXY_MODELS:-${defaultProxyModels}}"

  mkdir -p "$DATA_DIR"
  if command -v setsid >/dev/null 2>&1; then
    (cd "$ROOT" && setsid -f node dist/server.js >>"$DATA_DIR/server.log" 2>&1) || return 1
  else
    (cd "$ROOT" && nohup node dist/server.js >>"$DATA_DIR/server.log" 2>&1 &) || return 1
  fi

  for _ in {1..40}; do
    if proxy_ready; then
      return 0
    fi
    sleep 0.25
  done

  echo "MultiCodex proxy did not start at \${BASE}" >&2
  return 1
}
`;

  if (command === "codex-oai") {
    return `#!/usr/bin/env bash
${marker}
set -euo pipefail
${realResolver}
exec "$REAL" --profile oai "$@"
`;
  }

  if (command === "codex-oss") {
    return `#!/usr/bin/env bash
${marker}
set -euo pipefail
${realResolver}
has_model=0
expect=""

for arg in "$@"; do
  if [[ "$expect" == "model" ]]; then
    has_model=1
    expect=""
    continue
  fi
  case "$arg" in
    -m|--model)
      expect="model"
      ;;
    --model=*)
      has_model=1
      ;;
  esac
done

args=(--oss --local-provider "\${CODEX_OSS_PROVIDER:-ollama}")
if [[ "$has_model" == 0 ]]; then
  args+=(-m "\${CODEX_OSS_MODEL:-gemma4:e2b}")
fi

exec "$REAL" "\${args[@]}" "$@"
`;
  }

  if (command === "codex-multi") {
    return `${common}
ensure_multicodex
exec "$REAL" --profile multicodex "$@"
`;
  }

  return `#!/usr/bin/env bash
${marker}
set -euo pipefail
${realResolver}

has_profile=0
expect=""

for arg in "$@"; do
  if [[ "$expect" == "profile" ]]; then
    has_profile=1
    expect=""
    continue
  fi
  case "$arg" in
    -p|--profile)
      expect="profile"
      ;;
    --profile=*)
      has_profile=1
      ;;
  esac
done

case "\${1:-}" in
  --help|-h|--version|-V|app-server|debug|mcp|mcp-server|login|logout|auth|completion|apply|sandbox|proto|features|cloud|remote-control|exec-server|plugin|doctor|update|archive|delete|unarchive|fork)
    exec "$REAL" "$@"
    ;;
esac

if [[ "$has_profile" == 1 ]]; then
  exec "$REAL" "$@"
fi

exec "$REAL" --profile oai "$@"
`;
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeManifest(extra = {}) {
  fs.mkdirSync(MANAGED_DIR, { recursive: true });
  const manifest = {
    version: 1,
    root: ROOT,
    baseUrl: BASE,
    codexHome: CODEX_HOME,
    codexRealBin: resolveCodexBin(),
    dataDir: DATA_DIR,
    binDir: BIN_DIR,
    wrappers: WRAPPER_PATHS,
    catalogs: [CATALOG_PATH, OAI_CATALOG_PATH],
    profiles: [PROFILE_PATH, OAI_PROFILE_PATH],
    updatedAt: new Date().toISOString(),
    ...extra,
  };
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

function isOwnedWrapper(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf8");
  return (
    content.includes(SHIM_MARKER) ||
    (content.includes("MULTICODEX_ROOT") && content.includes("pick_multicodex_model")) ||
    (content.includes("MULTICODEX_ROOT") && content.includes("--profile multicodex")) ||
    (content.includes("CODEX_REAL_BIN") && content.includes("--profile oai")) ||
    (content.includes("CODEX_OSS_PROVIDER") && content.includes("--local-provider"))
  );
}

function wrapperInfo(filePath) {
  if (!fs.existsSync(filePath)) return { status: "missing" };
  const content = fs.readFileSync(filePath, "utf8");
  const managed = isOwnedWrapper(filePath);
  const rootMatch = content.match(/^ROOT="\$\{MULTICODEX_ROOT:-(.*)\}"$/m);
  const realMatch = content.match(/^REAL_DEFAULT="(.*)"$/m) || content.match(/^REAL="\$\{CODEX_REAL_BIN:-(.*)\}"$/m);
  const root = rootMatch?.[1];
  const real = realMatch?.[1];
  const staleRoot = Boolean(root && path.resolve(root) !== ROOT);
  return {
    status: managed ? (staleRoot ? "managed-stale" : "managed") : "foreign",
    root,
    real,
    staleRoot,
  };
}

function installWrappers() {
  for (const [name, filePath] of Object.entries(WRAPPER_PATHS)) {
    if (fs.existsSync(filePath) && !isOwnedWrapper(filePath)) {
      throw new Error(`${filePath} already exists and is not a MultiCodex-managed wrapper`);
    }
    writeExecutable(filePath, launcherScript(name));
  }
}

function writeProfile() {
  const profile = `model_provider = "multicodex"
model = "gpt-5.5"
model_reasoning_effort = "high"
model_context_window = 819200
model_auto_compact_token_limit = 240000
model_catalog_json = "${CATALOG_PATH}"
service_tier = "${CODEX_FAST_CONFIG_TIER}"

[features]
fast_mode = true

[model_providers.multicodex]
name = "MultiCodex Proxy"
base_url = "${BASE}/v1"
wire_api = "responses"
`;
  fs.writeFileSync(PROFILE_PATH, profile);

  const oaiProfile = `model_provider = "openai"
model = "gpt-5.5"
model_reasoning_effort = "high"
model_context_window = 819200
model_auto_compact_token_limit = 240000
model_catalog_json = "${OAI_CATALOG_PATH}"
service_tier = "${CODEX_FAST_CONFIG_TIER}"

[features]
fast_mode = true
`;
  fs.writeFileSync(OAI_PROFILE_PATH, oaiProfile);
}

function syncConfig() {
  let config = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, "utf8") : "";
  config = removeProviderBlock(config);
  config = removeTopLevelToml(config, "model_catalog_json", (value) =>
    value === JSON.stringify(CATALOG_PATH) || value === JSON.stringify(OAI_CATALOG_PATH),
  );
  if (/^model_provider\s*=\s*"multicodex"\s*$/m.test(config)) {
    config = replaceTopLevelToml(config, "model_provider", "openai");
  }
  fs.writeFileSync(CONFIG_PATH, `${config.trimEnd()}\n`);
}

function cleanupConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return;
  let config = fs.readFileSync(CONFIG_PATH, "utf8");
  config = removeProviderBlock(config);
  config = removeTopLevelToml(config, "model_catalog_json", (value) =>
    value === JSON.stringify(CATALOG_PATH) || value === JSON.stringify(OAI_CATALOG_PATH),
  );
  config = replaceTopLevelToml(config, "model_provider", "openai");
  if (/^model\s*=\s*"(glm|kimi|qwen|zai-org|moonshotai)/m.test(config)) {
    config = replaceTopLevelToml(config, "model", "gpt-5.5");
  }
  fs.writeFileSync(CONFIG_PATH, `${config.trimEnd()}\n`);
}

async function sync() {
  const models = await listModels();
  const oaiModels = models.filter((model) => gptMetadata[model]);
  const bundledCatalog = loadBundledCatalog();
  fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true });
  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(makeCatalog(models, bundledCatalog), null, 2)}\n`);
  fs.writeFileSync(OAI_CATALOG_PATH, `${JSON.stringify(makeCatalog(oaiModels, bundledCatalog), null, 2)}\n`);
  writeProfile();
  syncConfig();
  console.log(`Synced ${models.length} models to ${CATALOG_PATH}`);
  console.log(`Synced ${oaiModels.length} OpenAI models to ${OAI_CATALOG_PATH}`);
  console.log(`Updated ${PROFILE_PATH}`);
  console.log(`Updated ${OAI_PROFILE_PATH}`);
  console.log(`Updated ${CONFIG_PATH}`);
}

async function install() {
  await stopServer();
  await sync();
  installWrappers();
  writeManifest();
  console.log(`Installed wrappers to ${BIN_DIR}`);
  console.log("Commands: codex, opencodex, codex-multicodex, codex-multi, codex-oai, codex-oss");
}

async function uninstall() {
  await stopServer();
  const manifest = readManifest();
  const wrappers = manifest?.wrappers || WRAPPER_PATHS;
  for (const filePath of Object.values(wrappers)) {
    if (typeof filePath === "string" && fs.existsSync(filePath) && isOwnedWrapper(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Removed ${filePath}`);
    }
  }

  for (const filePath of [CATALOG_PATH, OAI_CATALOG_PATH, PROFILE_PATH, OAI_PROFILE_PATH]) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Removed ${filePath}`);
    }
  }

  cleanupConfig();
  if (fs.existsSync(MANIFEST_PATH)) fs.unlinkSync(MANIFEST_PATH);
  console.log(`Cleaned ${CONFIG_PATH}`);
}

function summarizeEffectiveModel(model) {
  if (!model) return null;
  const serviceTiers = model.service_tiers || [];
  return {
    visibility: model.visibility,
    default: model.default_reasoning_level,
    levels: (model.supported_reasoning_levels || []).map((level) => level.effort || level.id || level.name || level),
    tiers: serviceTiers.map((tier) => tier.id),
    slash_fast: serviceTiers.some((tier) => String(tier.name || "").toLowerCase() === "fast"),
  };
}

function loadEffectiveCatalog() {
  if (fs.existsSync(CATALOG_PATH)) {
    try {
      const payload = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
      return { models: payload.models || payload.data || payload };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  const result = spawnSync(CODEX_BIN, ["debug", "models"], {
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_MODEL_PICKER: "0",
    },
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.status !== 0) {
    return { error: (result.stderr || result.stdout || "").trim() || `codex debug models exited ${result.status}` };
  }

  try {
    const payload = JSON.parse(result.stdout);
    return { models: payload.models || payload.data || payload };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function doctor() {
  const models = await listModels();
  const catalog = fs.existsSync(CATALOG_PATH) ? JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8")) : { models: [] };
  console.log(`proxy: ${BASE}`);
  console.log(`data_dir: ${DATA_DIR}`);
  console.log(`store: ${STORE_PATH}`);
  console.log(`root: ${ROOT}`);
  console.log(`real_codex: ${CODEX_BIN}`);
  console.log(`proxy_models: ${models.length}`);
  console.log(`catalog: ${CATALOG_PATH}`);
  console.log(`catalog_models: ${(catalog.models || []).length}`);
  console.log(`oai_catalog: ${OAI_CATALOG_PATH}`);
  console.log(
    `oai_catalog_models: ${
      fs.existsSync(OAI_CATALOG_PATH) ? (JSON.parse(fs.readFileSync(OAI_CATALOG_PATH, "utf8")).models || []).length : 0
    }`,
  );
  console.log(`config_managed_default_clean: ${
    fs.existsSync(CONFIG_PATH) && !fs.readFileSync(CONFIG_PATH, "utf8").includes(CATALOG_PATH)
  }`);
  for (const [name, filePath] of Object.entries(WRAPPER_PATHS)) {
    const info = wrapperInfo(filePath);
    const details = [
      info.root ? `root=${info.root}` : "",
      info.staleRoot ? `expected=${ROOT}` : "",
      info.real ? `real=${info.real}` : "",
    ].filter(Boolean);
    console.log(`${name}_wrapper: ${info.status}${details.length ? ` ${details.join(" ")}` : ""}`);
  }
  const effective = loadEffectiveCatalog();
  if (effective.error) {
    console.log(`debug_models_error: ${effective.error}`);
    return;
  }
  for (const id of ["gpt-5.5", "gpt-5.4", "glm-5.2-fast", "glm-5.2", "kimi-k2.7-code"]) {
    const model = effective.models.find((entry) => (entry.slug || entry.id) === id);
    console.log(`${id}: ${JSON.stringify(summarizeEffectiveModel(model))}`);
  }
  console.log("fast_command: use /fast on, /fast off, or /fast status in a Codex TUI session; managed profiles persist service_tier=fast");
}

const command = process.argv[2] || "sync";
try {
  if (command === "sync") {
    await sync();
  } else if (command === "models") {
    await printModels(parseCliOptions(process.argv.slice(3)));
  } else if (command === "install" || command === "update") {
    await install();
  } else if (command === "uninstall" || command === "remove") {
    await uninstall();
  } else if (command === "doctor") {
    await doctor();
  } else if (command === "auth" || command === "connect") {
    await auth(process.argv.slice(3));
  } else {
    console.error("Usage: opencodex <sync|models|install|update|uninstall|doctor|auth>");
    process.exit(2);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
