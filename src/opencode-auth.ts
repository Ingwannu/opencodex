import { randomUUID } from "node:crypto";
import { NO_AUTH_ACCESS_TOKEN, type Account } from "./types.js";
import {
  amazonBedrockBaseUrlFromOptions,
  cloudflareAiGatewayBaseUrlFromOptions,
  normalizeBaseUrl,
  normalizeOpenAiCompatibleBaseUrl,
  providerRegistryEntryFromMetadata,
  resolveProviderRegistryEntry,
  sanitizeProviderId,
  vertexBaseUrlFromOptions,
  type ProviderRegistryEntry,
} from "./provider-registry.js";
import {
  AWS_BEDROCK_SIGV4_PLACEHOLDER,
  GOOGLE_VERTEX_ADC_PLACEHOLDER,
  resolveGoogleAuthCredentials,
  resolveAwsBedrockCredentials,
} from "./provider-native.js";

type OpenCodeAuthImportOptions = {
  providerConfig?: Map<string, ProviderRegistryEntry>;
  providerConfigSecrets?: Map<string, string>;
};

function normalizeSecret(value: string): string {
  return value.trim().replace(/^Bearer\s+/i, "").trim();
}

function isSapServiceKeyObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  const credentials =
    source.credentials &&
    typeof source.credentials === "object" &&
    !Array.isArray(source.credentials)
      ? (source.credentials as Record<string, unknown>)
      : source;
  const serviceUrls =
    credentials.serviceurls &&
    typeof credentials.serviceurls === "object" &&
    !Array.isArray(credentials.serviceurls)
      ? (credentials.serviceurls as Record<string, unknown>)
      : {};
  return Boolean(
    typeof credentials.clientid === "string" &&
      typeof credentials.clientsecret === "string" &&
      (typeof credentials.url === "string" ||
        typeof credentials.tokenurl === "string") &&
      typeof serviceUrls.AI_API_URL === "string",
  );
}

function secretStringFromValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return normalizeSecret(value);
  if (isSapServiceKeyObject(value)) return JSON.stringify(value);
  return undefined;
}

function sapServiceKeyBaseUrl(value: unknown): string | undefined {
  if (!isSapServiceKeyObject(value)) return undefined;
  const source = value as Record<string, unknown>;
  const credentials =
    source.credentials &&
    typeof source.credentials === "object" &&
    !Array.isArray(source.credentials)
      ? (source.credentials as Record<string, unknown>)
      : source;
  const serviceUrls = credentials.serviceurls as Record<string, unknown>;
  const found = serviceUrls.AI_API_URL;
  return typeof found === "string" && /^https?:\/\//.test(found.trim())
    ? found.trim()
    : undefined;
}

function findSecretInObject(value: unknown, seen = new Set<object>()): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  const wholeServiceKey = secretStringFromValue(value);
  if (wholeServiceKey) return wholeServiceKey;

  const source = value as Record<string, unknown>;
  const directKeys = [
    "apiKey",
    "apikey",
    "api_key",
    "serviceKey",
    "service_key",
    "aicoreServiceKey",
    "aicore_service_key",
    "key",
    "token",
    "accessToken",
    "access_token",
    "bearer",
    "value",
  ];
  for (const key of directKeys) {
    const found = source[key];
    const secret = secretStringFromValue(found);
    if (secret) return secret;
  }

  for (const child of Object.values(source)) {
    const found = findSecretInObject(child, seen);
    if (found) return found;
  }

  return undefined;
}

