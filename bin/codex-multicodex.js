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
const CODEX_BIN =
  process.env.CODEX_BIN || process.env.CODEX_REAL_BIN || (fs.existsSync(DEFAULT_CODEX_BIN) ? DEFAULT_CODEX_BIN : "codex");
const FAST_SERVICE_TIER = "priority";
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
    tokenEnv: ["OPENROUTER_API_KEY"],
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
  anthropic: {
    label: "Anthropic",
    provider: "anthropic",
    providerId: "anthropic",
    providerAdapter: "anthropic",
    providerNpm: "@ai-sdk/anthropic",
    providerSource: "builtin",
    providerDoc: "https://docs.anthropic.com/en/docs/about-claude/models",
    baseUrl: "https://api.anthropic.com",
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
  cerebras: { baseUrl: "https://api.cerebras.ai" },
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
  vercel: { baseUrl: "https://ai-gateway.vercel.sh" },
};

const MODELS_DEV_API_URL = process.env.MODELS_DEV_API_URL || "https://models.dev/api.json";
let modelsDevAuthProviderCache = null;

function sanitizeProviderId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function providerAdapterFromNpm(providerId, npmPackage) {
  const id = sanitizeProviderId(providerId);
  const npm = String(npmPackage || "").trim().toLowerCase();
  if (id === "openai-chatgpt") return "openai";
  if (id === "mistral") return "mistral";
  if (id === "zai") return "zai";
  if (openAiCompatibleSdkProviderDefaults[id]) return "openai-compatible";
  if (npm === "@ai-sdk/openai" || npm.includes("openai-compatible")) return "openai-compatible";
  if (npm === "@openrouter/ai-sdk-provider") return "openai-compatible";
  if (npm === "@ai-sdk/mistral") return "mistral";
  if (npm === "@ai-sdk/anthropic") return "anthropic";
  if (npm === "@ai-sdk/google") return "google";
  if (npm === "@ai-sdk/cohere") return "cohere";
  if (npm === "@ai-sdk/azure") return "azure";
  if (npm === "@ai-sdk/amazon-bedrock") return "amazon-bedrock";
  if (npm.includes("google-vertex")) return "vertex";
  return "unsupported";
}

function isRuntimeSupportedAdapter(adapter) {
  return adapter === "openai" || adapter === "openai-compatible" || adapter === "mistral" || adapter === "zai" || adapter === "anthropic" || adapter === "google" || adapter === "cohere";
}

function providerForAdapter(providerId, adapter) {
  return isRuntimeSupportedAdapter(adapter) ? adapter : sanitizeProviderId(providerId);
}

function modelsDevProviderToPreset(providerId, source) {
  const id = sanitizeProviderId(source?.id || providerId);
  const adapter = providerAdapterFromNpm(id, source?.npm);
  const runtimeSupported = isRuntimeSupportedAdapter(adapter);
  const openAiCompatibleDefault = openAiCompatibleSdkProviderDefaults[id];
  const baseUrl = adapter === "openai-compatible"
    ? normalizeOpenAiCompatibleBaseUrl(source?.api || openAiCompatibleDefault?.baseUrl)
    : normalizeBaseUrl(source?.api || (adapter === "anthropic" ? "https://api.anthropic.com" : adapter === "google" ? "https://generativelanguage.googleapis.com" : adapter === "cohere" ? "https://api.cohere.com" : undefined));
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
    upstreamMode: adapter === "openai-compatible" ? (openAiCompatibleDefault?.upstreamMode || "chat/completions") : undefined,
    compatibilityMode: adapter === "openai-compatible" ? (openAiCompatibleDefault?.compatibilityMode || "chat-completions-bridge") : undefined,
    tokenEnv: Array.isArray(source?.env) ? source.env.filter((value) => typeof value === "string") : [],
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
      if (cmdline.includes("node") && cmdline.includes("dist/server.js")) {
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
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("base URL must use http or https");
    }
  } catch (err) {
    throw new Error(`Invalid base URL "${raw}": ${err instanceof Error ? err.message : String(err)}`);
  }
  return raw.replace(/\/+$/, "");
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
  const token = readToken(opts, preset);
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

function findSecretInObject(value, seen = new Set()) {
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  const directKeys = ["apiKey", "apikey", "api_key", "key", "token", "accessToken", "access_token", "bearer", "value"];
  for (const key of directKeys) {
    const found = value[key];
    if (typeof found === "string" && found.trim()) return found.trim();
  }

  for (const child of Object.values(value)) {
    const found = findSecretInObject(child, seen);
    if (found) return found;
  }

  return undefined;
}

