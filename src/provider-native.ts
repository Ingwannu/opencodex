import { createHash, createHmac, createSign, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Account } from "./types.js";
import {
  amazonBedrockBaseUrlFromOptions,
  vertexBaseUrlFromOptions,
} from "./provider-registry.js";

export type NativeProviderId =
  | "anthropic"
  | "google"
  | "cohere"
  | "gateway"
  | "amazon-bedrock"
  | "vertex"
  | "vertex-anthropic";
export type NativeProviderResponseShape = "chat.completions" | "responses";

export const AWS_BEDROCK_SIGV4_PLACEHOLDER = "__opencodex_aws_sigv4__";
export const GOOGLE_VERTEX_ADC_PLACEHOLDER = "__opencodex_google_vertex_adc__";

export type AwsBedrockCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export type ResolvedAwsBedrockCredentials = AwsBedrockCredentials & {
  region: string;
};

export type GoogleServiceAccountCredentials = {
  kind: "service_account";
  projectId?: string;
  clientEmail: string;
  privateKey: string;
  privateKeyId?: string;
  tokenUri: string;
};

export type GoogleAuthorizedUserCredentials = {
  kind: "authorized_user";
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tokenUri: string;
  quotaProjectId?: string;
};

export type GoogleAuthCredentials =
  | GoogleServiceAccountCredentials
  | GoogleAuthorizedUserCredentials;

type NativeProviderRequest = {
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

type GitLabProviderKind = "anthropic" | "openai-chat" | "openai-responses";

type GitLabDirectAccessToken = {
  token: string;
  headers?: Record<string, string>;
  aiGatewayUrl?: string;
};

type GitLabProviderRequest = NativeProviderRequest & {
  baseUrl: string;
  kind: GitLabProviderKind;
};

export type SapAiCoreServiceKey = {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  apiBaseUrl: string;
};

type SapAiCoreRequestOptions = {
  deploymentId?: unknown;
  deployment_id?: unknown;
  resourceGroup?: unknown;
  resource_group?: unknown;
  modelVersion?: unknown;
  model_version?: unknown;
  providerModels?: Record<string, unknown>;
};

type SapAiCoreProviderRequest = NativeProviderRequest & {
  baseUrl: string;
};

type NativeModelMetadata = {
  id: string;
  context_window: number | null;
  max_output_tokens: number | null;
};

const ANTHROPIC_VERSION =
  process.env.ANTHROPIC_VERSION ?? "2023-06-01";
const DEFAULT_GITLAB_AI_GATEWAY_URL = "https://cloud.gitlab.com";
const GATEWAY_PROTOCOL_VERSION = "0.0.1";

const GITLAB_MODEL_MAPPINGS: Record<
  string,
  { provider: GitLabProviderKind; model: string }
> = {
  "duo-chat-fable-5": { provider: "anthropic", model: "claude-fable-5" },
  "duo-chat-opus-4-8": { provider: "anthropic", model: "claude-opus-4-8" },
  "duo-chat-opus-4-7": { provider: "anthropic", model: "claude-opus-4-7" },
  "duo-chat-opus-4-6": { provider: "anthropic", model: "claude-opus-4-6" },
  "duo-chat-sonnet-4-6": { provider: "anthropic", model: "claude-sonnet-4-6" },
  "duo-chat-opus-4-5": {
    provider: "anthropic",
    model: "claude-opus-4-5-20251101",
  },
  "duo-chat-sonnet-4-5": {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
  },
  "duo-chat-haiku-4-5": {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
  },
  "duo-chat-gpt-5-1": {
    provider: "openai-chat",
    model: "gpt-5.1-2025-11-13",
  },
  "duo-chat-gpt-5-2": {
    provider: "openai-chat",
    model: "gpt-5.2-2025-12-11",
  },
  "duo-chat-gpt-5-4": {
    provider: "openai-chat",
    model: "gpt-5.4-2026-03-05",
  },
  "duo-chat-gpt-5-5": {
    provider: "openai-chat",
    model: "gpt-5.5-2026-04-23",
  },
  "duo-chat-gpt-5-mini": {
    provider: "openai-chat",
    model: "gpt-5-mini-2025-08-07",
  },
  "duo-chat-gpt-5-4-mini": {
    provider: "openai-chat",
    model: "gpt-5.4-mini",
  },
  "duo-chat-gpt-5-4-nano": {
    provider: "openai-chat",
    model: "gpt-5.4-nano",
  },
  "duo-chat-gpt-5-codex": {
    provider: "openai-responses",
    model: "gpt-5-codex",
  },
  "duo-chat-gpt-5-2-codex": {
    provider: "openai-responses",
    model: "gpt-5.2-codex",
  },
  "duo-chat-gpt-5-3-codex": {
    provider: "openai-responses",
    model: "gpt-5.3-codex",
  },
};

export function isNativeProvider(provider: string): provider is NativeProviderId {
  return (
    provider === "anthropic" ||
    provider === "google" ||
    provider === "cohere" ||
    provider === "gateway" ||
    provider === "amazon-bedrock" ||
    provider === "vertex" ||
    provider === "vertex-anthropic"
  );
}

export function nativeProviderDefaultBaseUrl(
  provider: NativeProviderId,
): string {
  if (provider === "anthropic") return "https://api.anthropic.com";
  if (provider === "cohere") return "https://api.cohere.com";
  if (provider === "gateway") return "https://ai-gateway.vercel.sh/v3/ai";
  if (provider === "amazon-bedrock") {
    return amazonBedrockBaseUrlFromOptions() ?? "https://bedrock-runtime.us-east-1.amazonaws.com";
  }
  if (provider === "vertex" || provider === "vertex-anthropic") {
    return vertexBaseUrlFromOptions() ?? "https://aiplatform.googleapis.com";
  }
  return "https://generativelanguage.googleapis.com";
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const p = part as Record<string, unknown>;
          if (typeof p.text === "string") return p.text;
          if (typeof p.content === "string") return p.content;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return String(content ?? "");
}

function coerceJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {}
  }
  return {};
}

const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CLOUD_PLATFORM_SCOPE =
  "https://www.googleapis.com/auth/cloud-platform";

function googleCredentialsSource(value: unknown): Record<string, unknown> {
  const root = coerceJsonObject(value);
  const nested = root.credentials;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return root;
}

