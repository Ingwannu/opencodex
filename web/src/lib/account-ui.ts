import type {
  Account,
  OpenCodeImportOptions,
  ProviderRegistryEntry,
} from "../types";

const ROUTABLE_ADAPTERS = new Set([
  "openai",
  "openai-compatible",
  "mistral",
  "zai",
  "anthropic",
  "google",
  "cohere",
  "amazon-bedrock",
  "vertex",
  "vertex-anthropic",
  "gitlab",
  "sap-ai-core",
]);

const AUTH_ONLY_ERROR_PATTERNS = [
  "auth-only",
  "unsupported adapter",
  "not runtime",
  "unresolved environment",
  "endpoint contains unresolved",
  "endpoint not configured",
  "missing endpoint",
  "missing base url",
  "missing required environment",
];

export type ProviderAuthDescription = {
  statusLabel: string;
  statusTone: "live" | "warn";
  authLabel: string;
  envVars: string[];
  adapterLabel: string;
  sourceLabel: string;
  packageName?: string;
  docsUrl?: string;
  endpointLabel: string;
  modelsLabel?: string;
};

function accountAdapter(account: Account) {
  return account.providerAdapter ?? account.provider ?? "openai";
}

function hasAuthOnlyError(account: Account) {
  const error = account.state?.lastError?.toLowerCase() ?? "";
  return AUTH_ONLY_ERROR_PATTERNS.some((pattern) => error.includes(pattern));
}

export function isAuthOnlyAccount(account: Account) {
  const adapter = accountAdapter(account);
  if (!ROUTABLE_ADAPTERS.has(adapter)) return true;

  if (
    adapter === "openai-compatible" &&
    !account.enabled &&
    (!account.baseUrl || hasAuthOnlyError(account))
  ) {
    return true;
  }

  return !account.enabled && hasAuthOnlyError(account);
}

export function formatProviderEndpoint(baseUrl?: string) {
  return baseUrl?.trim() || "Endpoint not configured";
}

export function formatProviderOptions(options?: Record<string, unknown>) {
  if (!options || !Object.keys(options).length) return "";
  return JSON.stringify(options, null, 2);
}

export function parseProviderOptionsInput(
  input: string,
): Record<string, unknown> | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Provider options must be valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Provider options must be a JSON object");
  }

  return parsed as Record<string, unknown>;
}

export function normalizeOpenCodeImportOptions(
  authPath: string,
  configPath: string,
): OpenCodeImportOptions {
  const options: OpenCodeImportOptions = {};
  const trimmedAuthPath = authPath.trim();
  const trimmedConfigPath = configPath.trim();

  if (trimmedAuthPath) options.path = trimmedAuthPath;
  if (trimmedConfigPath) options.configPath = trimmedConfigPath;

  return options;
}

export function describeProviderAuth(
  provider?: ProviderRegistryEntry,
): ProviderAuthDescription | undefined {
  if (!provider) return undefined;

  const modelCount =
    typeof provider.modelsCount === "number" ? provider.modelsCount : undefined;
  return {
    statusLabel: provider.runtimeSupported ? "Runtime-ready" : "Auth-only",
    statusTone: provider.runtimeSupported ? "live" : "warn",
    authLabel:
      provider.authType === "oauth"
        ? "OAuth"
        : provider.authType === "none"
          ? "No auth"
          : "API key",
    envVars: Array.from(new Set(provider.tokenEnv)).filter(Boolean),
    adapterLabel: provider.providerAdapter || provider.provider,
    sourceLabel: provider.providerSource,
    packageName: provider.providerNpm,
    docsUrl: provider.providerDoc,
    endpointLabel: formatProviderEndpoint(provider.baseUrl),
    modelsLabel:
      modelCount === undefined
        ? undefined
        : `${modelCount} ${modelCount === 1 ? "model" : "models"}`,
  };
}
