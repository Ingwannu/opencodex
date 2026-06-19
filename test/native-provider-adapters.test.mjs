import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNativeProviderRequest,
  convertNativeProviderResponse,
  nativeProviderModelsFromResponse,
} from "../dist/provider-native.js";
import {
  accountsFromOpenCodeAuthPayload,
  parseOpenCodeConfigPayload,
  providerConfigFromOpenCodeConfigPayload,
  providerSecretsFromOpenCodeConfigPayload,
} from "../dist/opencode-auth.js";
import {
  resolveProviderRegistryEntry,
} from "../dist/provider-registry.js";

test("Anthropic adapter converts chat payloads and responses", () => {
  const request = buildNativeProviderRequest(
    "anthropic",
    { accessToken: "ant-key" },
    {
      model: "claude-sonnet-4-5",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            description: "Lookup data",
            parameters: { type: "object" },
          },
        },
      ],
      max_tokens: 64,
      stream: true,
    },
    false,
  );

  assert.equal(request.path, "/v1/messages");
  assert.equal(request.headers["x-api-key"], "ant-key");
  assert.equal(request.headers["anthropic-version"], "2023-06-01");
  assert.equal(request.body.system, "Be concise.");
  assert.equal(request.body.max_tokens, 64);
  assert.deepEqual(request.body.messages, [
    { role: "user", content: [{ type: "text", text: "Hello" }] },
  ]);
  assert.deepEqual(request.body.tools, [
    {
      name: "lookup",
      description: "Lookup data",
      input_schema: { type: "object" },
    },
  ]);
  assert.equal(request.body.stream, false);

  const converted = convertNativeProviderResponse(
    "anthropic",
    {
      id: "msg_1",
      model: "claude-sonnet-4-5",
      role: "assistant",
      content: [{ type: "text", text: "Hi there" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 3 },
    },
    "chat.completions",
  );

  assert.equal(converted.object, "chat.completion");
  assert.equal(converted.choices[0].message.content, "Hi there");
  assert.equal(converted.usage.prompt_tokens, 10);
  assert.equal(converted.usage.completion_tokens, 3);
});

test("Google adapter converts chat payloads, responses, and model lists", () => {
  const request = buildNativeProviderRequest(
    "google",
    { accessToken: "gem-key" },
    {
      model: "gemini-2.5-pro",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
      ],
      max_tokens: 64,
      temperature: 0.2,
      stream: true,
    },
    false,
  );

  assert.equal(
    request.path,
    "/v1beta/models/gemini-2.5-pro:generateContent?key=gem-key",
  );
  assert.equal(request.body.systemInstruction.parts[0].text, "Be concise.");
  assert.deepEqual(request.body.contents, [
    { role: "user", parts: [{ text: "Hello" }] },
  ]);
  assert.equal(request.body.generationConfig.maxOutputTokens, 64);
  assert.equal(request.body.generationConfig.temperature, 0.2);

  const converted = convertNativeProviderResponse(
    "google",
    {
      candidates: [
        {
          content: { role: "model", parts: [{ text: "Hi Gemini" }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 7,
        candidatesTokenCount: 2,
        totalTokenCount: 9,
      },
    },
    "responses",
    "gemini-2.5-pro",
  );

  assert.equal(converted.object, "response");
  assert.equal(converted.output[0].content[0].text, "Hi Gemini");
  assert.equal(converted.usage.total_tokens, 9);

  const models = nativeProviderModelsFromResponse("google", {
    models: [
      {
        name: "models/gemini-2.5-pro",
        inputTokenLimit: 100,
        outputTokenLimit: 10,
      },
    ],
  });
  assert.deepEqual(models, [
    {
      id: "gemini-2.5-pro",
      context_window: 100,
      max_output_tokens: 10,
    },
  ]);
});

test("Cohere adapter converts chat payloads, responses, and model lists", () => {
  const request = buildNativeProviderRequest(
    "cohere",
    { accessToken: "co-key" },
    {
      model: "command-a-03-2025",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
      ],
      max_tokens: 64,
      temperature: 0.2,
      stream: true,
    },
    false,
  );

  assert.equal(request.path, "/v2/chat");
  assert.equal(request.headers.authorization, "Bearer co-key");
  assert.equal(request.body.stream, false);
  assert.equal(request.body.max_tokens, 64);
  assert.deepEqual(request.body.messages, [
    { role: "system", content: "Be concise." },
    { role: "user", content: "Hello" },
  ]);

  const converted = convertNativeProviderResponse(
    "cohere",
    {
      id: "co_1",
      finish_reason: "COMPLETE",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hi Cohere" }],
      },
      usage: {
        tokens: { input_tokens: 5, output_tokens: 2 },
      },
    },
    "chat.completions",
    "command-a-03-2025",
  );

  assert.equal(converted.object, "chat.completion");
  assert.equal(converted.choices[0].message.content, "Hi Cohere");
  assert.equal(converted.usage.total_tokens, 7);

  const models = nativeProviderModelsFromResponse("cohere", {
    models: [
      {
        name: "command-a-03-2025",
        context_length: 256000,
      },
    ],
  });
  assert.deepEqual(models, [
    {
      id: "command-a-03-2025",
      context_window: 256000,
      max_output_tokens: null,
    },
  ]);
});