export function parseGoogleAuthCredentials(
  value: unknown,
): GoogleAuthCredentials | undefined {
  const source = googleCredentialsSource(value);
  const type = typeof source.type === "string" ? source.type.trim() : "";

  if (type === "service_account") {
    const clientEmail =
      typeof source.client_email === "string" ? source.client_email.trim() : "";
    const privateKey =
      typeof source.private_key === "string" ? source.private_key.trim() : "";
    if (!clientEmail || !privateKey) return undefined;
    const projectId =
      typeof source.project_id === "string" && source.project_id.trim()
        ? source.project_id.trim()
        : undefined;
    const privateKeyId =
      typeof source.private_key_id === "string" && source.private_key_id.trim()
        ? source.private_key_id.trim()
        : undefined;
    const tokenUri =
      typeof source.token_uri === "string" && source.token_uri.trim()
        ? source.token_uri.trim()
        : GOOGLE_OAUTH_TOKEN_URL;
    return {
      kind: "service_account",
      ...(projectId ? { projectId } : {}),
      clientEmail,
      privateKey,
      ...(privateKeyId ? { privateKeyId } : {}),
      tokenUri,
    };
  }

  if (type === "authorized_user") {
    const clientId =
      typeof source.client_id === "string" ? source.client_id.trim() : "";
    const clientSecret =
      typeof source.client_secret === "string" ? source.client_secret.trim() : "";
    const refreshToken =
      typeof source.refresh_token === "string" ? source.refresh_token.trim() : "";
    if (!clientId || !clientSecret || !refreshToken) return undefined;
    const tokenUri =
      typeof source.token_uri === "string" && source.token_uri.trim()
        ? source.token_uri.trim()
        : GOOGLE_OAUTH_TOKEN_URL;
    const quotaProjectId =
      typeof source.quota_project_id === "string" &&
      source.quota_project_id.trim()
        ? source.quota_project_id.trim()
        : undefined;
    return {
      kind: "authorized_user",
      clientId,
      clientSecret,
      refreshToken,
      tokenUri,
      ...(quotaProjectId ? { quotaProjectId } : {}),
    };
  }

  return undefined;
}

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function buildGoogleServiceAccountJwt(
  credentials: GoogleServiceAccountCredentials,
  now = new Date(),
  scope = GOOGLE_CLOUD_PLATFORM_SCOPE,
): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header: Record<string, unknown> = {
    alg: "RS256",
    typ: "JWT",
  };
  if (credentials.privateKeyId) header.kid = credentials.privateKeyId;
  const claims = {
    iss: credentials.clientEmail,
    scope,
    aud: credentials.tokenUri,
    iat: issuedAt,
    exp: issuedAt + 3600,
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(claims)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(credentials.privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

export function buildGoogleOAuthTokenRequest(
  credentials: GoogleAuthCredentials | undefined,
  now = new Date(),
): {
  url: string;
  headers: Record<string, string>;
  body: string;
} {
  if (!credentials) {
    throw new Error("Google ADC credentials were not found");
  }

  const body = new URLSearchParams();
  if (credentials.kind === "service_account") {
    body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
    body.set("assertion", buildGoogleServiceAccountJwt(credentials, now));
  } else {
    body.set("grant_type", "refresh_token");
    body.set("client_id", credentials.clientId);
    body.set("client_secret", credentials.clientSecret);
    body.set("refresh_token", credentials.refreshToken);
  }

  return {
    url: credentials.tokenUri,
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  };
}

function googleAuthCredentialsFromFile(path: string): GoogleAuthCredentials | undefined {
  try {
    return parseGoogleAuthCredentials(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

export function resolveGoogleAuthCredentials(
  options: unknown = {},
  env: Record<string, string | undefined> = process.env,
): GoogleAuthCredentials | undefined {
  const optionCredentials = [
    firstStringFromUnknown(options, ["googleAuthCredentialsJson"]),
    firstStringFromUnknown(options, ["credentialsJson", "credentials_json"]),
  ];
  for (const raw of optionCredentials) {
    const parsed = parseGoogleAuthCredentials(raw);
    if (parsed) return parsed;
  }

  if (options && typeof options === "object" && !Array.isArray(options)) {
    const source = options as Record<string, unknown>;
    for (const key of [
      "googleAuthCredentials",
      "authCredentials",
      "credentials",
      "serviceAccount",
      "service_account",
      "adcCredentials",
      "adc_credentials",
    ]) {
      const parsed = parseGoogleAuthCredentials(source[key]);
      if (parsed) return parsed;
    }
  }

  const credentialsFile =
    firstStringFromUnknown(options, [
      "credentialsFile",
      "credentials_file",
      "keyFile",
      "keyfile",
      "keyFilename",
      "key_filename",
      "googleApplicationCredentials",
      "google_application_credentials",
      "credentials",
    ]) ?? env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialsFile?.trim()) {
    const parsed = googleAuthCredentialsFromFile(credentialsFile.trim());
    if (parsed) return parsed;
  }

  return googleAuthCredentialsFromFile(
    join(homedir(), ".config", "gcloud", "application_default_credentials.json"),
  );
}

function outputLimit(payload: Record<string, unknown>): number {
  const raw =
    payload.max_tokens ??
    payload.max_completion_tokens ??
    payload.max_output_tokens;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 4096;
}

function optionalOutputLimit(payload: Record<string, unknown>): number | undefined {
  const raw =
    payload.max_tokens ??
    payload.max_completion_tokens ??
    payload.max_output_tokens;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function finishReasonFromAnthropic(reason: unknown): string {
  if (reason === "end_turn") return "stop";
  if (reason === "max_tokens") return "length";
  if (reason === "tool_use") return "tool_calls";
  return typeof reason === "string" && reason ? reason : "stop";
}

function finishReasonFromGoogle(reason: unknown): string {
  if (reason === "MAX_TOKENS") return "length";
  if (reason === "STOP") return "stop";
  if (reason === "SAFETY") return "content_filter";
  return typeof reason === "string" && reason ? String(reason).toLowerCase() : "stop";
}

function finishReasonFromCohere(reason: unknown): string {
  const normalized = String(reason ?? "").toLowerCase();
  if (normalized === "complete") return "stop";
  if (normalized === "max_tokens") return "length";
  if (normalized === "tool_call") return "tool_calls";
  if (normalized === "stop_sequence") return "stop";
  return normalized || "stop";
}

function finishReasonFromBedrock(reason: unknown): string {
  if (reason === "end_turn" || reason === "stop_sequence") return "stop";
  if (reason === "max_tokens") return "length";
  if (reason === "tool_use") return "tool_calls";
  return typeof reason === "string" && reason ? reason : "stop";
}

function usageFromAnthropic(usage: unknown) {
  const u = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : {};
  const prompt = Number(u.input_tokens ?? 0) || 0;
  const completion = Number(u.output_tokens ?? 0) || 0;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  };
}

function usageFromGoogle(usage: unknown) {
  const u = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : {};
  const prompt = Number(u.promptTokenCount ?? u.prompt_tokens ?? 0) || 0;
  const completion =
    Number(u.candidatesTokenCount ?? u.completion_tokens ?? 0) || 0;
  const total = Number(u.totalTokenCount ?? prompt + completion) || prompt + completion;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  };
}

function usageFromCohere(usage: unknown) {
  const u = usage && typeof usage === "object" ? (usage as Record<string, any>) : {};
  const tokens = u.tokens && typeof u.tokens === "object" ? u.tokens : {};
  const billed = u.billed_units && typeof u.billed_units === "object" ? u.billed_units : {};
  const prompt = Number(tokens.input_tokens ?? billed.input_tokens ?? 0) || 0;
  const completion = Number(tokens.output_tokens ?? billed.output_tokens ?? 0) || 0;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  };
}

function usageFromBedrock(usage: unknown) {
  const u = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : {};
  const prompt = Number(u.inputTokens ?? u.input_tokens ?? 0) || 0;
  const completion = Number(u.outputTokens ?? u.output_tokens ?? 0) || 0;
  const total = Number(u.totalTokens ?? u.total_tokens ?? prompt + completion) || prompt + completion;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  };
}

function responseUsageFromChatUsage(usage: {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}) {
  return {
    input_tokens: usage.prompt_tokens,
    output_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
  };
}

function anthropicContentParts(content: unknown) {
  const text = textFromContent(content);
  return text ? [{ type: "text", text }] : [];
}

function scrubAnthropicToolId(id: unknown): string {
  return String(id ?? randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildAnthropicPayload(payload: Record<string, unknown>) {
  const messages = Array.isArray(payload.messages)
    ? (payload.messages as Array<Record<string, unknown>>)
    : [];
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => textFromContent(message.content))
    .filter(Boolean)
    .join("\n\n");

  const outMessages: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      outMessages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: scrubAnthropicToolId(message.tool_call_id),
            content: textFromContent(message.content),
          },
        ],
      });
      continue;
    }
    if (message.role === "assistant") {
      const content = anthropicContentParts(message.content);
      const toolCalls = Array.isArray(message.tool_calls)
        ? message.tool_calls
        : [];
      for (const toolCall of toolCalls) {
        const tc = toolCall as Record<string, any>;
        content.push({
          type: "tool_use",
          id: scrubAnthropicToolId(tc.id),
          name: String(tc.function?.name ?? "unknown"),
          input: coerceJsonObject(tc.function?.arguments),
        } as any);
      }
      if (!content.length) continue;
      outMessages.push({ role: "assistant", content });
      continue;
    }
    const content = anthropicContentParts(message.content);
    if (!content.length) continue;
    outMessages.push({ role: "user", content });
  }

  const body: Record<string, unknown> = {
    model: payload.model,
    max_tokens: outputLimit(payload),
    messages: outMessages.length
      ? outMessages
      : [{ role: "user", content: [{ type: "text", text: " " }] }],
    stream: false,
  };
  if (system) body.system = system;
  if (typeof payload.temperature === "number") body.temperature = payload.temperature;
  if (
    payload.thinking &&
    typeof payload.thinking === "object" &&
    !Array.isArray(payload.thinking)
  ) {
    body.thinking = payload.thinking;
  }
  if (Array.isArray(payload.tools)) {
    body.tools = payload.tools
      .map((tool: any) => {
        const fn = tool?.function ?? tool;
        if (!fn?.name) return null;
        return {
          name: fn.name,
          description: fn.description,
          input_schema: fn.parameters ?? fn.input_schema ?? { type: "object" },
        };
      })
      .filter(Boolean);
  }
  return body;
}

