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
  "gateway",
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

function optionString(
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

function hasGenericEndpointOption(
  options: Record<string, unknown> | undefined,
): boolean {
  const endpoint = optionString(options, [
    "baseURL",
    "baseUrl",
    "base_url",
    "url",
    "endpoint",
  ]);
  return Boolean(endpoint && /^https?:\/\//.test(endpoint));
}

export function providerOptionsCanDeriveEndpoint(
  providerId: string | undefined,
  providerAdapter: string | undefined,
  providerOptionsJson: string,
): boolean {
  let options: Record<string, unknown> | undefined;
  try {
    options = parseProviderOptionsInput(providerOptionsJson);
  } catch {
    return false;
  }
  if (!options) return false;
  if (hasGenericEndpointOption(options)) return true;

  const id = String(providerId ?? "").trim().toLowerCase();
  const adapter = String(providerAdapter ?? "").trim();
  if (adapter === "amazon-bedrock") {
    return Boolean(optionString(options, ["region", "awsRegion", "aws_region"]));
  }
  if (adapter === "vertex" || adapter === "vertex-anthropic") {
    return Boolean(
      optionString(options, [
        "project",
        "projectId",
        "projectID",
        "googleCloudProject",
        "google_cloud_project",
        "googleVertexProject",
        "google_vertex_project",
      ]),
    );
  }
  if (adapter === "sap-ai-core") {
    return Boolean(
      optionString(options, ["apiUrl", "AI_API_URL"]) ??
        options.serviceKey ??
        options.service_key ??
        options.aicoreServiceKey ??
        options.aicore_service_key,
    );
  }
  if (adapter === "openai-compatible") {
    if (id === "azure" || id === "azure-cognitive-services") {
      return Boolean(
        optionString(options, [
          "resourceName",
          "resource_name",
          "resource",
          "resourceId",
          "resource_id",
        ]),
      );
    }
    if (id === "cloudflare-ai-gateway") {
      return Boolean(
        optionString(options, ["accountId", "accountID", "account_id", "account"]) &&
          optionString(options, ["gatewayId", "gatewayID", "gateway_id", "gateway"]),
      );
    }
    if (id === "cloudflare-workers-ai") {
      return Boolean(
        optionString(options, ["accountId", "accountID", "account_id", "account"]),
      );
    }
  }
  return false;
}

export function normalizeOpenCodeImportOptions(
  authPath: string,
  configPath: string,
  authContent = "",
  configContent = "",
): OpenCodeImportOptions {
  const options: OpenCodeImportOptions = {};
  const trimmedAuthPath = authPath.trim();
  const trimmedConfigPath = configPath.trim();
  const trimmedAuthContent = authContent.trim();
  const trimmedConfigContent = configContent.trim();

  if (trimmedAuthPath) options.path = trimmedAuthPath;
  if (trimmedConfigPath) options.configPath = trimmedConfigPath;
  if (trimmedAuthContent) options.authContent = trimmedAuthContent;
  if (trimmedConfigContent) options.configContent = trimmedConfigContent;

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