test("Amazon Bedrock adapter converts chat payloads and responses", () => {
  const request = buildNativeProviderRequest(
    "amazon-bedrock",
    { accessToken: "bedrock-key" },
    {
      model: "anthropic.claude-3-haiku-20240307-v1:0",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
      ],
      max_tokens: 64,
      temperature: 0.2,
      stream: true,
    },
    false,
  );

  assert.equal(
    request.path,
    "/model/anthropic.claude-3-haiku-20240307-v1%3A0/converse",
  );
  assert.equal(request.headers.authorization, "Bearer bedrock-key");
  assert.deepEqual(request.body.system, [{ text: "Be concise." }]);
  assert.deepEqual(request.body.messages, [
    { role: "user", content: [{ text: "Hello" }] },
  ]);
  assert.deepEqual(request.body.inferenceConfig, {
    maxTokens: 64,
    temperature: 0.2,
  });

  const converted = convertNativeProviderResponse(
    "amazon-bedrock",
    {
      output: {
        message: {
          role: "assistant",
          content: [{ text: "Hi Bedrock" }],
        },
      },
      stopReason: "end_turn",
      usage: {
        inputTokens: 5,
        outputTokens: 2,
        totalTokens: 7,
      },
    },
    "chat.completions",
    "anthropic.claude-3-haiku-20240307-v1:0",
  );

  assert.equal(converted.object, "chat.completion");
  assert.equal(converted.choices[0].message.content, "Hi Bedrock");
  assert.equal(converted.usage.total_tokens, 7);
});

test("OpenCode auth import enables native Anthropic, Google, Cohere, and Bedrock adapters", async () => {
  const previousRegion = process.env.AWS_REGION;
  process.env.AWS_REGION = "us-east-1";
  const accounts = await accountsFromOpenCodeAuthPayload({
    anthropic: { apiKey: "ant-key" },
    google: { apiKey: "gem-key" },
    cohere: { apiKey: "co-key" },
    "amazon-bedrock": { apiKey: "bedrock-key" },
  });
  if (previousRegion === undefined) delete process.env.AWS_REGION;
  else process.env.AWS_REGION = previousRegion;

  const byId = new Map(accounts.map((account) => [account.providerId, account]));

  assert.equal(byId.get("anthropic")?.providerAdapter, "anthropic");
  assert.equal(byId.get("anthropic")?.enabled, true);
  assert.equal(byId.get("google")?.providerAdapter, "google");
  assert.equal(byId.get("google")?.enabled, true);
  assert.equal(byId.get("cohere")?.providerAdapter, "cohere");
  assert.equal(byId.get("cohere")?.baseUrl, "https://api.cohere.com");
  assert.equal(byId.get("cohere")?.enabled, true);
  assert.equal(byId.get("amazon-bedrock")?.providerAdapter, "amazon-bedrock");
  assert.deepEqual(byId.get("amazon-bedrock")?.providerAuthEnv, [
    "AWS_BEARER_TOKEN_BEDROCK",
  ]);
  assert.equal(
    byId.get("amazon-bedrock")?.baseUrl,
    "https://bedrock-runtime.us-east-1.amazonaws.com",
  );
  assert.equal(byId.get("amazon-bedrock")?.enabled, true);
});

test("OpenAI-compatible SDK providers are runtime-routable through the bridge", async () => {
  const expected = new Map([
    ["xai", "https://api.x.ai"],
    ["groq", "https://api.groq.com/openai"],
    ["deepinfra", "https://api.deepinfra.com/v1/openai"],
    ["cerebras", "https://api.cerebras.ai"],
    ["togetherai", "https://api.together.ai"],
    ["perplexity", "https://api.perplexity.ai"],
    ["vercel", "https://ai-gateway.vercel.sh"],
    ["venice", "https://api.venice.ai/api"],
    ["aihubmix", "https://aihubmix.com"],
    ["merge-gateway", "https://api-gateway.merge.dev/v1/openai"],
    ["v0", "https://api.v0.dev"],
  ]);

  for (const [providerId, baseUrl] of expected) {
    const entry = await resolveProviderRegistryEntry(providerId);
    assert.equal(entry.providerAdapter, "openai-compatible", providerId);
    assert.equal(entry.provider, "openai-compatible", providerId);
    assert.equal(entry.runtimeSupported, true, providerId);
    assert.equal(entry.baseUrl, baseUrl, providerId);
    assert.equal(entry.compatibilityMode, "chat-completions-bridge", providerId);
  }

  const perplexity = await resolveProviderRegistryEntry("perplexity");
  assert.equal(perplexity.openAiPathPrefix, "none");
  assert.ok(perplexity.models?.["sonar-pro"]);
});

