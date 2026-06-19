import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNativeProviderRequest,
  convertNativeProviderResponse,
  nativeProviderModelsFromResponse,
} from "../dist/provider-native.js";
import {
  accountsFromOpenCodeAuthPayload,
} from "../dist/opencode-auth.js";

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

test("OpenCode auth import enables native Anthropic and Google adapters", async () => {
  const accounts = await accountsFromOpenCodeAuthPayload({
    anthropic: { apiKey: "ant-key" },
    google: { apiKey: "gem-key" },
  });
  const byId = new Map(accounts.map((account) => [account.providerId, account]));

  assert.equal(byId.get("anthropic")?.providerAdapter, "anthropic");
  assert.equal(byId.get("anthropic")?.enabled, true);
  assert.equal(byId.get("google")?.providerAdapter, "google");
  assert.equal(byId.get("google")?.enabled, true);
});