function findSecretInHeaders(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const headers = value as Record<string, unknown>;
  for (const [key, raw] of Object.entries(headers)) {
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

function findSecretInProviderConfig(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const options = source.options && typeof source.options === "object"
    ? (source.options as Record<string, unknown>)
    : {};
  return (
    findSecretInObject(options) ??
    findSecretInHeaders(options.headers) ??
    findSecretInHeaders(source.headers)
  );
}

function isSecretEnvName(name: string): boolean {
  return /(API_)?KEY|TOKEN|PAT|SECRET|BEARER/i.test(name);
}

function envSecretFromTokenEnv(
  tokenEnv: string[] | undefined,
  env: Record<string, string | undefined>,
): string | undefined {
  for (const name of tokenEnv ?? []) {
    if (!isSecretEnvName(name)) continue;
    const value = env[name];
    if (value?.trim()) return normalizeSecret(value);
  }
  return undefined;
}

function envSecretForProvider(
  providerId: string,
  registry: ProviderRegistryEntry,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (
    providerId === "amazon-bedrock" ||
    registry.providerAdapter === "amazon-bedrock"
  ) {
    return env.AWS_BEARER_TOKEN_BEDROCK?.trim()
      ? normalizeSecret(env.AWS_BEARER_TOKEN_BEDROCK)
      : undefined;
  }
  if (
    providerId === "google-vertex" ||
    providerId === "google-vertex-anthropic" ||
    registry.providerAdapter === "vertex" ||
    registry.providerAdapter === "vertex-anthropic"
  ) {
    if (env.GOOGLE_VERTEX_ACCESS_TOKEN?.trim()) {
      return normalizeSecret(env.GOOGLE_VERTEX_ACCESS_TOKEN);
    }
    if (env.GOOGLE_ACCESS_TOKEN?.trim()) {
      return normalizeSecret(env.GOOGLE_ACCESS_TOKEN);
    }
    return undefined;
  }
  return envSecretFromTokenEnv(registry.tokenEnv, env);
}

function credentialChainTokenForProvider(
  providerId: string,
  registry: ProviderRegistryEntry,
): string | undefined {
  if (
    providerId === "amazon-bedrock" ||
    registry.providerAdapter === "amazon-bedrock"
  ) {
    return resolveAwsBedrockCredentials(registry.providerOptions)
      ? AWS_BEDROCK_SIGV4_PLACEHOLDER
      : undefined;
  }
  if (
    providerId === "google-vertex" ||
    providerId === "google-vertex-anthropic" ||
    registry.providerAdapter === "vertex" ||
    registry.providerAdapter === "vertex-anthropic"
  ) {
    return resolveGoogleAuthCredentials(registry.providerOptions)
      ? GOOGLE_VERTEX_ADC_PLACEHOLDER
      : undefined;
  }
  return undefined;
}

function baseUrlForRegistry(
  registry: ProviderRegistryEntry,
  detectedBaseUrl?: string,
): string | undefined {
  if (registry.providerAdapter === "openai-compatible") {
    return normalizeOpenAiCompatibleBaseUrl(detectedBaseUrl || registry.baseUrl);
  }
  if (registry.providerAdapter === "amazon-bedrock") {
    return normalizeBaseUrl(
      detectedBaseUrl ||
        registry.baseUrl ||
        amazonBedrockBaseUrlFromOptions(registry.providerOptions),
    );
  }
  if (
    registry.providerAdapter === "vertex" ||
    registry.providerAdapter === "vertex-anthropic"
  ) {
    return normalizeBaseUrl(
      detectedBaseUrl ||
        registry.baseUrl ||
        vertexBaseUrlFromOptions(registry.providerOptions),
    );
  }
  return normalizeBaseUrl(detectedBaseUrl || registry.baseUrl);
}

function findBaseUrlInObject(value: unknown, seen = new Set<object>()): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  const sapBaseUrl = sapServiceKeyBaseUrl(value);
  if (sapBaseUrl) return sapBaseUrl;

  const source = value as Record<string, unknown>;
  for (const key of ["baseURL", "baseUrl", "base_url", "url", "endpoint"]) {
    const found = source[key];
    if (typeof found === "string" && /^https?:\/\//.test(found.trim())) {
      return found.trim();
    }
  }

  for (const child of Object.values(source)) {
    const found = findBaseUrlInObject(child, seen);
    if (found) return found;
  }

  return undefined;
}

function entriesFromAuthPayload(payload: unknown): Array<[string, unknown]> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return Object.entries(payload as Record<string, unknown>).filter(
      ([key]) => key !== "$schema",
    );
  }
  if (Array.isArray(payload)) {
    return payload.map((entry, index) => [String(index), entry]);
  }
  return [];
}