function googlePartFromContent(content: unknown) {
  const text = textFromContent(content);
  return text ? [{ text }] : [{ text: " " }];
}

function googleTools(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.tools)) return undefined;
  const functionDeclarations: Array<Record<string, unknown>> = payload.tools
    .map((tool: any) => {
      const fn = tool?.function ?? tool;
      if (!fn?.name) return undefined;
      return {
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters ?? fn.input_schema ?? { type: "object" },
      };
    })
    .filter((tool): tool is { name: unknown; description: unknown; parameters: unknown } => Boolean(tool));
  return functionDeclarations.length ? [{ functionDeclarations }] : undefined;
}

function googleToolConfig(payload: Record<string, unknown>) {
  if (payload.tool_choice === "required") {
    return { functionCallingConfig: { mode: "ANY" } };
  }
  if (payload.tool_choice === "none") {
    return { functionCallingConfig: { mode: "NONE" } };
  }
  return undefined;
}

function buildGooglePayload(payload: Record<string, unknown>) {
  const messages = Array.isArray(payload.messages)
    ? (payload.messages as Array<Record<string, unknown>>)
    : [];
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => textFromContent(message.content))
    .filter(Boolean)
    .join("\n\n");
  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: googlePartFromContent(message.content),
    }));
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: outputLimit(payload),
  };
  if (typeof payload.temperature === "number") {
    generationConfig.temperature = payload.temperature;
  }
  if (
    payload.thinkingConfig &&
    typeof payload.thinkingConfig === "object" &&
    !Array.isArray(payload.thinkingConfig)
  ) {
    generationConfig.thinkingConfig = payload.thinkingConfig;
  }

  const body: Record<string, unknown> = {
    contents: contents.length ? contents : [{ role: "user", parts: [{ text: " " }] }],
    generationConfig,
  };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }
  const tools = googleTools(payload);
  if (tools) body.tools = tools;
  const toolConfig = googleToolConfig(payload);
  if (toolConfig) body.toolConfig = toolConfig;
  return body;
}

function vertexModelPath(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return "/publishers/google/models/unknown:generateContent";
  if (trimmed.startsWith("projects/") || trimmed.startsWith("publishers/")) {
    return `/${trimmed}:generateContent`;
  }
  return `/publishers/google/models/${encodeURIComponent(trimmed)}:generateContent`;
}

function vertexAnthropicModelPath(model: string): string {
  const trimmed = model.trim();
  const modelId = trimmed || "unknown";
  return `/publishers/anthropic/models/${encodeURIComponent(modelId)}:rawPredict`;
}

function buildVertexAnthropicPayload(payload: Record<string, unknown>) {
  const body = buildAnthropicPayload(payload);
  delete body.model;
  body.anthropic_version = "vertex-2023-10-16";
  return body;
}

function gitLabAiGatewayBaseUrl(token: GitLabDirectAccessToken): string {
  return String(
    token.aiGatewayUrl ??
      process.env.GITLAB_AI_GATEWAY_URL ??
      DEFAULT_GITLAB_AI_GATEWAY_URL,
  ).replace(/\/+$/, "");
}

function gitLabModelTarget(model: unknown): { provider: GitLabProviderKind; model: string } {
  const modelId = String(model ?? "").trim();
  const mapped = GITLAB_MODEL_MAPPINGS[modelId];
  if (mapped) return mapped;
  if (modelId.startsWith("duo-chat-gpt-")) {
    return { provider: "openai-chat", model: modelId.replace(/^duo-chat-/, "") };
  }
  return { provider: "anthropic", model: "claude-sonnet-4-5-20250929" };
}

export function gitLabProviderKindForModel(model: unknown): GitLabProviderKind {
  return gitLabModelTarget(model).provider;
}

function directAccessHeaders(token: GitLabDirectAccessToken): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(token.headers ?? {})) {
    if (key.toLowerCase() === "x-api-key") continue;
    headers[key] = value;
  }
  return headers;
}

function buildGitLabOpenAiPayload(
  payload: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...payload, model, stream: false };
  if (body.max_completion_tokens === undefined) {
    const maxTokens = optionalOutputLimit(payload);
    if (maxTokens !== undefined) body.max_completion_tokens = maxTokens;
  }
  delete body.max_tokens;
  delete body.max_output_tokens;
  return body;
}

