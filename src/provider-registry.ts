import type {
  CompatibilityMode,
  ProviderAdapter,
  RouteProviderId,
  UpstreamMode,
} from "./types.js";

const MODELS_DEV_API_URL =
  process.env.MODELS_DEV_API_URL ?? "https://models.dev/api.json";
const MODELS_DEV_TIMEOUT_MS = Number(
  process.env.MODELS_DEV_TIMEOUT_MS ?? 2500,
);

export type ProviderRegistryEntry = {
  id: string;
  providerId: string;
  label: string;
  provider: string;
  providerAdapter: ProviderAdapter;
  providerNpm?: string;
  providerSource: "builtin" | "models.dev" | "manual";
  providerDoc?: string;
  baseUrl?: string;
  upstreamMode?: UpstreamMode;
  compatibilityMode?: CompatibilityMode;
  tokenEnv: string[];
  authType: "oauth" | "api-key";
  runtimeSupported: boolean;
  modelsCount?: number;
};

type ModelsDevProvider = {
  id?: string;
  name?: string;
  npm?: string;
  api?: string;
  env?: string[];
  doc?: string;
  models?: Record<string, unknown>;
};

const BUILTIN_PROVIDERS: ProviderRegistryEntry[] = [
  {
    id: "openai-chatgpt",
    providerId: "openai-chatgpt",
    label: "OpenAI ChatGPT",
    provider: "openai",
    providerAdapter: "openai",
    providerSource: "builtin",
    tokenEnv: ["CHATGPT_ACCESS_TOKEN", "OPENAI_ACCESS_TOKEN"],
    authType: "oauth",
    runtimeSupported: true,
  },
  {
    id: "openai-api",
    providerId: "openai",
    label: "OpenAI API",
    provider: "openai-compatible",
    providerAdapter: "openai-compatible",
    providerNpm: "@ai-sdk/openai",
    providerSource: "builtin",
    providerDoc: "https://platform.openai.com/docs/models",
    baseUrl: "https://api.openai.com",
    upstreamMode: "responses",
    compatibilityMode: "responses",
    tokenEnv: ["OPENAI_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "openrouter",
    providerId: "openrouter",
    label: "OpenRouter",
    provider: "openai-compatible",
    providerAdapter: "openai-compatible",
    providerNpm: "@openrouter/ai-sdk-provider",
    providerSource: "builtin",
    providerDoc: "https://openrouter.ai/models",
    baseUrl: "https://openrouter.ai/api",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: ["OPENROUTER_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "mistral",
    providerId: "mistral",
    label: "Mistral",
    provider: "mistral",
    providerAdapter: "mistral",
    providerNpm: "@ai-sdk/mistral",
    providerSource: "builtin",
    providerDoc: "https://docs.mistral.ai/getting-started/models/",
    tokenEnv: ["MISTRAL_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "zai",
    providerId: "zai",
    label: "Z.AI",
    provider: "zai",
    providerAdapter: "zai",
    providerNpm: "@ai-sdk/openai-compatible",
    providerSource: "builtin",
    providerDoc: "https://docs.z.ai/guides/overview/pricing",
    baseUrl: "https://api.z.ai",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: ["ZAI_API_KEY", "ZAI_TOKEN", "ZHIPU_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "neuralwatt",
    providerId: "neuralwatt",
    label: "Neuralwatt",
    provider: "openai-compatible",
    providerAdapter: "openai-compatible",
    providerNpm: "@ai-sdk/openai-compatible",
    providerSource: "builtin",
    baseUrl: "https://api.neuralwatt.com",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: ["NEURALWATT_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "requesty",
    providerId: "requesty",
    label: "Requesty",
    provider: "openai-compatible",
    providerAdapter: "openai-compatible",
    providerNpm: "@ai-sdk/openai-compatible",
    providerSource: "builtin",
    providerDoc: "https://requesty.ai/solution/llm-routing/models",
    baseUrl: "https://router.requesty.ai",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: ["REQUESTY_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "anthropic",
    providerId: "anthropic",
    label: "Anthropic",
    provider: "anthropic",
    providerAdapter: "anthropic",
    providerNpm: "@ai-sdk/anthropic",
    providerSource: "builtin",
    providerDoc: "https://docs.anthropic.com/en/docs/about-claude/models",
    baseUrl: "https://api.anthropic.com",
    tokenEnv: ["ANTHROPIC_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "google",
    providerId: "google",
    label: "Google",
    provider: "google",
    providerAdapter: "google",
    providerNpm: "@ai-sdk/google",
    providerSource: "builtin",
    providerDoc: "https://ai.google.dev/gemini-api/docs/models",
    baseUrl: "https://generativelanguage.googleapis.com",
    tokenEnv: ["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "openai-compatible",
    providerId: "openai-compatible",
    label: "Generic OpenAI-compatible",
    provider: "openai-compatible",
    providerAdapter: "openai-compatible",
    providerNpm: "@ai-sdk/openai-compatible",
    providerSource: "builtin",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: ["OPENAI_COMPATIBLE_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
];

const PROVIDER_ALIASES: Record<string, string> = {
  chatgpt: "openai-chatgpt",
  openai: "openai-api",
  "openai-responses": "openai-api",
  "z.ai": "zai",
  zaiorg: "zai",
  zhipu: "zai",
};

let modelsDevCache:
  | { at: number; entries: Map<string, ProviderRegistryEntry> }
  | undefined;

export function sanitizeProviderId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeBaseUrl(value: unknown): string | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const parsed = new URL(raw);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("base URL must use http or https");
  }
  return raw.replace(/\/+$/, "");
}

export function normalizeOpenAiCompatibleBaseUrl(value: unknown): string | undefined {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return undefined;
  return normalized.replace(/\/v1$/i, "");
}

export function providerAdapterFromNpm(
  providerId: string,
  npmPackage?: string,
): ProviderAdapter {
  const id = sanitizeProviderId(providerId);
  const npm = String(npmPackage ?? "").trim().toLowerCase();

  if (id === "openai-chatgpt") return "openai";
  if (id === "mistral") return "mistral";
  if (id === "zai") return "zai";
  if (npm === "@ai-sdk/openai" || npm.includes("openai-compatible")) {
    return "openai-compatible";
  }
  if (npm === "@openrouter/ai-sdk-provider") return "openai-compatible";
  if (npm === "@ai-sdk/mistral") return "mistral";
  if (npm === "@ai-sdk/anthropic") return "anthropic";
  if (npm === "@ai-sdk/google") return "google";
  if (npm === "@ai-sdk/azure") return "azure";
  if (npm === "@ai-sdk/amazon-bedrock") return "amazon-bedrock";
  if (npm.includes("google-vertex")) return "vertex";
  return "unsupported";
}

export function isRuntimeSupportedProvider(adapter: ProviderAdapter): adapter is RouteProviderId {
  return (
    adapter === "openai" ||
    adapter === "openai-compatible" ||
    adapter === "mistral" ||
    adapter === "zai" ||
    adapter === "anthropic" ||
    adapter === "google"
  );
}

function providerForAdapter(
  providerId: string,
  adapter: ProviderAdapter,
): string {
  return isRuntimeSupportedProvider(adapter) ? adapter : sanitizeProviderId(providerId);
}

export function providerRegistryEntryFromMetadata(
  providerId: string,
  source: ModelsDevProvider,
  providerSource: "models.dev" | "manual" = "models.dev",
): ProviderRegistryEntry {
  const id = sanitizeProviderId(source.id || providerId);
  const adapter = providerAdapterFromNpm(id, source.npm);
  const runtimeSupported = isRuntimeSupportedProvider(adapter);
  const baseUrl =
    adapter === "openai-compatible"
      ? normalizeOpenAiCompatibleBaseUrl(source.api)
      : normalizeBaseUrl(
          source.api ??
            (adapter === "anthropic"
              ? "https://api.anthropic.com"
              : adapter === "google"
                ? "https://generativelanguage.googleapis.com"
                : undefined),
        );

  return {
    id,
    providerId: id,
    label: source.name || id,
    provider: providerForAdapter(id, adapter),
    providerAdapter: adapter,
    providerNpm: source.npm,
    providerSource,
    providerDoc: source.doc,
    baseUrl,
    upstreamMode:
      adapter === "openai-compatible" ? "chat/completions" : undefined,
    compatibilityMode:
      adapter === "openai-compatible" ? "chat-completions-bridge" : undefined,
    tokenEnv: Array.isArray(source.env)
      ? source.env.filter((value): value is string => typeof value === "string")
      : [],
    authType: "api-key",
    runtimeSupported,
    modelsCount:
      source.models && typeof source.models === "object"
        ? Object.keys(source.models).length
        : undefined,
  };
}

function builtinMap(): Map<string, ProviderRegistryEntry> {
  return new Map(BUILTIN_PROVIDERS.map((entry) => [entry.id, entry]));
}

async function fetchModelsDevProviders(): Promise<Map<string, ProviderRegistryEntry>> {
  if (modelsDevCache && Date.now() - modelsDevCache.at < 10 * 60_000) {
    return new Map(modelsDevCache.entries);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODELS_DEV_TIMEOUT_MS);
  try {
    const res = await fetch(MODELS_DEV_API_URL, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`models.dev returned ${res.status}`);
    const json = (await res.json()) as Record<string, ModelsDevProvider>;
    const entries = new Map<string, ProviderRegistryEntry>();
    for (const [key, value] of Object.entries(json)) {
      if (!value || typeof value !== "object") continue;
      try {
        const entry = providerRegistryEntryFromMetadata(key, value, "models.dev");
        entries.set(entry.id, entry);
      } catch {
        // Keep one malformed upstream provider from disabling the whole catalog.
      }
    }
    modelsDevCache = { at: Date.now(), entries };
    return new Map(entries);
  } catch {
    return new Map();
  } finally {
    clearTimeout(timeout);
  }
}

export async function listProviderRegistry(): Promise<ProviderRegistryEntry[]> {
  const merged = await fetchModelsDevProviders();
  for (const [id, entry] of builtinMap()) {
    merged.set(id, entry);
  }
  return Array.from(merged.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}

export async function resolveProviderRegistryEntry(
  providerName: string,
  options: { baseUrl?: string } = {},
): Promise<ProviderRegistryEntry> {
  const rawId = sanitizeProviderId(providerName);
  const canonicalId = PROVIDER_ALIASES[rawId] || rawId;
  const baseUrl = options.baseUrl
    ? normalizeOpenAiCompatibleBaseUrl(options.baseUrl)
    : undefined;
  const builtins = builtinMap();
  const modelsDev = await fetchModelsDevProviders();
  const found = builtins.get(canonicalId) || modelsDev.get(canonicalId);

  if (found) {
    return {
      ...found,
      baseUrl:
        found.providerAdapter === "openai-compatible"
          ? normalizeOpenAiCompatibleBaseUrl(baseUrl || found.baseUrl)
          : normalizeBaseUrl(baseUrl || found.baseUrl),
      providerSource:
        found.providerSource === "builtin" ? "builtin" : "models.dev",
    };
  }

  if (baseUrl) {
    return {
      id: rawId || "openai-compatible",
      providerId: rawId || "openai-compatible",
      label: rawId || "OpenAI-compatible",
      provider: "openai-compatible",
      providerAdapter: "openai-compatible",
      providerNpm: "@ai-sdk/openai-compatible",
      providerSource: "manual",
      baseUrl,
      upstreamMode: "chat/completions",
      compatibilityMode: "chat-completions-bridge",
      tokenEnv: [],
      authType: "api-key",
      runtimeSupported: true,
    };
  }

  return {
    id: rawId || "unknown",
    providerId: rawId || "unknown",
    label: rawId || "Unknown provider",
    provider: rawId || "unknown",
    providerAdapter: "unsupported",
    providerSource: "manual",
    tokenEnv: [],
    authType: "api-key",
    runtimeSupported: false,
  };
}
