import type {
  CompatibilityMode,
  OpenAiPathPrefix,
  ProviderAdapter,
  ProviderAuthType,
  RouteProviderId,
  UpstreamMode,
} from "./types.js";

const MODELS_DEV_API_URL =
  process.env.MODELS_DEV_API_URL ?? "https://models.dev/api.json";
const MODELS_DEV_TIMEOUT_MS = Number(
  process.env.MODELS_DEV_TIMEOUT_MS ?? 2500,
);
const DEFAULT_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v3/ai";

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
  openAiPathPrefix?: OpenAiPathPrefix;
  upstreamMode?: UpstreamMode;
  compatibilityMode?: CompatibilityMode;
  providerOptions?: Record<string, unknown>;
  tokenEnv: string[];
  authType: ProviderAuthType;
  runtimeSupported: boolean;
  models?: Record<string, unknown>;
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
  options?: Record<string, unknown>;
};

const DISALLOWED_PROVIDER_OPTION_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

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
    id: "vercel",
    providerId: "vercel",
    label: "Vercel AI Gateway",
    provider: "gateway",
    providerAdapter: "gateway",
    providerNpm: "@ai-sdk/gateway",
    providerSource: "builtin",
    providerDoc: "https://vercel.com/docs/ai-gateway",
    baseUrl: DEFAULT_GATEWAY_BASE_URL,
    tokenEnv: ["AI_GATEWAY_API_KEY"],
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
    id: "google-vertex",
    providerId: "google-vertex",
    label: "Google Vertex AI",
    provider: "vertex",
    providerAdapter: "vertex",
    providerNpm: "@ai-sdk/google-vertex",
    providerSource: "builtin",
    providerDoc: "https://opencode.ai/docs/providers/",
    baseUrl: vertexBaseUrlFromOptions(),
    providerOptions: googleVertexProviderOptionsFromSource({
      options: {
        project: process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GOOGLE_VERTEX_PROJECT,
        location: process.env.VERTEX_LOCATION ?? process.env.GOOGLE_VERTEX_LOCATION,
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
    authType: "api-key",
    runtimeSupported: Boolean(vertexBaseUrlFromOptions()),
  },
  {
    id: "google-vertex-anthropic",
    providerId: "google-vertex-anthropic",
    label: "Google Vertex AI Anthropic",
    provider: "vertex-anthropic",
    providerAdapter: "vertex-anthropic",
    providerNpm: "@ai-sdk/google-vertex/anthropic",
    providerSource: "builtin",
    providerDoc: "https://opencode.ai/docs/providers/",
    baseUrl: vertexBaseUrlFromOptions(),
    providerOptions: googleVertexProviderOptionsFromSource({
      options: {
        project: process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GOOGLE_VERTEX_PROJECT,
        location: process.env.VERTEX_LOCATION ?? process.env.GOOGLE_VERTEX_LOCATION,
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
    authType: "api-key",
    runtimeSupported: Boolean(vertexBaseUrlFromOptions()),
  },
  {
    id: "cohere",
    providerId: "cohere",
    label: "Cohere",
    provider: "cohere",
    providerAdapter: "cohere",
    providerNpm: "@ai-sdk/cohere",
    providerSource: "builtin",
    providerDoc: "https://docs.cohere.com/docs/models",
    baseUrl: "https://api.cohere.com",
    tokenEnv: ["COHERE_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "amazon-bedrock",
    providerId: "amazon-bedrock",
    label: "Amazon Bedrock",
    provider: "amazon-bedrock",
    providerAdapter: "amazon-bedrock",
    providerNpm: "@ai-sdk/amazon-bedrock",
    providerSource: "builtin",
    providerDoc: "https://docs.aws.amazon.com/bedrock/latest/userguide/",
    baseUrl: amazonBedrockBaseUrlFromOptions(),
    providerOptions: amazonBedrockProviderOptionsFromSource({
      options: {
        region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION,
        profile: process.env.AWS_PROFILE ?? process.env.AWS_DEFAULT_PROFILE,
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
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "sap-ai-core",
    providerId: "sap-ai-core",
    label: "SAP AI Core",
    provider: "sap-ai-core",
    providerAdapter: "sap-ai-core",
    providerNpm: "@jerome-benoit/sap-ai-provider-v2",
    providerSource: "builtin",
    providerDoc: "https://help.sap.com/docs/sap-ai-core",
    tokenEnv: ["AICORE_SERVICE_KEY"],
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
  {
    id: "ollama",
    providerId: "ollama",
    label: "Ollama (local)",
    provider: "openai-compatible",
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
  {
    id: "lmstudio",
    providerId: "lmstudio",
    label: "LM Studio (local)",
    provider: "openai-compatible",
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
  {
    id: "llama.cpp",
    providerId: "llama.cpp",
    label: "llama.cpp (local)",
    provider: "openai-compatible",
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
];

const PROVIDER_ALIASES: Record<string, string> = {
  "302.ai": "302ai",
  "302-ai": "302ai",
  chatgpt: "openai-chatgpt",
  "io.net": "io-net",
  "llm-gateway": "llmgateway",
  openai: "openai-api",
  "openai-responses": "openai-api",
  "opencode-zen": "opencode",
  "z.ai": "zai",
  zaiorg: "zai",
  zhipu: "zai",
};

type OpenAiCompatibleProviderDefault = {
  baseUrl: string;
  label?: string;
  tokenEnv?: string[];
  providerDoc?: string;
  openAiPathPrefix?: OpenAiPathPrefix;
  upstreamMode?: UpstreamMode;
  compatibilityMode?: CompatibilityMode;
};

const OPENAI_COMPATIBLE_SDK_PROVIDER_DEFAULTS: Record<
  string,
  OpenAiCompatibleProviderDefault
> = {
  "302ai": {
    label: "302.AI",
    baseUrl: "https://api.302.ai/v1",
    tokenEnv: ["302AI_API_KEY"],
  },
  cortecs: {
    label: "Cortecs",
    baseUrl: "https://api.cortecs.ai/v1",
    tokenEnv: ["CORTECS_API_KEY"],
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    tokenEnv: ["DEEPSEEK_API_KEY"],
  },
  "fireworks-ai": {
    label: "Fireworks AI",
    baseUrl: "https://api.fireworks.ai/inference/v1/",
    tokenEnv: ["FIREWORKS_API_KEY"],
  },
  huggingface: {
    label: "Hugging Face",
    baseUrl: "https://router.huggingface.co/v1",
    tokenEnv: ["HF_TOKEN"],
  },
  helicone: {
    label: "Helicone",
    baseUrl: "https://ai-gateway.helicone.ai/v1",
    tokenEnv: ["HELICONE_API_KEY"],
  },
  "io-net": {
    label: "IO.NET",
    baseUrl: "https://api.intelligence.io.solutions/api/v1",
    tokenEnv: ["IOINTELLIGENCE_API_KEY"],
  },
  llmgateway: {
    label: "LLM Gateway",
    baseUrl: "https://api.llmgateway.io/v1",
    tokenEnv: ["LLMGATEWAY_API_KEY"],
  },
  moonshotai: {
    label: "Moonshot AI",
    baseUrl: "https://api.moonshot.ai/v1",
    tokenEnv: ["MOONSHOT_API_KEY"],
  },
  "moonshotai-cn": {
    label: "Moonshot AI (China)",
    baseUrl: "https://api.moonshot.cn/v1",
    tokenEnv: ["MOONSHOT_API_KEY"],
  },
  nvidia: {
    label: "NVIDIA",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    tokenEnv: ["NVIDIA_API_KEY"],
  },
  nebius: {
    label: "Nebius Token Factory",
    baseUrl: "https://api.tokenfactory.nebius.com/v1",
    tokenEnv: ["NEBIUS_API_KEY"],
  },
  "ollama-cloud": {
    label: "Ollama Cloud",
    baseUrl: "https://ollama.com/v1",
    tokenEnv: ["OLLAMA_API_KEY"],
  },
  opencode: {
    label: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    tokenEnv: ["OPENCODE_API_KEY"],
  },
  "opencode-go": {
    label: "OpenCode Go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    tokenEnv: ["OPENCODE_API_KEY"],
  },
  ovhcloud: {
    label: "OVHcloud AI Endpoints",
    baseUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
    tokenEnv: ["OVHCLOUD_API_KEY"],
  },
  scaleway: {
    label: "Scaleway",
    baseUrl: "https://api.scaleway.ai/v1",
    tokenEnv: ["SCALEWAY_API_KEY"],
  },
  stackit: {
    label: "STACKIT",
    baseUrl: "https://api.openai-compat.model-serving.eu01.onstackit.cloud/v1",
    tokenEnv: ["STACKIT_API_KEY"],
  },
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
  venice: { baseUrl: "https://api.venice.ai/api/v1" },
  aihubmix: { baseUrl: "https://aihubmix.com/v1" },
  "merge-gateway": { baseUrl: "https://api-gateway.merge.dev/v1/openai" },
  v0: { baseUrl: "https://api.v0.dev/v1" },
  zenmux: {
    label: "ZenMux",
    baseUrl: "https://zenmux.ai/api/v1",
    tokenEnv: ["ZENMUX_API_KEY"],
  },
};

const OPENAI_COMPATIBLE_SDK_PACKAGE_DEFAULTS: Record<
  string,
  OpenAiCompatibleProviderDefault
> = {
  "@ai-sdk/alibaba": {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  "@ai-sdk/cerebras": { baseUrl: "https://api.cerebras.ai/v1" },
  "@ai-sdk/deepinfra": { baseUrl: "https://api.deepinfra.com/v1/openai" },
  "@ai-sdk/groq": { baseUrl: "https://api.groq.com/openai/v1" },
  "@ai-sdk/perplexity": {
    baseUrl: "https://api.perplexity.ai",
    openAiPathPrefix: "none",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
  },
  "@ai-sdk/togetherai": { baseUrl: "https://api.together.xyz/v1" },
  "@ai-sdk/vercel": { baseUrl: "https://api.v0.dev/v1" },
  "@ai-sdk/xai": { baseUrl: "https://api.x.ai/v1" },
  "@openrouter/ai-sdk-provider": { baseUrl: "https://openrouter.ai/api/v1" },
  "venice-ai-sdk-provider": { baseUrl: "https://api.venice.ai/api/v1" },
};

function openAiCompatibleDefaultFromNpm(
  npmPackage: string | undefined,
): OpenAiCompatibleProviderDefault | undefined {
  const npm = String(npmPackage ?? "").trim().toLowerCase();
  return OPENAI_COMPATIBLE_SDK_PACKAGE_DEFAULTS[npm];
}

function firstStringValue(
  source: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function isLocalHttpBaseUrl(value: string | undefined): boolean {
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

function sourceOptionsCarrySecret(options: Record<string, unknown> | undefined): boolean {
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
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return false;
  }
  return Object.entries(headers as Record<string, unknown>).some(
    ([key, value]) =>
      typeof value === "string" &&
      value.trim().length > 0 &&
      ["authorization", "x-api-key", "api-key"].includes(key.toLowerCase()),
  );
}

function providerHeadersFromOptions(
  options: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  const headers = options?.headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return undefined;
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    const name = key.trim();
    if (!name || DISALLOWED_PROVIDER_OPTION_HEADERS.has(name.toLowerCase())) {
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      out[name] = value.trim();
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function tokenEnvHasSecret(
  tokenEnv: string[],
  env: Record<string, string | undefined> = process.env,
): boolean {
  return tokenEnv.some((name) => Boolean(env[name]?.trim()));
}

function expandEnvTemplates(
  value: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  let missing = false;
  const expanded = value
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

function collapseDuplicateLeadingScheme(value: string): string {
  return value.replace(/^(https?:\/\/)(https?:\/\/)/i, "$2");
}

export function cloudflareAiGatewayBaseUrlFromOptions(
  options: Record<string, unknown> | undefined = {},
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const explicit = firstStringValue(options, [
    "baseURL",
    "baseUrl",
    "base_url",
    "url",
    "endpoint",
  ]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;

  const accountId =
    firstStringValue(options, [
      "accountId",
      "accountID",
      "account_id",
      "account",
    ]) ?? env.CLOUDFLARE_ACCOUNT_ID;
  const gatewayId =
    firstStringValue(options, [
      "gatewayId",
      "gatewayID",
      "gateway_id",
      "gateway",
    ]) ?? env.CLOUDFLARE_GATEWAY_ID;

  if (!accountId?.trim() || !gatewayId?.trim()) return undefined;
  return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(
    accountId.trim(),
  )}/${encodeURIComponent(gatewayId.trim())}/openai`;
}

export function cloudflareWorkersAiBaseUrlFromOptions(
  options: Record<string, unknown> | undefined = {},
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const explicit = firstStringValue(options, [
    "baseURL",
    "baseUrl",
    "base_url",
    "url",
    "endpoint",
  ]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;

  const accountId =
    firstStringValue(options, [
      "accountId",
      "accountID",
      "account_id",
      "account",
    ]) ?? env.CLOUDFLARE_ACCOUNT_ID;

  if (!accountId?.trim()) return undefined;
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    accountId.trim(),
  )}/ai`;
}

function cloudflareGatewayProviderOptionsFromSource(
  source: ModelsDevProvider,
  env: Record<string, string | undefined> = process.env,
): Record<string, unknown> | undefined {
  const options = source.options ?? {};
  for (const key of ["gatewayId", "gatewayID", "gateway_id", "gateway"]) {
    const value = options[key];
    if (typeof value === "string" && value.trim()) {
      return { gatewayId: value.trim() };
    }
  }
  if (env.CLOUDFLARE_GATEWAY_ID?.trim()) {
    return { gatewayId: env.CLOUDFLARE_GATEWAY_ID.trim() };
  }
  return undefined;
}

const AZURE_OPENAI_PROVIDER_IDS = new Set(["azure", "azure-cognitive-services"]);

function isAzureOpenAiProviderSource(
  providerId: string,
  npmPackage: string | undefined,
): boolean {
  return (
    AZURE_OPENAI_PROVIDER_IDS.has(sanitizeProviderId(providerId)) ||
    String(npmPackage ?? "").trim().toLowerCase() === "@ai-sdk/azure"
  );
}

export function azureOpenAiBaseUrlFromOptions(
  providerId: string,
  options: Record<string, unknown> | undefined = {},
  env: Record<string, string | undefined> = process.env,
  allowCustomProviderId = false,
): string | undefined {
  const id = sanitizeProviderId(providerId);
  if (!allowCustomProviderId && !AZURE_OPENAI_PROVIDER_IDS.has(id)) {
    return undefined;
  }

  const explicit = firstStringValue(options, [
    "baseURL",
    "baseUrl",
    "base_url",
    "url",
    "endpoint",
  ]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;

  const resourceName =
    firstStringValue(options, [
      "resourceName",
      "resource_name",
      "resource",
      "resourceId",
      "resource_id",
    ]) ??
    (id === "azure-cognitive-services"
      ? env.AZURE_COGNITIVE_SERVICES_RESOURCE_NAME
      : env.AZURE_RESOURCE_NAME);

  if (!resourceName?.trim()) return undefined;
  return `https://${resourceName.trim()}.openai.azure.com/openai/v1`;
}

export function amazonBedrockBaseUrlFromOptions(
  options: Record<string, unknown> | undefined = {},
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const explicit = firstStringValue(options, [
    "baseURL",
    "baseUrl",
    "base_url",
    "url",
    "endpoint",
  ]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;

  const region =
    firstStringValue(options, ["region", "awsRegion", "aws_region"]) ??
    env.AWS_REGION ??
    env.AWS_DEFAULT_REGION;
  if (!region?.trim()) return undefined;
  return `https://bedrock-runtime.${region.trim()}.amazonaws.com`;
}

export function vertexBaseUrlFromOptions(
  options: Record<string, unknown> | undefined = {},
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const explicit = firstStringValue(options, [
    "baseURL",
    "baseUrl",
    "base_url",
    "url",
    "endpoint",
  ]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;

  const project = firstStringValue(options, [
    "project",
    "projectId",
    "projectID",
    "googleCloudProject",
    "google_cloud_project",
    "googleVertexProject",
    "google_vertex_project",
  ]) ?? env.GOOGLE_CLOUD_PROJECT ?? env.GCLOUD_PROJECT ?? env.GOOGLE_VERTEX_PROJECT;
  const location = firstStringValue(options, [
    "location",
    "region",
    "vertexLocation",
    "vertex_location",
    "googleVertexLocation",
    "google_vertex_location",
  ]) ?? env.VERTEX_LOCATION ?? env.GOOGLE_VERTEX_LOCATION;
  const resolvedLocation = location ?? (project?.trim() ? "global" : undefined);
  if (!project?.trim() || !resolvedLocation?.trim()) return undefined;

  const trimmedLocation = resolvedLocation.trim();
  const endpoint = trimmedLocation === "global"
    ? "https://aiplatform.googleapis.com"
    : `https://${trimmedLocation}-aiplatform.googleapis.com`;
  return `${endpoint}/v1/projects/${encodeURIComponent(project.trim())}/locations/${encodeURIComponent(trimmedLocation)}`;
}

function googleVertexProviderOptionsFromSource(
  source: ModelsDevProvider,
): Record<string, unknown> | undefined {
  const options = source.options ?? {};
  const out: Record<string, unknown> = {};
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

function serviceKeyObjectFromUnknown(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function sapAiCoreBaseUrlFromServiceKey(
  serviceKey: Record<string, unknown> | undefined,
): string | undefined {
  if (!serviceKey) return undefined;
  const credentials =
    serviceKey.credentials &&
    typeof serviceKey.credentials === "object" &&
    !Array.isArray(serviceKey.credentials)
      ? (serviceKey.credentials as Record<string, unknown>)
      : serviceKey;
  const serviceUrls =
    credentials.serviceurls &&
    typeof credentials.serviceurls === "object" &&
    !Array.isArray(credentials.serviceurls)
      ? (credentials.serviceurls as Record<string, unknown>)
      : {};
  const found =
    firstStringValue(serviceUrls, [
      "AI_API_URL",
      "AI_API_URL_V2",
      "ai_api_url",
      "apiUrl",
    ]) ??
    firstStringValue(credentials, ["aiApiUrl", "ai_api_url", "apiUrl"]);
  return found && /^https?:\/\//.test(found) ? found : undefined;
}

export function sapAiCoreBaseUrlFromOptions(
  options: Record<string, unknown> | undefined = {},
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const explicit = firstStringValue(options, [
    "baseURL",
    "baseUrl",
    "base_url",
    "endpoint",
    "apiUrl",
    "AI_API_URL",
  ]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;

  for (const key of [
    "serviceKey",
    "service_key",
    "aicoreServiceKey",
    "aicore_service_key",
    "apiKey",
    "api_key",
  ]) {
    const fromOption = sapAiCoreBaseUrlFromServiceKey(
      serviceKeyObjectFromUnknown(options[key]),
    );
    if (fromOption) return fromOption;
  }

  return sapAiCoreBaseUrlFromServiceKey(
    serviceKeyObjectFromUnknown(env.AICORE_SERVICE_KEY),
  );
}

function sapAiCoreProviderOptionsFromSource(
  source: ModelsDevProvider,
): Record<string, unknown> | undefined {
  const options = source.options ?? {};
  const out: Record<string, unknown> = {};
  for (const key of [
    "deploymentId",
    "deployment_id",
    "resourceGroup",
    "resource_group",
    "modelVersion",
    "model_version",
  ]) {
    const value = options[key];
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

function amazonBedrockProviderOptionsFromSource(
  source: ModelsDevProvider,
): Record<string, unknown> | undefined {
  const options = source.options ?? {};
  const out: Record<string, unknown> = {};
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
  const expanded = expandEnvTemplates(raw);
  if (!expanded?.trim()) return undefined;
  const normalized = collapseDuplicateLeadingScheme(expanded);
  const parsed = new URL(normalized);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("base URL must use http or https");
  }
  return normalized.replace(/\/+$/, "");
}

export function normalizeOpenAiCompatibleBaseUrl(value: unknown): string | undefined {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return undefined;
  return normalized.replace(/\/v1$/i, "");
}

function normalizeNativeProviderBaseUrl(
  adapter: ProviderAdapter,
  value: unknown,
): string | undefined {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return undefined;
  if (adapter === "anthropic") return normalized.replace(/\/v1$/i, "");
  if (adapter === "google") return normalized.replace(/\/v1(?:beta)?$/i, "");
  if (adapter === "cohere") return normalized.replace(/\/v2$/i, "");
  return normalized;
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
  if (id === "vercel" || npm === "@ai-sdk/gateway") return "gateway";
  if (OPENAI_COMPATIBLE_SDK_PROVIDER_DEFAULTS[id]) {
    return "openai-compatible";
  }
  if (id === "cloudflare-ai-gateway" || npm.includes("ai-gateway-provider")) {
    return "openai-compatible";
  }
  if (openAiCompatibleDefaultFromNpm(npm)) return "openai-compatible";
  if (npm === "@ai-sdk/openai" || npm.includes("openai-compatible")) {
    return "openai-compatible";
  }
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
  if (npm === "gitlab-ai-provider" || npm === "@gitlab/gitlab-ai-provider") {
    return "gitlab";
  }
  if (
    id === "sap-ai-core" ||
    npm.includes("sap-ai-provider") ||
    npm.includes("@sap-ai-sdk")
  ) {
    return "sap-ai-core";
  }
  if (npm.includes("google-vertex")) return "unsupported";
  return "unsupported";
}

export function isRuntimeSupportedProvider(adapter: ProviderAdapter): adapter is RouteProviderId {
  return (
    adapter === "openai" ||
    adapter === "openai-compatible" ||
    adapter === "mistral" ||
    adapter === "zai" ||
    adapter === "anthropic" ||
    adapter === "google" ||
    adapter === "cohere" ||
    adapter === "gateway" ||
    adapter === "amazon-bedrock" ||
    adapter === "vertex" ||
    adapter === "vertex-anthropic" ||
    adapter === "gitlab" ||
    adapter === "sap-ai-core"
  );
}

function tokenEnvForProvider(
  providerId: string,
  adapter: ProviderAdapter,
  env: unknown,
): string[] {
  const sourceEnv = Array.isArray(env)
    ? env.filter((value): value is string => typeof value === "string")
    : [];
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

function providerForAdapter(
  providerId: string,
  adapter: ProviderAdapter,
): string {
  return isRuntimeSupportedProvider(adapter) ? adapter : sanitizeProviderId(providerId);
}

export function providerRegistryEntryFromMetadata(
  providerId: string,
  source: ModelsDevProvider,
  providerSource: "builtin" | "models.dev" | "manual" = "models.dev",
): ProviderRegistryEntry {
  const id = sanitizeProviderId(source.id || providerId);
  const openAiCompatibleDefault =
    OPENAI_COMPATIBLE_SDK_PROVIDER_DEFAULTS[id] ??
    openAiCompatibleDefaultFromNpm(source.npm);
  const cloudflareAiGatewayBaseUrl =
    id === "cloudflare-ai-gateway"
      ? cloudflareAiGatewayBaseUrlFromOptions(source.options)
      : undefined;
  const cloudflareWorkersAiBaseUrl =
    id === "cloudflare-workers-ai"
      ? cloudflareWorkersAiBaseUrlFromOptions(source.options)
      : undefined;
  const isAzureOpenAiProvider = isAzureOpenAiProviderSource(id, source.npm);
  const azureOpenAiBaseUrl = isAzureOpenAiProvider
    ? azureOpenAiBaseUrlFromOptions(id, source.options, process.env, true)
    : undefined;
  const bedrockBaseUrl =
    id === "amazon-bedrock"
      ? amazonBedrockBaseUrlFromOptions(source.options)
      : undefined;
  const vertexBaseUrl =
    id === "google-vertex" || id === "google-vertex-anthropic"
      ? vertexBaseUrlFromOptions(source.options)
      : undefined;
  const sapBaseUrl =
    id === "sap-ai-core" ? sapAiCoreBaseUrlFromOptions(source.options) : undefined;
  const gatewayBaseUrl =
    id === "vercel" ||
    String(source.npm ?? "").trim().toLowerCase() === "@ai-sdk/gateway"
      ? (source.api ?? DEFAULT_GATEWAY_BASE_URL)
      : undefined;
  const openAiCompatibleBaseUrl =
    source.api ??
    openAiCompatibleDefault?.baseUrl ??
    cloudflareAiGatewayBaseUrl ??
    cloudflareWorkersAiBaseUrl ??
    azureOpenAiBaseUrl;
  const requiresOpenAiCompatibleEndpoint =
    id === "cloudflare-ai-gateway" ||
    id === "cloudflare-workers-ai" ||
    isAzureOpenAiProvider;
  const adapter =
    requiresOpenAiCompatibleEndpoint
      ? "openai-compatible"
      : providerAdapterFromNpm(id, source.npm);
  const baseUrl =
    adapter === "openai-compatible"
      ? normalizeOpenAiCompatibleBaseUrl(openAiCompatibleBaseUrl)
      : normalizeNativeProviderBaseUrl(
          adapter,
          source.api ??
            (adapter === "anthropic"
              ? "https://api.anthropic.com"
              : adapter === "google"
                ? "https://generativelanguage.googleapis.com"
                : adapter === "cohere"
                  ? "https://api.cohere.com"
                  : adapter === "gateway"
                    ? gatewayBaseUrl
                  : adapter === "amazon-bedrock"
                    ? bedrockBaseUrl
                    : adapter === "vertex" || adapter === "vertex-anthropic"
                    ? vertexBaseUrl
                    : adapter === "gitlab"
                      ? "https://gitlab.com"
                      : adapter === "sap-ai-core"
                        ? sapBaseUrl
                    : undefined),
        );
  const runtimeSupported =
    isRuntimeSupportedProvider(adapter) &&
    ((adapter !== "vertex" && adapter !== "vertex-anthropic") ||
      Boolean(vertexBaseUrl)) &&
    (!requiresOpenAiCompatibleEndpoint || Boolean(baseUrl)) &&
    (adapter !== "openai-compatible" ||
      openAiCompatibleBaseUrl === undefined ||
      Boolean(baseUrl));
  const tokenEnv = tokenEnvForProvider(id, adapter, source.env);
  const authType =
    adapter === "openai-compatible" &&
    isLocalHttpBaseUrl(baseUrl) &&
    !sourceOptionsCarrySecret(source.options) &&
    !tokenEnvHasSecret(tokenEnv)
      ? "none"
      : "api-key";
  const adapterProviderOptions =
    adapter === "amazon-bedrock"
      ? amazonBedrockProviderOptionsFromSource(source)
      : adapter === "vertex" || adapter === "vertex-anthropic"
        ? googleVertexProviderOptionsFromSource(source)
      : adapter === "sap-ai-core"
        ? sapAiCoreProviderOptionsFromSource(source)
      : id === "cloudflare-ai-gateway" || id === "cloudflare-workers-ai"
        ? cloudflareGatewayProviderOptionsFromSource(source)
        : undefined;
  const providerHeaders = providerHeadersFromOptions(source.options);
  const providerOptions = {
    ...(adapterProviderOptions ?? {}),
    ...(providerHeaders ? { headers: providerHeaders } : {}),
  };

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
    openAiPathPrefix: openAiCompatibleDefault?.openAiPathPrefix,
    upstreamMode:
      adapter === "openai-compatible"
        ? (isAzureOpenAiProvider
          ? "responses"
          : (openAiCompatibleDefault?.upstreamMode ?? "chat/completions"))
        : undefined,
    compatibilityMode:
      adapter === "openai-compatible"
        ? (isAzureOpenAiProvider
          ? "responses"
          : (openAiCompatibleDefault?.compatibilityMode ??
          "chat-completions-bridge")
        )
        : undefined,
    providerOptions: Object.keys(providerOptions).length
      ? providerOptions
      : undefined,
    tokenEnv,
    authType,
    runtimeSupported,
    models:
      source.models && typeof source.models === "object"
        ? source.models
        : undefined,
    modelsCount:
      source.models && typeof source.models === "object"
        ? Object.keys(source.models).length
        : undefined,
  };
}

function fallbackOpenAiCompatibleRegistryEntry(
  providerId: string,
): ProviderRegistryEntry | undefined {
  const id = sanitizeProviderId(providerId);
  const defaults = OPENAI_COMPATIBLE_SDK_PROVIDER_DEFAULTS[id];
  if (!defaults) return undefined;

  return providerRegistryEntryFromMetadata(
    id,
    {
      id,
      name: defaults.label ?? id,
      npm: "@ai-sdk/openai-compatible",
      api: defaults.baseUrl,
      env: defaults.tokenEnv ?? [],
      doc: defaults.providerDoc ?? "https://opencode.ai/docs/providers/",
    },
    "builtin",
  );
}

function builtinMap(): Map<string, ProviderRegistryEntry> {
  return new Map(BUILTIN_PROVIDERS.map((entry) => [entry.id, entry]));
}

function mergeBuiltinWithModelsDevEntry(
  builtin: ProviderRegistryEntry,
  modelsDev: ProviderRegistryEntry | undefined,
): ProviderRegistryEntry {
  if (!modelsDev) return builtin;
  const models = modelsDev.models ?? builtin.models;
  const tokenEnv = Array.from(
    new Set([...(builtin.tokenEnv ?? []), ...(modelsDev.tokenEnv ?? [])]),
  );
  return {
    ...modelsDev,
    ...builtin,
    providerDoc: builtin.providerDoc ?? modelsDev.providerDoc,
    providerNpm: builtin.providerNpm ?? modelsDev.providerNpm,
    baseUrl: builtin.baseUrl ?? modelsDev.baseUrl,
    openAiPathPrefix: builtin.openAiPathPrefix ?? modelsDev.openAiPathPrefix,
    upstreamMode: builtin.upstreamMode ?? modelsDev.upstreamMode,
    compatibilityMode: builtin.compatibilityMode ?? modelsDev.compatibilityMode,
    providerOptions: builtin.providerOptions ?? modelsDev.providerOptions,
    tokenEnv,
    runtimeSupported: builtin.runtimeSupported || modelsDev.runtimeSupported,
    models,
    modelsCount: models ? Object.keys(models).length : undefined,
    providerSource: "builtin",
  };
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
    merged.set(id, mergeBuiltinWithModelsDevEntry(entry, merged.get(id)));
  }
  for (const id of Object.keys(OPENAI_COMPATIBLE_SDK_PROVIDER_DEFAULTS)) {
    if (merged.has(id)) continue;
    const fallback = fallbackOpenAiCompatibleRegistryEntry(id);
    if (fallback) merged.set(id, fallback);
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
  const builtin = builtins.get(canonicalId);
  const found = builtin
    ? mergeBuiltinWithModelsDevEntry(builtin, modelsDev.get(canonicalId))
    : (modelsDev.get(canonicalId) ??
      fallbackOpenAiCompatibleRegistryEntry(canonicalId));

  if (found) {
    return {
      ...found,
      baseUrl:
        found.providerAdapter === "openai-compatible"
          ? normalizeOpenAiCompatibleBaseUrl(baseUrl || found.baseUrl)
          : normalizeNativeProviderBaseUrl(
              found.providerAdapter,
              baseUrl || found.baseUrl,
            ),
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
