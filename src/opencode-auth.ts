import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  NO_AUTH_ACCESS_TOKEN,
  type Account,
  type OpenAiPathPrefix,
  type ProviderAuthType,
  type ProviderAdapter,
  type RouteProviderId,
  type UpstreamMode,
} from "./types.js";
import {
  amazonBedrockBaseUrlFromOptions,
  azureOpenAiBaseUrlFromOptions,
  cloudflareAiGatewayBaseUrlFromOptions,
  cloudflareWorkersAiBaseUrlFromOptions,
  isRuntimeSupportedProvider,
  normalizeBaseUrl,
  normalizeOpenAiCompatibleBaseUrl,
  providerAdapterFromNpm,
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

type OpenCodeCredentialFields = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  providerAuthType?: ProviderAuthType;
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
    "access",
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

function nonNegativeNumber(value: unknown): number | undefined {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function openCodeCredentialFields(value: unknown): OpenCodeCredentialFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  if (source.type === "oauth") {
    const accessToken = secretStringFromValue(source.access);
    return {
      ...(accessToken ? { accessToken } : {}),
      ...(typeof source.refresh === "string" && source.refresh.trim()
        ? { refreshToken: source.refresh.trim() }
        : {}),
      ...(nonNegativeNumber(source.expires) !== undefined
        ? { expiresAt: nonNegativeNumber(source.expires) }
        : {}),
      providerAuthType: "oauth",
    };
  }
  if (source.type === "key") {
    const accessToken = secretStringFromValue(source.key);
    return {
      ...(accessToken ? { accessToken } : {}),
      providerAuthType: "api-key",
    };
  }
  return {};
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
  return stripNativeVersionSuffix(
    registry.providerAdapter,
    normalizeBaseUrl(detectedBaseUrl || registry.baseUrl),
  );
}

type ModelProviderOverride = {
  adapter: RouteProviderId;
  providerNpm?: string;
  baseUrl?: string;
  upstreamMode?: UpstreamMode;
  compatibilityMode?: "responses" | "chat-completions-bridge";
  openAiPathPrefix?: OpenAiPathPrefix;
  models: Record<string, unknown>;
};

function providerOverrideObject(
  metadata: unknown,
): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  const provider = (metadata as Record<string, unknown>).provider;
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    return undefined;
  }
  return provider as Record<string, unknown>;
}

