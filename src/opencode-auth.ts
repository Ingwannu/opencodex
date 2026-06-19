import { randomUUID } from "node:crypto";
import type { Account } from "./types.js";
import {
  cloudflareAiGatewayBaseUrlFromOptions,
  normalizeBaseUrl,
  normalizeOpenAiCompatibleBaseUrl,
  providerRegistryEntryFromMetadata,
  resolveProviderRegistryEntry,
  sanitizeProviderId,
  type ProviderRegistryEntry,
} from "./provider-registry.js";

function findSecretInObject(value: unknown, seen = new Set<object>()): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  const source = value as Record<string, unknown>;
  const directKeys = [
    "apiKey",
    "apikey",
    "api_key",
    "key",
    "token",
    "accessToken",
    "access_token",
    "bearer",
    "value",
  ];
  for (const key of directKeys) {
    const found = source[key];
    if (typeof found === "string" && found.trim()) return found.trim();
  }

  for (const child of Object.values(source)) {
    const found = findSecretInObject(child, seen);
    if (found) return found;
  }

  return undefined;
}

function findBaseUrlInObject(value: unknown, seen = new Set<object>()): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

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
  options: { providerConfig?: Map<string, ProviderRegistryEntry> } = {},
): Promise<Account[]> {
  const accounts: Account[] = [];

  for (const [name, body] of entriesFromAuthPayload(payload)) {
    const token = findSecretInObject(body);
    if (!token) continue;

    const detectedBaseUrl = findBaseUrlInObject(body);
    const configEntry = options.providerConfig?.get(sanitizeProviderId(name));
    const registry =
      configEntry ??
      (await resolveProviderRegistryEntry(name, {
        baseUrl: detectedBaseUrl,
      }));
    const providerId = sanitizeProviderId(registry.providerId || name);
    const id = `${providerId}-${sanitizeProviderId(name) || randomUUID().slice(0, 8)}`;
    const runtimeSupported = registry.runtimeSupported;
    const baseUrl =
      registry.providerAdapter === "openai-compatible"
        ? normalizeOpenAiCompatibleBaseUrl(detectedBaseUrl || registry.baseUrl)
        : normalizeBaseUrl(detectedBaseUrl || registry.baseUrl);

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

export function parseOpenCodeConfigPayload(source: string): unknown {
  return JSON.parse(stripJsonComments(substituteEnvVariables(source)));
}