function nestedObject(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = source[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringFromKeys(
  source: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function firstStringFromUnknown(
  source: unknown,
  keys: string[],
): string | undefined {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return undefined;
  }
  return stringFromKeys(source as Record<string, unknown>, keys);
}

function awsBedrockRegionFromUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const host = new URL(value).hostname;
    const match = /^bedrock-runtime[.-]([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?$/i.exec(host);
    return match?.[1];
  } catch {
    return undefined;
  }
  return undefined;
}

function awsBedrockRegion(
  options: unknown,
  env: Record<string, string | undefined>,
): string | undefined {
  return (
    firstStringFromUnknown(options, ["region", "awsRegion", "aws_region"]) ??
    env.AWS_REGION ??
    env.AWS_DEFAULT_REGION ??
    awsBedrockRegionFromUrl(
      firstStringFromUnknown(options, [
        "baseURL",
        "baseUrl",
        "base_url",
        "url",
        "endpoint",
      ]),
    )
  )?.trim();
}

function awsBedrockProfile(
  options: unknown,
  env: Record<string, string | undefined>,
): string {
  return (
    firstStringFromUnknown(options, ["profile", "awsProfile", "aws_profile"]) ??
    env.AWS_PROFILE ??
    env.AWS_DEFAULT_PROFILE ??
    "default"
  ).trim();
}

export function parseAwsCredentialsFile(
  source: string,
  profile = "default",
): AwsBedrockCredentials | undefined {
  const target = profile.trim() || "default";
  const sections = new Map<string, Record<string, string>>();
  let current: Record<string, string> | undefined;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      const sectionName = (sectionMatch[1] ?? "")
        .trim()
        .replace(/^profile\s+/i, "");
      current = {};
      sections.set(sectionName, current);
      continue;
    }
    if (!current) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    current[key] = value;
  }

  const section = sections.get(target);
  if (!section) return undefined;
  const accessKeyId = section.aws_access_key_id;
  const secretAccessKey = section.aws_secret_access_key;
  if (!accessKeyId || !secretAccessKey) return undefined;
  return {
    accessKeyId,
    secretAccessKey,
    ...(section.aws_session_token
      ? { sessionToken: section.aws_session_token }
      : {}),
  };
}

function awsSharedCredentialsFile(
  options: unknown,
  env: Record<string, string | undefined>,
): string {
  return (
    firstStringFromUnknown(options, [
      "credentialsFile",
      "credentials_file",
      "sharedCredentialsFile",
      "shared_credentials_file",
    ]) ??
    env.AWS_SHARED_CREDENTIALS_FILE ??
    join(homedir(), ".aws", "credentials")
  );
}