function firstProviderOverrideString(
  source: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function stripNativeVersionSuffix(
  adapter: ProviderAdapter,
  baseUrl: string | undefined,
): string | undefined {
  if (!baseUrl) return undefined;
  if (adapter === "anthropic") return baseUrl.replace(/\/v1$/i, "");
  if (adapter === "google") return baseUrl.replace(/\/v1(?:beta)?$/i, "");
  if (adapter === "cohere") return baseUrl.replace(/\/v2$/i, "");
  return baseUrl;
}

function vertexEndpointHostForRegistry(
  registry: ProviderRegistryEntry,
): string | undefined {
  if (process.env.GOOGLE_VERTEX_ENDPOINT?.trim()) {
    return process.env.GOOGLE_VERTEX_ENDPOINT.trim();
  }
  if (!registry.baseUrl) return undefined;
  try {
    return new URL(registry.baseUrl).host;
  } catch {
    return undefined;
  }
}

function apiWithDerivedProviderEnv(
  api: string | undefined,
  registry: ProviderRegistryEntry,
): string | undefined {
  if (!api) return undefined;
  if (
    !api.includes("GOOGLE_VERTEX_ENDPOINT") ||
    process.env.GOOGLE_VERTEX_ENDPOINT?.trim()
  ) {
    return api;
  }
  const endpoint = vertexEndpointHostForRegistry(registry);
  if (!endpoint) return api;
  return api
    .replace(/\$\{GOOGLE_VERTEX_ENDPOINT\}/g, endpoint)
    .replace(/\{env:GOOGLE_VERTEX_ENDPOINT\}/g, endpoint);
}

function modelOverrideBaseUrl(
  adapter: RouteProviderId,
  api: string | undefined,
  registry: ProviderRegistryEntry,
): string | undefined {
  const resolvedApi = apiWithDerivedProviderEnv(api, registry);
  if (adapter === "openai-compatible") {
    return normalizeOpenAiCompatibleBaseUrl(resolvedApi ?? registry.baseUrl);
  }
  return stripNativeVersionSuffix(
    adapter,
    normalizeBaseUrl(resolvedApi ?? registry.baseUrl),
  );
}

function canShareRegistryBaseForModelOverride(
  registry: ProviderRegistryEntry,
  adapter: RouteProviderId,
): boolean {
  return registry.providerAdapter === "vertex" && adapter === "vertex-anthropic";
}

function modelProviderOverrideForMetadata(
  registry: ProviderRegistryEntry,
  modelId: string,
  metadata: unknown,
): ModelProviderOverride | undefined {
  const provider = providerOverrideObject(metadata);
  if (!provider) return undefined;

  const npm = firstProviderOverrideString(provider, ["npm", "package"]);
  const adapter = providerAdapterFromNpm(modelId, npm);
  if (!isRuntimeSupportedProvider(adapter)) return undefined;

  const api = firstProviderOverrideString(provider, [
    "api",
    "baseURL",
    "baseUrl",
    "base_url",
    "url",
    "endpoint",
  ]);
  if (!api && !canShareRegistryBaseForModelOverride(registry, adapter)) {
    return undefined;
  }
  const baseUrl = modelOverrideBaseUrl(adapter, api, registry);
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

function baseProviderModelsForRegistry(
  registry: ProviderRegistryEntry,
): Record<string, unknown> | undefined {
  if (!registry.models || typeof registry.models !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [modelId, metadata] of Object.entries(registry.models)) {
    if (modelProviderOverrideForMetadata(registry, modelId, metadata)) continue;
    out[modelId] = metadata;
  }
  return Object.keys(out).length ? out : undefined;
}

function modelProviderOverrideAccountsForRegistry(
  baseAccount: Account,
  registry: ProviderRegistryEntry,
  token: string,
): Account[] {
  if (!registry.models || typeof registry.models !== "object") return [];

  const groups = new Map<string, ModelProviderOverride>();
  for (const [modelId, metadata] of Object.entries(registry.models)) {
    const override = modelProviderOverrideForMetadata(registry, modelId, metadata);
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
      sanitizeProviderId(`${override.adapter}-${override.baseUrl ?? "default"}`) ||
      override.adapter;
    const enabled =
      isRuntimeSupportedProvider(override.adapter) &&
      (override.adapter !== "openai-compatible" || Boolean(override.baseUrl));
    return {
      ...baseAccount,
      id: `${baseAccount.id}-${suffix}`,
      provider: override.adapter,
      providerAdapter: override.adapter as ProviderAdapter,
      providerLabel: `${baseAccount.providerLabel ?? registry.label} (${override.adapter})`,
      providerNpm: override.providerNpm ?? baseAccount.providerNpm,
      providerModels: override.models,
      upstreamMode: override.upstreamMode,
      compatibilityMode: override.compatibilityMode,
      openAiPathPrefix: override.openAiPathPrefix,
      email: `${baseAccount.email ?? baseAccount.id}-${suffix}`,
      accessToken: token,
      baseUrl: override.baseUrl,
      enabled,
      state: enabled
        ? undefined
        : {
            lastError: `${override.adapter} adapter not implemented yet`,
          },
    };
  });
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

function credentialMetadataOptions(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const metadata = source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata)
    ? (source.metadata as Record<string, unknown>)
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
    if (typeof source[key] === "string" && source[key].trim()) {
      out[key] = source[key];
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function detectedBaseUrlForAuthEntry(
  providerId: string,
  body: unknown,
): string | undefined {
  const id = sanitizeProviderId(providerId);
  const metadataOptions = credentialMetadataOptions(body);
  return (
    findBaseUrlInObject(body) ??
    (id === "cloudflare-ai-gateway"
      ? cloudflareAiGatewayBaseUrlFromOptions(metadataOptions)
      : id === "cloudflare-workers-ai"
        ? cloudflareWorkersAiBaseUrlFromOptions(metadataOptions)
        : undefined) ??
    azureOpenAiBaseUrlFromOptions(providerId, metadataOptions)
  );
}

function gatewayIdFromOptions(
  options: Record<string, unknown> | undefined,
): string | undefined {
  if (!options) return undefined;
  for (const key of ["gatewayId", "gatewayID", "gateway_id", "gateway"]) {
    const value = options[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function providerOptionsForAuthEntry(
  providerId: string,
  registry: ProviderRegistryEntry,
  body: unknown,
): Record<string, unknown> | undefined {
  const base = registry.providerOptions ?? {};
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

type OpenCodeAuthEntry = {
  name: string;
  body: unknown;
  label?: string;
  credentialId?: string;
};

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function storedCredentialEntry(
  value: unknown,
): OpenCodeAuthEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const name =
    trimmedString(source.integrationID) ?? trimmedString(source.integration_id);
  if (!name) return undefined;
  const body = source.value;
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const label = trimmedString(source.label);
  const credentialId = trimmedString(source.id);
  return {
    name,
    body,
    ...(label ? { label } : {}),
    ...(credentialId ? { credentialId } : {}),
  };
}

function entriesFromAuthArray(payload: unknown[]): OpenCodeAuthEntry[] {
  return payload.map((entry, index) => {
    return storedCredentialEntry(entry) ?? { name: String(index), body: entry };
  });
}

function entriesFromAuthPayload(payload: unknown): OpenCodeAuthEntry[] {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const source = payload as Record<string, unknown>;
    return Object.entries(source)
      .filter(([key]) => key !== "$schema")
      .map(([name, body]) => ({ name, body }));
  }
  if (Array.isArray(payload)) {
    return entriesFromAuthArray(payload);
  }
  return [];
}

function isSqliteDatabase(bytes: Uint8Array): boolean {
  const header = Buffer.from(bytes.subarray(0, 16)).toString("latin1");
  return header === "SQLite format 3\u0000";
}

function parseCredentialRowValue(value: unknown): unknown | undefined {
  if (typeof value === "string" && value.trim()) return JSON.parse(value);
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return undefined;
}

async function readOpenCodeCredentialDatabase(filePath: string): Promise<unknown[]> {
  let sqliteModule: any;
  try {
    sqliteModule = await import("node:sqlite" as string);
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
      .all() as Array<Record<string, unknown>>;
    return rows.flatMap((row) => {
      const integrationID = trimmedString(row.integration_id);
      const value = parseCredentialRowValue(row.value);
      if (!integrationID || !value) return [];
      const label = trimmedString(row.label) ?? "default";
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

export async function readOpenCodeAuthPayloadFromPath(
  filePath: string,
): Promise<unknown> {
  const bytes = await readFile(filePath);
  if (isSqliteDatabase(bytes)) {
    return readOpenCodeCredentialDatabase(filePath);
  }
  return JSON.parse(bytes.toString("utf8"));
}

export async function accountsFromOpenCodeAuthPayload(
  payload: unknown,
  options: OpenCodeAuthImportOptions = {},
): Promise<Account[]> {
  const accounts: Account[] = [];
  const seenProviderIds = new Set<string>();

  for (const entry of entriesFromAuthPayload(payload)) {
    const { name, body } = entry;
    const providerKey = sanitizeProviderId(name);
    seenProviderIds.add(providerKey);
    const detectedBaseUrl = detectedBaseUrlForAuthEntry(providerKey, body);
    const configEntry = options.providerConfig?.get(providerKey);
    const registry =
      configEntry ??
      (await resolveProviderRegistryEntry(name, {
        baseUrl: detectedBaseUrl,
      }));
    const credential = openCodeCredentialFields(body);
    const token =
      credential.accessToken ??
      findSecretInObject(body) ??
      options.providerConfigSecrets?.get(providerKey) ??
      envSecretForProvider(providerKey, registry) ??
      credentialChainTokenForProvider(providerKey, registry) ??
      (registry.authType === "none" ? NO_AUTH_ACCESS_TOKEN : undefined);
    if (!token) continue;
    const providerId = sanitizeProviderId(registry.providerId || name);
    const accountSuffix =
      sanitizeProviderId(entry.label ?? entry.credentialId ?? name) ||
      randomUUID().slice(0, 8);
    const id = `${providerId}-${accountSuffix}`;
    const baseUrl = baseUrlForRegistry(registry, detectedBaseUrl);
    const runtimeSupported =
      registry.runtimeSupported ||
      (registry.providerAdapter === "openai-compatible" && Boolean(baseUrl));

    const account: Account = {
      id,
      provider: registry.provider,
      providerId,
      providerAdapter: registry.providerAdapter,
      providerLabel: registry.label,
      providerNpm: registry.providerNpm,
      providerSource: "opencode",
      providerDoc: registry.providerDoc,
      providerAuthEnv: registry.tokenEnv,
      providerAuthType: credential.providerAuthType ?? registry.authType,
      providerOptions: providerOptionsForAuthEntry(providerKey, registry, body),
      providerModels: baseProviderModelsForRegistry(registry),
      upstreamMode: registry.upstreamMode,
      compatibilityMode: registry.compatibilityMode,
      openAiPathPrefix: registry.openAiPathPrefix,
      email: id,
      accessToken: token,
      refreshToken: credential.refreshToken,
      expiresAt: credential.expiresAt,
      baseUrl,
      enabled: runtimeSupported,
      priority: 0,
      state: runtimeSupported
        ? undefined
        : {
            lastError: `${registry.providerAdapter} adapter not implemented yet`,
      },
    };
    accounts.push(
      ...modelProviderOverrideAccountsForRegistry(account, registry, token),
      account,
    );
  }

  for (const [providerKey, token] of options.providerConfigSecrets ?? []) {
    if (seenProviderIds.has(providerKey)) continue;
    if (!options.providerConfig?.has(providerKey)) continue;

    const registry = options.providerConfig.get(providerKey)!;
    const providerId = sanitizeProviderId(registry.providerId || providerKey);
    const id = `${providerId}-${providerKey || randomUUID().slice(0, 8)}`;
    const runtimeSupported = registry.runtimeSupported;
    const baseUrl = baseUrlForRegistry(registry);

    const account: Account = {
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
      providerModels: baseProviderModelsForRegistry(registry),
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
    };
    accounts.push(
      ...modelProviderOverrideAccountsForRegistry(account, registry, token),
      account,
    );
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

    const account: Account = {
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
      providerModels: baseProviderModelsForRegistry(registry),
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
    };
    accounts.push(
      ...modelProviderOverrideAccountsForRegistry(account, registry, token),
      account,
    );
  }

  return accounts;
}

function stripJsonComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function stripJsonTrailingCommas(source: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (inString) {
      out += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      out += char;
      continue;
    }

    if (char === ",") {
      let nextIndex = i + 1;
      while (nextIndex < source.length && /\s/.test(source[nextIndex])) {
        nextIndex += 1;
      }
      if (source[nextIndex] === "}" || source[nextIndex] === "]") continue;
    }

    out += char;
  }

  return out;
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
                : sanitizeProviderId(providerId) === "cloudflare-workers-ai"
                  ? cloudflareWorkersAiBaseUrlFromOptions(options)
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
  return JSON.parse(
    stripJsonTrailingCommas(stripJsonComments(substituteEnvVariables(source))),
  );
}
