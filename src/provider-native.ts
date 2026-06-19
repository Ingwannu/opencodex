import { randomUUID } from "node:crypto";
import type { Account } from "./types.js";

export type NativeProviderId = "anthropic" | "google";
export type NativeProviderResponseShape = "chat.completions" | "responses";

type NativeProviderRequest = {
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

type NativeModelMetadata = {
  id: string;
  context_window: number | null;
  max_output_tokens: number | null;
};

const ANTHROPIC_VERSION =
  process.env.ANTHROPIC_VERSION ?? "2023-06-01";

export function isNativeProvider(provider: string): provider is NativeProviderId {
  return provider === "anthropic" || provider === "google";
}

export function nativeProviderDefaultBaseUrl(
  provider: NativeProviderId,
): string {
  if (provider === "anthropic") return "https://api.anthropic.com";
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

function outputLimit(payload: Record<string, unknown>): number {
  const raw =
    payload.max_tokens ??
    payload.max_completion_tokens ??
    payload.max_output_tokens;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 4096;
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
  return text ? [{ type: "text", text }] : [{ type: "text", text: " " }];
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
            tool_use_id: String(message.tool_call_id ?? randomUUID()),
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
          id: String(tc.id ?? randomUUID()),
          name: String(tc.function?.name ?? "unknown"),
          input: coerceJsonObject(tc.function?.arguments),
        } as any);
      }
      outMessages.push({ role: "assistant", content });
      continue;
    }
    outMessages.push({ role: "user", content: anthropicContentParts(message.content) });
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

  const body: Record<string, unknown> = {
    contents: contents.length ? contents : [{ role: "user", parts: [{ text: " " }] }],
    generationConfig,
  };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }
  return body;
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

export function convertNativeProviderResponse(
  provider: NativeProviderId,
  body: Record<string, unknown>,
  shape: NativeProviderResponseShape,
  fallbackModel = "unknown",
) {
  const model =
    provider === "anthropic"
      ? String(body.model ?? fallbackModel)
      : fallbackModel;
  const content =
    provider === "anthropic" ? anthropicText(body) : googleText(body);
  const finishReason =
    provider === "anthropic"
      ? finishReasonFromAnthropic(body.stop_reason)
      : finishReasonFromGoogle(
          Array.isArray(body.candidates)
            ? (body.candidates[0] as any)?.finishReason
            : undefined,
        );
  const usage =
    provider === "anthropic"
      ? usageFromAnthropic(body.usage)
      : usageFromGoogle(body.usageMetadata);

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