export function resolveAwsBedrockCredentials(
  options: unknown = {},
  env: Record<string, string | undefined> = process.env,
): ResolvedAwsBedrockCredentials | undefined {
  const region = awsBedrockRegion(options, env);
  if (!region) return undefined;

  if (env.AWS_ACCESS_KEY_ID?.trim() && env.AWS_SECRET_ACCESS_KEY?.trim()) {
    return {
      accessKeyId: env.AWS_ACCESS_KEY_ID.trim(),
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY.trim(),
      ...(env.AWS_SESSION_TOKEN?.trim()
        ? { sessionToken: env.AWS_SESSION_TOKEN.trim() }
        : {}),
      region,
    };
  }

  try {
    const profile = awsBedrockProfile(options, env);
    const parsed = parseAwsCredentialsFile(
      readFileSync(awsSharedCredentialsFile(options, env), "utf8"),
      profile,
    );
    if (!parsed) return undefined;
    return { ...parsed, region };
  } catch {
    return undefined;
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function hmacHex(key: Buffer | string, value: string): string {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

function awsDateParts(now: Date): { shortDate: string; longDate: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    shortDate: iso.slice(0, 8),
    longDate: iso,
  };
}

function awsUriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalQuery(searchParams: URLSearchParams): string {
  return [...searchParams.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey
        ? leftValue.localeCompare(rightValue)
        : leftKey.localeCompare(rightKey),
    )
    .map(([key, value]) => `${awsUriEncode(key)}=${awsUriEncode(value)}`)
    .join("&");
}

function canonicalHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function buildAwsSigV4Headers(input: {
  method: string;
  url: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  credentials: ResolvedAwsBedrockCredentials;
  service?: string;
  now?: Date;
}): Record<string, string> {
  const url = new URL(input.url);
  const now = input.now ?? new Date();
  const { shortDate, longDate } = awsDateParts(now);
  const body = input.body ?? "";
  const payloadHash = sha256Hex(body);
  const service = input.service ?? "bedrock";

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    if (value === undefined) continue;
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === "authorization") continue;
    headers[normalizedKey] = canonicalHeaderValue(value);
  }
  headers.host = url.host;
  headers["x-amz-content-sha256"] = payloadHash;
  headers["x-amz-date"] = longDate;
  if (input.credentials.sessionToken) {
    headers["x-amz-security-token"] = input.credentials.sessionToken;
  }

  const signedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderKeys
    .map((key) => `${key}:${headers[key]}`)
    .join("\n");
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalRequest = [
    input.method.toUpperCase(),
    url.pathname || "/",
    canonicalQuery(url.searchParams),
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${shortDate}/${input.credentials.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    longDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const dateKey = hmac(`AWS4${input.credentials.secretAccessKey}`, shortDate);
  const regionKey = hmac(dateKey, input.credentials.region);
  const serviceKey = hmac(regionKey, service);
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = hmacHex(signingKey, stringToSign);

  const out = { ...headers };
  delete out.host;
  out.authorization =
    `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return out;
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return undefined;
}

function normalizeSapAiCoreBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  const parsed = new URL(trimmed);
  if (parsed.pathname === "" || parsed.pathname === "/") {
    return `${trimmed}/v2`;
  }
  return trimmed;
}

function normalizeSapTokenUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return /\/oauth\/token$/i.test(trimmed) ? trimmed : `${trimmed}/oauth/token`;
}

function sapCredentialsObject(value: unknown): Record<string, unknown> {
  const root =
    typeof value === "string"
      ? parseJsonObject(value)
      : value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
  if (!root) throw new Error("SAP AI Core service key must be a JSON object");
  return nestedObject(root, "credentials") ?? root;
}

export function parseSapAiCoreServiceKey(value: unknown): SapAiCoreServiceKey {
  const credentials = sapCredentialsObject(value);
  const serviceUrls = nestedObject(credentials, "serviceurls") ?? {};

  const clientId = stringFromKeys(credentials, ["clientid", "clientId"]);
  const clientSecret = stringFromKeys(credentials, [
    "clientsecret",
    "clientSecret",
  ]);
  const tokenUrl = stringFromKeys(credentials, [
    "tokenurl",
    "tokenUrl",
    "uaaUrl",
    "url",
  ]);
  const apiBaseUrl =
    stringFromKeys(serviceUrls, [
      "AI_API_URL",
      "AI_API_URL_V2",
      "ai_api_url",
      "apiUrl",
    ]) ??
    stringFromKeys(credentials, ["aiApiUrl", "ai_api_url", "apiUrl"]);

  if (!clientId || !clientSecret || !tokenUrl || !apiBaseUrl) {
    throw new Error(
      "SAP AI Core service key requires clientid, clientsecret, url/tokenurl, and serviceurls.AI_API_URL",
    );
  }

  return {
    clientId,
    clientSecret,
    tokenUrl: normalizeSapTokenUrl(tokenUrl),
    apiBaseUrl: normalizeSapAiCoreBaseUrl(apiBaseUrl),
  };
}

export function buildSapAiCoreTokenRequest(
  serviceKey: SapAiCoreServiceKey,
): {
  url: string;
  headers: Record<string, string>;
  body: string;
} {
  return {
    url: serviceKey.tokenUrl,
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(
        `${serviceKey.clientId}:${serviceKey.clientSecret}`,
      ).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
  };
}

function sapOptionString(
  options: SapAiCoreRequestOptions | undefined,
  keys: string[],
): string | undefined {
  if (!options) return undefined;
  for (const key of keys) {
    const value = options[key as keyof SapAiCoreRequestOptions];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function sapModelMetadata(
  options: SapAiCoreRequestOptions | undefined,
  model: string,
): Record<string, unknown> | undefined {
  const models = options?.providerModels;
  const value = models?.[model];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sapDeploymentId(
  payload: Record<string, unknown>,
  options: SapAiCoreRequestOptions | undefined,
): string | undefined {
  const model = String(payload.model ?? "").trim();
  const metadata = model ? sapModelMetadata(options, model) : undefined;
  return (
    sapOptionString(options, ["deploymentId", "deployment_id"]) ??
    (metadata
      ? stringFromKeys(metadata, ["deploymentId", "deployment_id"])
      : undefined)
  );
}

export function sapAiCoreResourceGroup(
  options: SapAiCoreRequestOptions | undefined,
): string {
  return sapOptionString(options, ["resourceGroup", "resource_group"]) ?? "default";
}

function sapModelVersion(
  payload: Record<string, unknown>,
  options: SapAiCoreRequestOptions | undefined,
): string | undefined {
  const model = String(payload.model ?? "").trim();
  const metadata = model ? sapModelMetadata(options, model) : undefined;
  return (
    sapOptionString(options, ["modelVersion", "model_version"]) ??
    (metadata ? stringFromKeys(metadata, ["modelVersion", "model_version"]) : undefined)
  );
}

function sapMessages(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const messages = Array.isArray(payload.messages)
    ? (payload.messages as Array<Record<string, unknown>>)
    : [];
  return messages.length
    ? messages.map((message) => ({
        role:
          message.role === "assistant" ||
          message.role === "system" ||
          message.role === "tool"
            ? message.role
            : "user",
        content: textFromContent(message.content) || " ",
      }))
    : [{ role: "user", content: " " }];
}

function sapModelParams(payload: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> =
    payload.modelParams && typeof payload.modelParams === "object" && !Array.isArray(payload.modelParams)
      ? { ...(payload.modelParams as Record<string, unknown>) }
      : {};
  const maxTokens = optionalOutputLimit(payload);
  if (maxTokens !== undefined) params.max_tokens = maxTokens;
  if (typeof payload.temperature === "number") params.temperature = payload.temperature;
  if (typeof payload.top_p === "number") params.top_p = payload.top_p;
  if (typeof payload.frequency_penalty === "number") {
    params.frequency_penalty = payload.frequency_penalty;
  }
  if (typeof payload.presence_penalty === "number") {
    params.presence_penalty = payload.presence_penalty;
  }
  if (Array.isArray(payload.stop)) params.stop = payload.stop;
  return params;
}

function sapTools(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.tools)) return undefined;
  const tools = payload.tools
    .map((tool: any) => {
      const fn = tool?.function ?? tool;
      if (!fn?.name) return null;
      return {
        type: "function",
        function: {
          name: fn.name,
          description: fn.description,
          parameters: fn.parameters ?? fn.input_schema ?? { type: "object" },
        },
      };
    })
    .filter(Boolean);
  return tools.length ? tools : undefined;
}

export function buildSapAiCoreProviderRequest(
  serviceKey: SapAiCoreServiceKey,
  account: Pick<Account, "accessToken">,
  payload: Record<string, unknown>,
  options: SapAiCoreRequestOptions = {},
): SapAiCoreProviderRequest {
  const deploymentId = sapDeploymentId(payload, options);
  if (!deploymentId) {
    throw new Error("SAP AI Core deploymentId is required");
  }

  const resourceGroup = sapAiCoreResourceGroup(options);
  const modelName = String(payload.model ?? "").trim() || "unknown";
  const model: Record<string, unknown> = {
    name: modelName,
  };
  const params = sapModelParams(payload);
  if (Object.keys(params).length) model.params = params;
  const version = sapModelVersion(payload, options);
  if (version) model.version = version;

  const prompt: Record<string, unknown> = {
    template: sapMessages(payload),
  };
  const tools = sapTools(payload);
  if (tools) prompt.tools = tools;
  if (payload.response_format) prompt.response_format = payload.response_format;

  return {
    baseUrl: serviceKey.apiBaseUrl,
    path: `/inference/deployments/${encodeURIComponent(deploymentId)}/v2/completion`,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${account.accessToken}`,
      "ai-resource-group": resourceGroup,
      "ai-client-type": "OpenCodex",
    },
    body: {
      config: {
        modules: {
          prompt_templating: {
            model,
            prompt,
          },
        },
      },
    },
  };
}

export function buildSapAiCoreDeploymentResolutionRequest(
  serviceKey: SapAiCoreServiceKey,
  account: Pick<Account, "accessToken">,
  options: SapAiCoreRequestOptions = {},
): SapAiCoreProviderRequest {
  const resourceGroup = sapAiCoreResourceGroup(options);
  return {
    baseUrl: serviceKey.apiBaseUrl,
    path: "/lm/deployments?scenarioId=orchestration&status=RUNNING",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${account.accessToken}`,
      "ai-resource-group": resourceGroup,
      "ai-client-type": "OpenCodex",
    },
    body: {},
  };
}

function sapDeploymentModelName(deployment: Record<string, unknown>): string | undefined {
  const details = nestedObject(deployment, "details");
  const resources = details ? nestedObject(details, "resources") : undefined;
  const backendDetails = resources ? nestedObject(resources, "backendDetails") : undefined;
  const model = backendDetails ? nestedObject(backendDetails, "model") : undefined;
  return model ? stringFromKeys(model, ["name", "modelName"]) : undefined;
}

export function resolveSapAiCoreDeploymentIdFromResponse(
  body: Record<string, unknown>,
  payload: Record<string, unknown>,
): string | undefined {
  const resources = Array.isArray(body.resources)
    ? (body.resources as Array<Record<string, unknown>>)
    : [];
  if (!resources.length) return undefined;
  const requestedModel = String(payload.model ?? "").trim();
  const matching = requestedModel
    ? resources.find((entry) => sapDeploymentModelName(entry) === requestedModel)
    : undefined;
  const selected = matching ?? resources[0];
  return stringFromKeys(selected, ["id", "deploymentId", "deployment_id"]);
}

export function buildGitLabDirectAccessRequest(
  account: Pick<Account, "accessToken">,
): NativeProviderRequest {
  return {
    path: "/api/v4/ai/third_party_agents/direct_access",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${account.accessToken}`,
    },
    body: {},
  };
}