export async function accountsFromOpenCodeAuthPayload(
  payload: unknown,
  options: OpenCodeAuthImportOptions = {},
): Promise<Account[]> {
  const accounts: Account[] = [];
  const seenProviderIds = new Set<string>();

  for (const [name, body] of entriesFromAuthPayload(payload)) {
    const providerKey = sanitizeProviderId(name);
    seenProviderIds.add(providerKey);
    const detectedBaseUrl = findBaseUrlInObject(body);
    const configEntry = options.providerConfig?.get(providerKey);
    const registry =
      configEntry ??
      (await resolveProviderRegistryEntry(name, {
        baseUrl: detectedBaseUrl,
      }));
    const token =
      findSecretInObject(body) ??
      options.providerConfigSecrets?.get(providerKey) ??
      envSecretForProvider(providerKey, registry) ??
      credentialChainTokenForProvider(providerKey, registry) ??
      (registry.authType === "none" ? NO_AUTH_ACCESS_TOKEN : undefined);
    if (!token) continue;
    const providerId = sanitizeProviderId(registry.providerId || name);
    const id = `${providerId}-${sanitizeProviderId(name) || randomUUID().slice(0, 8)}`;
    const runtimeSupported = registry.runtimeSupported;
    const baseUrl = baseUrlForRegistry(registry, detectedBaseUrl);

    accounts.push({
      id,
      provider: registry.provider,
      providerId,
      providerAdapter: registry.providerAdapter,
      providerLabel: registry.label,
      providerNpm: registry.providerNpm,
      providerSource: "opencode",
      providerDoc: registry.providerDoc,
      providerAuthEnv: registry.tokenEnv,
      providerAuthType: registry.authType,
      providerOptions: registry.providerOptions,
      providerModels: registry.models,
      upstreamMode: registry.upstreamMode,
      compatibilityMode: registry.compatibilityMode,
      openAiPathPrefix: registry.openAiPathPrefix,
      email: id,
      accessToken: token,
      baseUrl,
      enabled: runtimeSupported,
      priority: 0,
      state: runtimeSupported
        ? undefined
        : {
            lastError: `${registry.providerAdapter} adapter not implemented yet`,
      },
    });
  }

  for (const [providerKey, token] of options.providerConfigSecrets ?? []) {
    if (seenProviderIds.has(providerKey)) continue;
    if (!options.providerConfig?.has(providerKey)) continue;

    const registry = options.providerConfig.get(providerKey)!;
    const providerId = sanitizeProviderId(registry.providerId || providerKey);
    const id = `${providerId}-${providerKey || randomUUID().slice(0, 8)}`;
    const runtimeSupported = registry.runtimeSupported;
    const baseUrl = baseUrlForRegistry(registry);

    accounts.push({
      id,
      provider: registry.provider,
      providerId,
      providerAdapter: registry.providerAdapter,
      providerLabel: registry.label,
      providerNpm: registry.providerNpm,
      providerSource: "opencode",
      providerDoc: registry.providerDoc,
      providerAuthEnv: registry.tokenEnv,
      providerAuthType: registry.authType,
      providerOptions: registry.providerOptions,
      providerModels: registry.models,
      upstreamMode: registry.upstreamMode,
      compatibilityMode: registry.compatibilityMode,
      openAiPathPrefix: registry.openAiPathPrefix,
      email: id,
      accessToken: token,
      baseUrl,
      enabled: runtimeSupported,
      priority: 0,
      state: runtimeSupported
        ? undefined
        : {
            lastError: `${registry.providerAdapter} adapter not implemented yet`,
          },
    });
  }

  for (const [providerKey, registry] of options.providerConfig ?? []) {
    if (seenProviderIds.has(providerKey)) continue;
    if (options.providerConfigSecrets?.has(providerKey)) continue;

    const providerId = sanitizeProviderId(registry.providerId || providerKey);
    const token =
      envSecretForProvider(providerId, registry) ??
      credentialChainTokenForProvider(providerId, registry) ??
      (registry.authType === "none" ? NO_AUTH_ACCESS_TOKEN : undefined);
    if (!token) continue;
    const id = `${providerId}-${providerKey || randomUUID().slice(0, 8)}`;
    const runtimeSupported = registry.runtimeSupported;
    const baseUrl = baseUrlForRegistry(registry);

    accounts.push({
      id,
      provider: registry.provider,
      providerId,
      providerAdapter: registry.providerAdapter,
      providerLabel: registry.label,
      providerNpm: registry.providerNpm,
      providerSource: "opencode",
      providerDoc: registry.providerDoc,
      providerAuthEnv: registry.tokenEnv,
      providerAuthType: registry.authType,
      providerOptions: registry.providerOptions,
      providerModels: registry.models,
      upstreamMode: registry.upstreamMode,
      compatibilityMode: registry.compatibilityMode,
      openAiPathPrefix: registry.openAiPathPrefix,
      email: id,
      accessToken: token,
      baseUrl,
      enabled: runtimeSupported,
      priority: 0,
      state: runtimeSupported
        ? undefined
        : {
            lastError: `${registry.providerAdapter} adapter not implemented yet`,
          },
    });
  }

  return accounts;
}

function stripJsonComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function substituteEnvVariables(source: string): string {
  return source.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) =>
    JSON.stringify(process.env[String(name)] ?? "").slice(1, -1),
  );
}

function objectFromPath(source: unknown, path: string[]): unknown {
  let current = source;
  for (const segment of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function providerConfigFromOpenCodeConfigPayload(
  payload: unknown,
): Map<string, ProviderRegistryEntry> {
  const providers = objectFromPath(payload, ["provider"]);
  const out = new Map<string, ProviderRegistryEntry>();
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return out;
  }

  for (const [providerId, raw] of Object.entries(
    providers as Record<string, unknown>,
  )) {
    if (!raw || typeof raw !== "object") continue;
    const source = raw as Record<string, unknown>;
    const options = source.options && typeof source.options === "object"
      ? (source.options as Record<string, unknown>)
      : {};
    const env = source.env;
    const metadata = {
      id: providerId,
      name: typeof source.name === "string" ? source.name : providerId,
      npm: typeof source.npm === "string" ? source.npm : undefined,
      api:
        typeof options.baseURL === "string"
          ? options.baseURL
          : typeof options.baseUrl === "string"
            ? options.baseUrl
            : typeof options.base_url === "string"
              ? options.base_url
              : sanitizeProviderId(providerId) === "cloudflare-ai-gateway"
                ? cloudflareAiGatewayBaseUrlFromOptions(options)
                : undefined,
      env: Array.isArray(env)
        ? env.filter((value): value is string => typeof value === "string")
        : typeof env === "string"
          ? [env]
          : [],
      doc: typeof source.doc === "string" ? source.doc : undefined,
      options,
      models:
        source.models && typeof source.models === "object"
          ? (source.models as Record<string, unknown>)
          : undefined,
    };
    out.set(
      sanitizeProviderId(providerId),
      providerRegistryEntryFromMetadata(providerId, metadata, "manual"),
    );
  }

  return out;
}

export function providerSecretsFromOpenCodeConfigPayload(
  payload: unknown,
): Map<string, string> {
  const providers = objectFromPath(payload, ["provider"]);
  const out = new Map<string, string>();
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return out;
  }

  for (const [providerId, raw] of Object.entries(
    providers as Record<string, unknown>,
  )) {
    const secret = findSecretInProviderConfig(raw);
    if (secret) out.set(sanitizeProviderId(providerId), secret);
  }

  return out;
}

export function parseOpenCodeConfigPayload(source: string): unknown {
  return JSON.parse(stripJsonComments(substituteEnvVariables(source)));
}