test("OpenCode auth import preserves configured model metadata", async () => {
  const config = new Map([
    [
      "haimaker",
      await resolveProviderRegistryEntry("haimaker", {
        baseUrl: "https://api.haimaker.ai/v1",
      }),
    ],
  ]);
  const custom = config.get("haimaker");
  custom.providerNpm = "@ai-sdk/openai-compatible";
  custom.providerAdapter = "openai-compatible";
  custom.provider = "openai-compatible";
  custom.runtimeSupported = true;
  custom.models = {
    "z-ai/glm-4.6": {
      id: "z-ai/glm-4.6",
      name: "GLM 4.6",
      limit: { context: 200000, output: 32000 },
      tool_call: true,
    },
  };

  const accounts = await accountsFromOpenCodeAuthPayload(
    {
      haimaker: { apiKey: "hm-key" },
    },
    { providerConfig: config },
  );

  assert.equal(accounts[0]?.providerId, "haimaker");
  assert.ok(accounts[0]?.providerModels?.["z-ai/glm-4.6"]);
});

test("OpenCode config secrets create accounts without auth.json entries", async () => {
  const payload = parseOpenCodeConfigPayload(`{
    "provider": {
      "fhgenie": {
        "npm": "@ai-sdk/openai-compatible",
        "name": "FhGenie",
        "options": {
          "baseURL": "https://fhgenie.example/v1",
          "apiKey": "fh-secret"
        },
        "models": {
          "Kimi-K2-Thinking": { "name": "Kimi K2 Thinking" }
        }
      },
      "headergenie": {
        "npm": "@ai-sdk/openai-compatible",
        "options": {
          "baseURL": "https://headergenie.example/v1",
          "headers": {
            "Authorization": "Bearer header-secret"
          }
        },
        "models": {
          "glm-5.2": { "name": "GLM 5.2" }
        }
      }
    }
  }`);
  const providerConfig = providerConfigFromOpenCodeConfigPayload(payload);
  const providerConfigSecrets = providerSecretsFromOpenCodeConfigPayload(payload);

  const accounts = await accountsFromOpenCodeAuthPayload({}, {
    providerConfig,
    providerConfigSecrets,
  });
  const byId = new Map(accounts.map((account) => [account.providerId, account]));

  assert.equal(byId.get("fhgenie")?.providerAdapter, "openai-compatible");
  assert.equal(byId.get("fhgenie")?.baseUrl, "https://fhgenie.example");
  assert.equal(byId.get("fhgenie")?.accessToken, "fh-secret");
  assert.equal(byId.get("fhgenie")?.enabled, true);
  assert.ok(byId.get("fhgenie")?.providerModels?.["Kimi-K2-Thinking"]);
  assert.equal(byId.get("headergenie")?.accessToken, "header-secret");
  assert.equal(byId.get("headergenie")?.baseUrl, "https://headergenie.example");
  assert.ok(byId.get("headergenie")?.providerModels?.["glm-5.2"]);
});

test("OpenCode auth import enables OpenAI-compatible SDK providers", async () => {
  const accounts = await accountsFromOpenCodeAuthPayload({
    xai: { apiKey: "xai-key" },
    groq: { apiKey: "groq-key" },
    vercel: { apiKey: "vercel-key" },
    venice: { apiKey: "venice-key" },
    aihubmix: { apiKey: "aihubmix-key" },
    "merge-gateway": { apiKey: "merge-key" },
    v0: { apiKey: "v0-key" },
  });
  const byId = new Map(accounts.map((account) => [account.providerId, account]));

  assert.equal(byId.get("xai")?.providerAdapter, "openai-compatible");
  assert.equal(byId.get("xai")?.baseUrl, "https://api.x.ai");
  assert.equal(byId.get("xai")?.enabled, true);
  assert.equal(byId.get("groq")?.baseUrl, "https://api.groq.com/openai");
  assert.equal(byId.get("vercel")?.baseUrl, "https://ai-gateway.vercel.sh");
  assert.equal(byId.get("venice")?.baseUrl, "https://api.venice.ai/api");
  assert.equal(byId.get("aihubmix")?.baseUrl, "https://aihubmix.com");
  assert.equal(
    byId.get("merge-gateway")?.baseUrl,
    "https://api-gateway.merge.dev/v1/openai",
  );
  assert.equal(byId.get("v0")?.providerAdapter, "openai-compatible");
  assert.equal(byId.get("v0")?.baseUrl, "https://api.v0.dev");
  assert.equal(byId.get("v0")?.enabled, true);
});