export function buildGitLabProviderRequest(
  token: GitLabDirectAccessToken,
  payload: Record<string, unknown>,
  _stream: boolean,
): GitLabProviderRequest {
  const target = gitLabModelTarget(payload.model);
  const baseGateway = gitLabAiGatewayBaseUrl(token);
  const commonHeaders = {
    ...directAccessHeaders(token),
    "content-type": "application/json",
    accept: "application/json",
    authorization: `Bearer ${token.token}`,
  };

  if (target.provider === "anthropic") {
    return {
      kind: "anthropic",
      baseUrl: `${baseGateway}/ai/v1/proxy/anthropic`,
      path: "/v1/messages",
      headers: commonHeaders,
      body: buildAnthropicPayload({ ...payload, model: target.model }),
    };
  }

  return {
    kind: target.provider,
    baseUrl: `${baseGateway}/ai/v1/proxy/openai`,
    path:
      target.provider === "openai-responses"
        ? "/v1/responses"
        : "/v1/chat/completions",
    headers: commonHeaders,
    body: buildGitLabOpenAiPayload(payload, target.model),
  };
}

function buildCoherePayload(payload: Record<string, unknown>) {
  const messages = Array.isArray(payload.messages)
    ? (payload.messages as Array<Record<string, unknown>>)
    : [];
  const body: Record<string, unknown> = {
    model: payload.model,
    messages: messages.length
      ? messages.map((message) => ({
          role:
            message.role === "assistant" ||
            message.role === "system" ||
            message.role === "tool"
              ? message.role
              : "user",
          content: textFromContent(message.content),
        }))
      : [{ role: "user", content: " " }],
    stream: false,
  };
  const maxTokens = optionalOutputLimit(payload);
  if (maxTokens !== undefined) body.max_tokens = maxTokens;
  if (typeof payload.temperature === "number") body.temperature = payload.temperature;
  if (Array.isArray(payload.stop)) body.stop_sequences = payload.stop;
  if (Array.isArray(payload.tools)) {
    body.tools = payload.tools
      .map((tool: any) => {
        const fn = tool?.function ?? tool;
        if (!fn?.name) return null;
        return {
          type: "function",
          function: {
            name: fn.name,
            description: fn.description,
            parameters: fn.parameters ?? fn.input_schema ?? { type: "object" },
          },
        };
      })
      .filter(Boolean);
  }
  if (payload.tool_choice === "required") body.tool_choice = "REQUIRED";
  if (payload.tool_choice === "none") body.tool_choice = "NONE";
  return body;
}

function buildBedrockPayload(payload: Record<string, unknown>) {
  const messages = Array.isArray(payload.messages)
    ? (payload.messages as Array<Record<string, unknown>>)
    : [];
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => textFromContent(message.content))
    .filter(Boolean)
    .map((text) => ({ text }));
  const outMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      const text = textFromContent(message.content);
      if (!text) return undefined;
      return {
        role: message.role === "assistant" ? "assistant" : "user",
        content: [{ text }],
      };
    })
    .filter((message): message is { role: string; content: Array<{ text: string }> } => Boolean(message));
  const inferenceConfig: Record<string, unknown> = {};
  const maxTokens = optionalOutputLimit(payload);
  if (maxTokens !== undefined) inferenceConfig.maxTokens = maxTokens;
  if (typeof payload.temperature === "number") inferenceConfig.temperature = payload.temperature;
  if (Array.isArray(payload.stop)) inferenceConfig.stopSequences = payload.stop;

  const body: Record<string, unknown> = {
    messages: outMessages.length
      ? outMessages
      : [{ role: "user", content: [{ text: " " }] }],
  };
  if (system.length) body.system = system;
  if (Object.keys(inferenceConfig).length) body.inferenceConfig = inferenceConfig;
  if (
    payload.reasoningConfig &&
    typeof payload.reasoningConfig === "object" &&
    !Array.isArray(payload.reasoningConfig)
  ) {
    body.reasoningConfig = payload.reasoningConfig;
  }
  return body;
}

function gatewayContentParts(content: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (typeof part === "string") return { type: "text", text: part };
        if (part && typeof part === "object") {
          const p = part as Record<string, unknown>;
          if (typeof p.text === "string") {
            return { type: "text", text: p.text };
          }
          if (typeof p.content === "string") {
            return { type: "text", text: p.content };
          }
        }
        return undefined;
      })
      .filter((part): part is { type: string; text: string } => Boolean(part));
    if (parts.length) return parts;
  }
  const text = textFromContent(content);
  return [{ type: "text", text: text || " " }];
}

function gatewayPrompt(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const messages = Array.isArray(payload.messages)
    ? (payload.messages as Array<Record<string, unknown>>)
    : [];
  const prompt = messages
    .map((message) => {
      const role = String(message.role ?? "user");
      const normalizedRole =
        role === "system" ||
        role === "assistant" ||
        role === "tool"
          ? role
          : "user";
      return {
        role: normalizedRole,
        content: gatewayContentParts(message.content),
      };
    })
    .filter((message) => message.content.length > 0);
  return prompt.length
    ? prompt
    : [{ role: "user", content: [{ type: "text", text: " " }] }];
}

function gatewayTools(payload: Record<string, unknown>): Array<Record<string, unknown>> | undefined {
  const tools = Array.isArray(payload.tools)
    ? (payload.tools as Array<Record<string, unknown>>)
    : [];
  const out = tools
    .map((tool): Record<string, unknown> | undefined => {
      if (tool.type !== "function") return undefined;
      const fn = tool.function && typeof tool.function === "object"
        ? (tool.function as Record<string, unknown>)
        : {};
      const name = typeof fn.name === "string" ? fn.name.trim() : "";
      if (!name) return undefined;
      const out: Record<string, unknown> = {
        type: "function",
        name,
        inputSchema: fn.parameters ?? { type: "object" },
      };
      if (typeof fn.description === "string") out.description = fn.description;
      return out;
    })
    .filter((tool): tool is Record<string, unknown> => Boolean(tool));
  return out.length ? out : undefined;
}

function buildGatewayPayload(payload: Record<string, unknown>) {
  const body: Record<string, unknown> = {
    prompt: gatewayPrompt(payload),
  };
  const maxTokens = optionalOutputLimit(payload);
  if (maxTokens !== undefined) body.maxOutputTokens = maxTokens;
  if (typeof payload.temperature === "number") body.temperature = payload.temperature;
  if (typeof payload.top_p === "number") body.topP = payload.top_p;
  if (Array.isArray(payload.stop)) body.stopSequences = payload.stop;
  if (typeof payload.stop === "string") body.stopSequences = [payload.stop];
  const tools = gatewayTools(payload);
  if (tools) body.tools = tools;
  if (payload.tool_choice === "required") body.toolChoice = { type: "required" };
  if (payload.tool_choice === "none") body.toolChoice = { type: "none" };
  return body;
}

function gatewayHeaders(
  accessToken: string,
  model: string,
  streaming: boolean,
): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json",
    authorization: `Bearer ${accessToken}`,
    "ai-gateway-protocol-version": GATEWAY_PROTOCOL_VERSION,
    "ai-gateway-auth-method": "api-key",
    "ai-language-model-specification-version": "3",
    "ai-language-model-id": model,
    "ai-language-model-streaming": String(streaming),
  };
}