function findBaseUrlInObject(value, seen = new Set()) {
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

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

function stripJsonComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
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
              : undefined,
      env: Array.isArray(raw.env)
        ? raw.env.filter((value) => typeof value === "string")
        : typeof raw.env === "string"
          ? [raw.env]
          : [],
      doc: typeof raw.doc === "string" ? raw.doc : undefined,
      models: raw.models && typeof raw.models === "object" ? raw.models : undefined,
    };
    out.set(sanitizeProviderId(providerId), {
      ...modelsDevProviderToPreset(providerId, metadata),
      providerSource: "manual",
    });
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
      const payload = JSON.parse(stripJsonComments(fs.readFileSync(candidate, "utf8")));
      return {
        path: candidate,
        providers: providerConfigFromOpenCodeConfigPayload(payload),
      };
    } catch (err) {
      throw new Error(`Failed to parse OpenCode config ${candidate}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { path: undefined, providers: new Map() };
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
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const providerConfig = readOpenCodeProviderConfig(opts);
  const entries =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? Object.entries(payload)
      : Array.isArray(payload)
        ? payload.map((entry, index) => [String(index), entry])
        : [];
  let imported = 0;

  for (const [name, body] of entries) {
    const detectedBaseUrl = findBaseUrlInObject(body);
    const token = findSecretInObject(body);
    if (!token) continue;
    const configPreset = providerConfig.providers.get(sanitizeProviderId(name));
    const resolved = configPreset
      ? { name: sanitizeProviderId(name), preset: configPreset }
      : await canonicalAuthProvider(name, {
          "base-url": detectedBaseUrl,
        });
    const { name: presetName, preset } = resolved;

    const providerAdapter = preset.providerAdapter || preset.provider;
    const baseUrl = providerAdapter === "openai-compatible"
      ? normalizeOpenAiCompatibleBaseUrl(detectedBaseUrl || preset.baseUrl)
      : normalizeBaseUrl(detectedBaseUrl || preset.baseUrl);
    const providerId = preset.providerId || presetName;
    const runtimeSupported = preset.runtimeSupported !== false && isRuntimeSupportedAdapter(providerAdapter);
    const id = `${sanitizeProviderId(providerId)}-${sanitizeProviderId(name) || randomUUID().slice(0, 8)}`;
    upsertAccount(
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
        providerModels: preset.models,
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
      false,
    );
    imported += 1;
    console.log(`imported: ${id}${runtimeSupported ? "" : " (auth-only)"}`);
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
  opencodex auth oauth-start --email <email> [--account-id <id>]
  opencodex auth oauth-status <flowId>
  opencodex auth oauth-complete --flow-id <flowId> (--input <redirect-url-or-code>|--stdin)
  opencodex auth remove <id>
  opencodex auth enable <id>
  opencodex auth disable <id>
  opencodex auth import-opencode [auth.json] [--config opencode.jsonc]

Providers: ${Object.keys(authProviderPresets).join(", ")}
Any provider name is accepted with --base-url and is saved as openai-compatible.`);
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
  const real = shellDefault(DEFAULT_CODEX_BIN);
  const dataDir = shellDefault(DATA_DIR);
  const defaultProxyModels = shellDefault(DEFAULT_PROXY_MODELS);
  const marker = `# ${SHIM_MARKER}`;

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

REAL="\${CODEX_REAL_BIN:-${real}}"
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

  export PORT
  export STORE_PATH="\${MULTICODEX_STORE_PATH:-$DATA_DIR/accounts.json}"
  export OAUTH_STATE_PATH="\${MULTICODEX_OAUTH_STATE_PATH:-$DATA_DIR/oauth-state.json}"
  export TRACE_FILE_PATH="\${MULTICODEX_TRACE_FILE_PATH:-$DATA_DIR/requests-trace.jsonl}"
  export TRACE_STATS_HISTORY_PATH="\${MULTICODEX_TRACE_STATS_HISTORY_PATH:-$DATA_DIR/requests-stats-history.jsonl}"
  export PROXY_MODELS="\${MULTICODEX_PROXY_MODELS:-${defaultProxyModels}}"

  mkdir -p "$DATA_DIR"
  if command -v setsid >/dev/null 2>&1; then
    (cd "$ROOT" && setsid -f node dist/server.js >>"$DATA_DIR/server.log" 2>&1)
  else
    (cd "$ROOT" && nohup node dist/server.js >>"$DATA_DIR/server.log" 2>&1 &)
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
REAL="\${CODEX_REAL_BIN:-${real}}"
exec "$REAL" --profile oai "$@"
`;
  }

  if (command === "codex-oss") {
    return `#!/usr/bin/env bash
${marker}
set -euo pipefail
REAL="\${CODEX_REAL_BIN:-${real}}"
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

  return `${common}
inject=1
expect=""

pick_multicodex_model() {
  local default="\${CODEX_DEFAULT_MULTICODEX_MODEL:-gpt-5.5}"
  local selected=""
  local choice=""
  local i=0
  local n=0
  local model=""
  local -a models=()

  mapfile -t models < <(
    curl -fsS "\${BASE}/v1/models" | node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
for (const model of data.data || []) {
  if (model && model.id) console.log(model.id);
}
' 2>/dev/null
  )

  if [[ "\${#models[@]}" -eq 0 ]]; then
    printf '%s\\n' "$default"
    return 0
  fi

  selected="\${models[0]}"
  for model in "\${models[@]}"; do
    if [[ "$model" == "$default" ]]; then
      selected="$default"
      break
    fi
  done

  {
    printf '\\nSelect Codex model (MultiCodex)\\n'
    for i in "\${!models[@]}"; do
      if [[ "\${models[$i]}" == "$selected" ]]; then
        printf '%2d. %s (default)\\n' "$((i + 1))" "\${models[$i]}"
      else
        printf '%2d. %s\\n' "$((i + 1))" "\${models[$i]}"
      fi
    done
    printf '> '
  } > /dev/tty

  while IFS= read -r choice < /dev/tty; do
    if [[ -z "$choice" ]]; then
      printf '%s\\n' "$selected"
      return 0
    fi

    if [[ "$choice" =~ ^[0-9]+$ ]]; then
      n=$((10#$choice))
      if (( n >= 1 && n <= \${#models[@]} )); then
        printf '%s\\n' "\${models[$((n - 1))]}"
        return 0
      fi
    fi

    for model in "\${models[@]}"; do
      if [[ "$choice" == "$model" ]]; then
        printf '%s\\n' "$choice"
        return 0
      fi
    done

    printf 'Invalid selection. Enter 1-%d or model id: ' "\${#models[@]}" > /dev/tty
  done

  printf '%s\\n' "$selected"
}

for arg in "$@"; do
  if [[ -n "$expect" ]]; then
    if [[ "$expect" == "config" ]]; then
      case "$arg" in
        model_provider=*|*.model_provider=*)
          inject=0
          ;;
      esac
    fi
    expect=""
    continue
  fi

  case "$arg" in
    -m|--model)
      expect="value"
      ;;
    -p|--profile|--local-provider)
      inject=0
      expect="value"
      ;;
    -c|--config)
      expect="config"
      ;;
    --profile=*|--local-provider=*|--oss|--help|-h|--version|-V)
      inject=0
      ;;
    model_provider=*)
      inject=0
      ;;
    app-server|debug|mcp|mcp-server|login|logout|auth|completion|apply|sandbox|proto|features|cloud|remote-control|exec-server|plugin|doctor|update|archive|delete|unarchive|fork)
      inject=0
      break
      ;;
  esac
done

if [[ "$inject" == 1 ]]; then
  ensure_multicodex

  if [[ "$#" -eq 0 && -t 0 && -t 1 && "\${CODEX_MODEL_PICKER:-0}" == "1" ]]; then
    exec "$REAL" --profile multicodex -m "$(pick_multicodex_model)"
  fi

  exec "$REAL" --profile multicodex "$@"
fi

exec "$REAL" "$@"
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
service_tier = "${FAST_SERVICE_TIER}"

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
service_tier = "${FAST_SERVICE_TIER}"

[features]
fast_mode = true
`;
  fs.writeFileSync(OAI_PROFILE_PATH, oaiProfile);
}