export function buildNativeProviderRequest(
  provider: NativeProviderId,
  account: Pick<Account, "accessToken">,
  payload: Record<string, unknown>,
  _stream: boolean,
): NativeProviderRequest {
  if (provider === "anthropic") {
    return {
      path: "/v1/messages",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-api-key": account.accessToken,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: buildAnthropicPayload(payload),
    };
  }

  if (provider === "cohere") {
    return {
      path: "/v2/chat",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${account.accessToken}`,
      },
      body: buildCoherePayload(payload),
    };
  }

  if (provider === "gateway") {
    const model = String(payload.model ?? "");
    return {
      path: "/language-model",
      headers: gatewayHeaders(account.accessToken, model, false),
      body: buildGatewayPayload(payload),
    };
  }

  if (provider === "amazon-bedrock") {
    const model = encodeURIComponent(String(payload.model ?? ""));
    return {
      path: `/model/${model}/converse`,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${account.accessToken}`,
      },
      body: buildBedrockPayload(payload),
    };
  }

  if (provider === "vertex") {
    return {
      path: vertexModelPath(String(payload.model ?? "")),
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${account.accessToken}`,
      },
      body: buildGooglePayload(payload),
    };
  }

  if (provider === "vertex-anthropic") {
    return {
      path: vertexAnthropicModelPath(String(payload.model ?? "")),
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${account.accessToken}`,
      },
      body: buildVertexAnthropicPayload(payload),
    };
  }

  const model = encodeURIComponent(String(payload.model ?? ""));
  const key = encodeURIComponent(account.accessToken);
  return {
    path: `/v1beta/models/${model}:generateContent?key=${key}`,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: buildGooglePayload(payload),
  };
}

export function buildNativeProviderModelsRequest(
  provider: NativeProviderId,
  account: Pick<Account, "accessToken">,
): { path: string; headers: Record<string, string> } {
  if (provider === "anthropic") {
    return {
      path: "/v1/models",
      headers: {
        accept: "application/json",
        "x-api-key": account.accessToken,
        "anthropic-version": ANTHROPIC_VERSION,
      },
    };
  }
  if (provider === "cohere") {
    return {
      path: "/v1/models?endpoint=chat&page_size=1000",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${account.accessToken}`,
      },
    };
  }
  if (provider === "gateway") {
    return {
      path: "/config",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${account.accessToken}`,
        "ai-gateway-protocol-version": GATEWAY_PROTOCOL_VERSION,
        "ai-gateway-auth-method": "api-key",
      },
    };
  }
  if (provider === "amazon-bedrock") {
    return {
      path: "/foundation-models",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${account.accessToken}`,
      },
    };
  }
  if (provider === "vertex") {
    return {
      path: "/publishers/google/models",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${account.accessToken}`,
      },
    };
  }
  if (provider === "vertex-anthropic") {
    return {
      path: "/publishers/anthropic/models",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${account.accessToken}`,
      },
    };
  }
  return {
    path: `/v1beta/models?key=${encodeURIComponent(account.accessToken)}`,
    headers: { accept: "application/json" },
  };
}

function anthropicText(message: Record<string, unknown>): string {
  return Array.isArray(message.content)
    ? message.content
        .map((part: any) => {
          if (part?.type === "text" && typeof part.text === "string") return part.text;
          return "";
        })
        .join("")
    : "";
}

function googleText(response: Record<string, unknown>): string {
  const candidates = Array.isArray(response.candidates)
    ? response.candidates as Array<Record<string, any>>
    : [];
  const first = candidates[0];
  const parts = Array.isArray(first?.content?.parts)
    ? first.content.parts
    : [];
  return parts
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .join("");
}

function googleFunctionCalls(
  response: Record<string, unknown>,
): Array<{ id: string; name: string; arguments: string }> {
  const candidates = Array.isArray(response.candidates)
    ? response.candidates as Array<Record<string, any>>
    : [];
  const first = candidates[0];
  const parts = Array.isArray(first?.content?.parts)
    ? first.content.parts
    : [];
  const calls: Array<{ id: string; name: string; arguments: string } | undefined> = parts
    .map((part: any, index: number) => {
      const call = part?.functionCall;
      if (!call || typeof call !== "object" || !call.name) return undefined;
      return {
        id: `call_${String(call.name).replace(/[^a-zA-Z0-9_-]/g, "_")}_${index}`,
        name: String(call.name),
        arguments: JSON.stringify(
          call.args && typeof call.args === "object" && !Array.isArray(call.args)
            ? call.args
            : {},
        ),
      };
    });
  return calls.filter(
    (call): call is { id: string; name: string; arguments: string } => Boolean(call),
  );
}

function cohereText(response: Record<string, unknown>): string {
  const message = response.message && typeof response.message === "object"
    ? (response.message as Record<string, unknown>)
    : {};
  if (typeof message.content === "string") return message.content;
  const content = Array.isArray(message.content)
    ? message.content as Array<Record<string, unknown>>
    : [];
  return content
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("");
}

function bedrockText(response: Record<string, unknown>): string {
  const output = response.output && typeof response.output === "object"
    ? (response.output as Record<string, unknown>)
    : {};
  const message = output.message && typeof output.message === "object"
    ? (output.message as Record<string, unknown>)
    : {};
  const content = Array.isArray(message.content)
    ? message.content as Array<Record<string, unknown>>
    : [];
  return content
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("");
}

function gatewayText(response: Record<string, unknown>): string {
  return textFromContent(response.content);
}

function chatCompletion(
  model: string,
  content: string,
  finishReason: string,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
) {
  return {
    id: `chatcmpl_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: finishReason,
      },
    ],
    usage,
  };
}

function responseObject(
  model: string,
  content: string,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
) {
  return {
    id: `resp_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model,
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: content }],
      },
    ],
    usage: responseUsageFromChatUsage(usage),
  };
}

function googleResponseObject(
  model: string,
  content: string,
  functionCalls: Array<{ id: string; name: string; arguments: string }>,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
) {
  if (!functionCalls.length) return responseObject(model, content, usage);
  return {
    id: `resp_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model,
    status: "completed",
    output: functionCalls.map((call) => ({
      type: "function_call",
      id: call.id,
      call_id: call.id,
      name: call.name,
      arguments: call.arguments,
    })),
    usage: responseUsageFromChatUsage(usage),
  };
}

function googleChatCompletion(
  model: string,
  content: string,
  finishReason: string,
  functionCalls: Array<{ id: string; name: string; arguments: string }>,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
) {
  if (!functionCalls.length) return chatCompletion(model, content, finishReason, usage);
  return {
    id: `chatcmpl_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content || null,
          tool_calls: functionCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          })),
        },
        finish_reason: "tool_calls",
      },
    ],
    usage,
  };
}

function usageFromChatCompletion(usage: unknown) {
  const u = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : {};
  const prompt = Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0;
  const completion = Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0;
  const total = Number(u.total_tokens ?? prompt + completion) || prompt + completion;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  };
}

function usageFromGateway(usage: unknown) {
  const u = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : {};
  const prompt = Number(u.inputTokens ?? u.input_tokens ?? u.prompt_tokens ?? 0) || 0;
  const completion =
    Number(u.outputTokens ?? u.output_tokens ?? u.completion_tokens ?? 0) || 0;
  const total = Number(u.totalTokens ?? u.total_tokens ?? prompt + completion) || prompt + completion;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  };
}

function sapResponseText(finalResult: Record<string, unknown>): string {
  const choices = Array.isArray(finalResult.choices)
    ? (finalResult.choices as Array<Record<string, any>>)
    : [];
  const message =
    choices[0]?.message && typeof choices[0].message === "object"
      ? (choices[0].message as Record<string, unknown>)
      : {};
  return textFromContent(message.content);
}

function sapFinishReason(finalResult: Record<string, unknown>): string {
  const choices = Array.isArray(finalResult.choices)
    ? (finalResult.choices as Array<Record<string, any>>)
    : [];
  const reason = choices[0]?.finish_reason;
  return typeof reason === "string" && reason ? reason : "stop";
}

export function convertSapAiCoreResponse(
  body: Record<string, unknown>,
  shape: NativeProviderResponseShape,
  fallbackModel = "unknown",
) {
  const finalResult =
    body.final_result && typeof body.final_result === "object"
      ? (body.final_result as Record<string, unknown>)
      : body;
  const model = String(finalResult.model ?? fallbackModel);
  const usage = usageFromChatCompletion(finalResult.usage);

  if (shape === "responses") {
    return responseObject(model, sapResponseText(finalResult), usage);
  }

  if (Array.isArray(finalResult.choices)) {
    return {
      id:
        typeof finalResult.id === "string" && finalResult.id
          ? finalResult.id
          : `chatcmpl_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      object: "chat.completion",
      created:
        typeof finalResult.created === "number"
          ? finalResult.created
          : Math.floor(Date.now() / 1000),
      model,
      choices: finalResult.choices,
      usage,
    };
  }

  return chatCompletion(model, sapResponseText(finalResult), sapFinishReason(finalResult), usage);
}

export function convertNativeProviderResponse(
  provider: NativeProviderId,
  body: Record<string, unknown>,
  shape: NativeProviderResponseShape,
  fallbackModel = "unknown",
) {
  const model =
    provider === "anthropic" || provider === "vertex-anthropic"
      ? String(body.model ?? fallbackModel)
      : fallbackModel;
  const content =
    provider === "anthropic" || provider === "vertex-anthropic"
      ? anthropicText(body)
      : provider === "cohere"
        ? cohereText(body)
        : provider === "gateway"
          ? gatewayText(body)
        : provider === "amazon-bedrock"
          ? bedrockText(body)
        : googleText(body);
  const finishReason =
    provider === "anthropic" || provider === "vertex-anthropic"
      ? finishReasonFromAnthropic(body.stop_reason)
      : provider === "cohere"
        ? finishReasonFromCohere(body.finish_reason)
        : provider === "gateway"
          ? String(body.finishReason ?? body.finish_reason ?? "stop")
        : provider === "amazon-bedrock"
          ? finishReasonFromBedrock(body.stopReason)
      : finishReasonFromGoogle(
          Array.isArray(body.candidates)
            ? (body.candidates[0] as any)?.finishReason
            : undefined,
        );
  const usage =
    provider === "anthropic" || provider === "vertex-anthropic"
      ? usageFromAnthropic(body.usage)
      : provider === "cohere"
        ? usageFromCohere(body.usage)
        : provider === "gateway"
          ? usageFromGateway(body.usage)
        : provider === "amazon-bedrock"
          ? usageFromBedrock(body.usage)
      : usageFromGoogle(body.usageMetadata);

  if (provider === "google" || provider === "vertex") {
    const functionCalls = googleFunctionCalls(body);
    if (shape === "responses") {
      return googleResponseObject(model, content, functionCalls, usage);
    }
    return googleChatCompletion(model, content, finishReason, functionCalls, usage);
  }
  if (shape === "responses") return responseObject(model, content, usage);
  return chatCompletion(model, content, finishReason, usage);
}

export function nativeProviderModelsFromResponse(
  provider: NativeProviderId,
  body: Record<string, unknown>,
): NativeModelMetadata[] {
  if (provider === "anthropic") {
    const data = Array.isArray(body.data)
      ? body.data as Array<Record<string, unknown>>
      : [];
    return data
      .map((entry) => ({
        id: String(entry.id ?? "").trim(),
        context_window: typeof entry.max_input_tokens === "number"
          ? entry.max_input_tokens
          : null,
        max_output_tokens: typeof entry.max_tokens === "number"
          ? entry.max_tokens
          : null,
      }))
      .filter((entry) => entry.id);
  }

  if (provider === "cohere") {
    const models = Array.isArray(body.models)
      ? body.models as Array<Record<string, unknown>>
      : [];
    return models
      .map((entry) => ({
        id: String(entry.name ?? entry.id ?? "").trim(),
        context_window: typeof entry.context_length === "number"
          ? entry.context_length
          : null,
        max_output_tokens: typeof entry.max_output_tokens === "number"
          ? entry.max_output_tokens
          : null,
      }))
      .filter((entry) => entry.id);
  }

  if (provider === "gateway") {
    const models = Array.isArray(body.models)
      ? body.models as Array<Record<string, unknown>>
      : [];
    return models
      .map((entry) => ({
        id: String(entry.id ?? "")
          .trim(),
        context_window: typeof entry.context_window === "number"
          ? entry.context_window
          : null,
        max_output_tokens: typeof entry.max_output_tokens === "number"
          ? entry.max_output_tokens
          : null,
      }))
      .filter((entry) => entry.id);
  }

  if (provider === "amazon-bedrock") {
    const models = Array.isArray(body.modelSummaries)
      ? body.modelSummaries as Array<Record<string, unknown>>
      : [];
    return models
      .map((entry) => ({
        id: String(entry.modelId ?? "").trim(),
        context_window: null,
        max_output_tokens: null,
      }))
      .filter((entry) => entry.id);
  }

  if (provider === "vertex" || provider === "vertex-anthropic") {
    const models = Array.isArray(body.publisherModels)
      ? body.publisherModels as Array<Record<string, unknown>>
      : Array.isArray(body.models)
        ? body.models as Array<Record<string, unknown>>
        : [];
    return models
      .map((entry) => ({
        id: String(entry.name ?? entry.id ?? "")
          .replace(/^projects\/[^/]+\/locations\/[^/]+\/publishers\/[^/]+\/models\//, "")
          .replace(/^publishers\/[^/]+\/models\//, "")
          .trim(),
        context_window: null,
        max_output_tokens: null,
      }))
      .filter((entry) => entry.id);
  }

  const models = Array.isArray(body.models)
    ? body.models as Array<Record<string, unknown>>
    : [];
  return models
    .map((entry) => ({
      id: String(entry.name ?? "")
        .replace(/^models\//, "")
        .trim(),
      context_window: typeof entry.inputTokenLimit === "number"
        ? entry.inputTokenLimit
        : null,
      max_output_tokens: typeof entry.outputTokenLimit === "number"
        ? entry.outputTokenLimit
        : null,
    }))
    .filter((entry) => entry.id);
}