function syncConfig() {
  let config = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, "utf8") : "";
  config = replaceTopLevelToml(config, "model_provider", "multicodex");
  config = replaceTopLevelToml(config, "model", "gpt-5.5");
  config = replaceTopLevelToml(config, "model_reasoning_effort", "high");
  config = replaceTopLevelToml(config, "model_catalog_json", CATALOG_PATH);
  config = replaceTopLevelToml(config, "service_tier", FAST_SERVICE_TIER);
  config = replaceTopLevelToml(config, "oss_provider", "ollama");
  config = upsertTableValue(config, "features", "fast_mode", true);
  config = upsertTableValue(config, "notice", "fast_default_opt_out", false);
  config = upsertProviderBlock(config);
  fs.writeFileSync(CONFIG_PATH, config);
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
  console.log(`proxy_models: ${models.length}`);
  console.log(`catalog: ${CATALOG_PATH}`);
  console.log(`catalog_models: ${(catalog.models || []).length}`);
  console.log(`oai_catalog: ${OAI_CATALOG_PATH}`);
  console.log(
    `oai_catalog_models: ${
      fs.existsSync(OAI_CATALOG_PATH) ? (JSON.parse(fs.readFileSync(OAI_CATALOG_PATH, "utf8")).models || []).length : 0
    }`,
  );
  console.log(`config_has_catalog: ${fs.existsSync(CONFIG_PATH) && fs.readFileSync(CONFIG_PATH, "utf8").includes(CATALOG_PATH)}`);
  for (const [name, filePath] of Object.entries(WRAPPER_PATHS)) {
    console.log(`${name}_wrapper: ${fs.existsSync(filePath) ? (isOwnedWrapper(filePath) ? "managed" : "foreign") : "missing"}`);
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
  console.log("fast_command: use /fast to toggle the Fast service tier; Codex 0.141.0 does not handle /fast status/on/off as separate inline arguments");
}

const command = process.argv[2] || "sync";
try {
  if (command === "sync") {
    await sync();
  } else if (command === "install" || command === "update") {
    await install();
  } else if (command === "uninstall" || command === "remove") {
    await uninstall();
  } else if (command === "doctor") {
    await doctor();
  } else if (command === "auth" || command === "connect") {
    await auth(process.argv.slice(3));
  } else {
    console.error("Usage: opencodex <sync|install|update|uninstall|doctor|auth>");
    process.exit(2);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
