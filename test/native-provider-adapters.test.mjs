import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AWS_BEDROCK_SIGV4_PLACEHOLDER,
  GOOGLE_VERTEX_ADC_PLACEHOLDER,
  buildAwsSigV4Headers,
  buildGoogleOAuthTokenRequest,
  buildNativeProviderRequest,
  buildGitLabDirectAccessRequest,
  buildGitLabProviderRequest,
  buildSapAiCoreProviderRequest,
  buildSapAiCoreTokenRequest,
  convertNativeProviderResponse,
  convertSapAiCoreResponse,
  nativeProviderModelsFromResponse,
  parseSapAiCoreServiceKey,
  parseAwsCredentialsFile,
  parseGoogleAuthCredentials,
  resolveAwsBedrockCredentials,
} from "../dist/provider-native.js";
import {
  accountsFromOpenCodeAuthPayload,
  parseOpenCodeConfigPayload,
  providerConfigFromOpenCodeConfigPayload,
  providerSecretsFromOpenCodeConfigPayload,
} from "../dist/opencode-auth.js";
import {
  providerRegistryEntryFromMetadata,
  resolveProviderRegistryEntry,
} from "../dist/provider-registry.js";

const NO_AUTH_ACCESS_TOKEN = "__opencodex_no_auth__";

function decodeJwtPart(token, index) {
  return JSON.parse(Buffer.from(token.split(".")[index], "base64url").toString("utf8"));
}

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

test("Anthropic adapter removes empty text parts before upstream requests", () => {
  const request = buildNativeProviderRequest(
    "anthropic",
    { accessToken: "ant-key" },
    {
      model: "claude-sonnet-4-5",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "" },
            { type: "text", text: "Keep me" },
          ],
        },
      ],
      max_tokens: 64,
    },
    false,
  );

  assert.deepEqual(request.body.messages, [
    { role: "user", content: [{ type: "text", text: "Keep me" }] },
  ]);
});

test("Anthropic adapter removes empty string messages before upstream requests", () => {
  const request = buildNativeProviderRequest(
    "anthropic",
    { accessToken: "ant-key" },
    {
      model: "claude-sonnet-4-5",
      messages: [
        { role: "user", content: "" },
        { role: "user", content: "Keep me" },
      ],
      max_tokens: 64,
    },
    false,
  );

  assert.deepEqual(request.body.messages, [
    { role: "user", content: [{ type: "text", text: "Keep me" }] },
  ]);
});

test("Anthropic adapter forwards thinking controls before upstream requests", () => {
  const request = buildNativeProviderRequest(
    "anthropic",
    { accessToken: "ant-key" },
    {
      model: "minimax-m3-smoke",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 64,
      thinking: { type: "adaptive" },
    },
    false,
  );

  assert.deepEqual(request.body.thinking, { type: "adaptive" });
});

test("Anthropic adapter scrubs tool call ids before upstream requests", () => {
  const request = buildNativeProviderRequest(
    "anthropic",
    { accessToken: "ant-key" },
    {
      model: "claude-sonnet-4-5",
      messages: [
        {
          role: "assistant",
          content: "Need lookup",
          tool_calls: [
            {
              id: "call:bad.id/1",
              type: "function",
              function: { name: "lookup", arguments: "{}" },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call:bad.id/1",
          content: "Lookup result",
        },
      ],
      max_tokens: 64,
    },
    false,
  );

  assert.equal(request.body.messages[0].content[1].id, "call_bad_id_1");
  assert.equal(
    request.body.messages[1].content[0].tool_use_id,
    "call_bad_id_1",
  );
});

test("Gateway adapter converts chat payloads, responses, and model metadata", () => {
  const request = buildNativeProviderRequest(
    "gateway",
    { accessToken: "gateway-key" },
    {
      model: "openai/gpt-5",
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "Hello Gateway" },
      ],
      max_tokens: 128,
      temperature: 0.2,
      stop: ["END"],
    },
    false,
  );

  assert.equal(request.path, "/language-model");
  assert.equal(request.headers.authorization, "Bearer gateway-key");
  assert.equal(request.headers["ai-gateway-protocol-version"], "0.0.1");
  assert.equal(request.headers["ai-gateway-auth-method"], "api-key");
  assert.equal(request.headers["ai-language-model-specification-version"], "3");
  assert.equal(request.headers["ai-language-model-id"], "openai/gpt-5");
  assert.equal(request.headers["ai-language-model-streaming"], "false");
  assert.deepEqual(request.body.prompt, [
    { role: "system", content: [{ type: "text", text: "Be terse." }] },
    { role: "user", content: [{ type: "text", text: "Hello Gateway" }] },
  ]);
  assert.equal(request.body.maxOutputTokens, 128);
  assert.equal(request.body.temperature, 0.2);
  assert.deepEqual(request.body.stopSequences, ["END"]);

  const converted = convertNativeProviderResponse(
    "gateway",
    {
      content: [{ type: "text", text: "Gateway OK" }],
      finishReason: "stop",
      usage: { inputTokens: 5, outputTokens: 2 },
    },
    "chat.completions",
    "openai/gpt-5",
  );
  assert.equal(converted.model, "openai/gpt-5");
  assert.equal(converted.choices[0].message.content, "Gateway OK");
  assert.deepEqual(converted.usage, {
    prompt_tokens: 5,
    completion_tokens: 2,
    total_tokens: 7,
  });

  const models = nativeProviderModelsFromResponse("gateway", {
    models: [
      {
        id: "openai/gpt-5",
        name: "GPT-5",
        specification: {
          specificationVersion: "v3",
          provider: "openai",
          modelId: "gpt-5",
        },
      },
    ],
  });
  assert.deepEqual(models, [
    {
      id: "openai/gpt-5",
      context_window: null,
      max_output_tokens: null,
    },
  ]);
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

test("Vertex adapter converts chat payloads and responses", () => {
  const request = buildNativeProviderRequest(
    "vertex",
    { accessToken: "vertex-token" },
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
    "/publishers/google/models/gemini-2.5-pro:generateContent",
  );
  assert.equal(request.headers.authorization, "Bearer vertex-token");
  assert.equal(request.body.systemInstruction.parts[0].text, "Be concise.");
  assert.deepEqual(request.body.contents, [
    { role: "user", parts: [{ text: "Hello" }] },
  ]);
  assert.equal(request.body.generationConfig.maxOutputTokens, 64);
  assert.equal(request.body.generationConfig.temperature, 0.2);

  const converted = convertNativeProviderResponse(
    "vertex",
    {
      candidates: [
        {
          content: { role: "model", parts: [{ text: "Hi Vertex" }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 7,
        candidatesTokenCount: 2,
        totalTokenCount: 9,
      },
    },
    "chat.completions",
    "gemini-2.5-pro",
  );

  assert.equal(converted.object, "chat.completion");
  assert.equal(converted.choices[0].message.content, "Hi Vertex");
  assert.equal(converted.usage.total_tokens, 9);
});

test("Google Vertex service-account ADC credentials build OAuth JWT token requests", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const credentials = parseGoogleAuthCredentials({
    type: "service_account",
    project_id: "vertex-project",
    private_key_id: "test-key-id",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    client_email: "vertex-sa@example.iam.gserviceaccount.com",
    token_uri: "https://oauth2.example/token",
  });

  assert.equal(credentials?.kind, "service_account");
  assert.equal(credentials?.projectId, "vertex-project");
  assert.equal(credentials?.clientEmail, "vertex-sa@example.iam.gserviceaccount.com");

  const request = buildGoogleOAuthTokenRequest(
    credentials,
    new Date("2026-06-19T00:00:00.000Z"),
  );
  assert.equal(request.url, "https://oauth2.example/token");
  assert.equal(
    request.headers["content-type"],
    "application/x-www-form-urlencoded",
  );

  const body = new URLSearchParams(request.body);
  assert.equal(
    body.get("grant_type"),
    "urn:ietf:params:oauth:grant-type:jwt-bearer",
  );
  const assertion = body.get("assertion");
  assert.ok(assertion);
  assert.equal(decodeJwtPart(assertion, 0).alg, "RS256");
  assert.equal(decodeJwtPart(assertion, 0).kid, "test-key-id");
  const claims = decodeJwtPart(assertion, 1);
  assert.equal(claims.iss, "vertex-sa@example.iam.gserviceaccount.com");
  assert.equal(claims.scope, "https://www.googleapis.com/auth/cloud-platform");
  assert.equal(claims.aud, "https://oauth2.example/token");
  assert.equal(claims.iat, 1781827200);
  assert.equal(claims.exp, 1781830800);
});

test("Vertex Anthropic adapter converts chat payloads and responses", () => {
  const request = buildNativeProviderRequest(
    "vertex-anthropic",
    { accessToken: "vertex-ant-token" },
    {
      model: "claude-3-5-sonnet-v2@20241022",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
      ],
      max_tokens: 64,
      stream: true,
    },
    false,
  );

  assert.equal(
    request.path,
    "/publishers/anthropic/models/claude-3-5-sonnet-v2%4020241022:rawPredict",
  );
  assert.equal(request.headers.authorization, "Bearer vertex-ant-token");
  assert.equal(request.body.anthropic_version, "vertex-2023-10-16");
  assert.equal(request.body.model, undefined);
  assert.equal(request.body.system, "Be concise.");
  assert.equal(request.body.max_tokens, 64);
  assert.equal(request.body.stream, false);
  assert.deepEqual(request.body.messages, [
    { role: "user", content: [{ type: "text", text: "Hello" }] },
  ]);

  const converted = convertNativeProviderResponse(
    "vertex-anthropic",
    {
      id: "msg_vrtx_1",
      role: "assistant",
      content: [{ type: "text", text: "Hi Vertex Claude" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 2 },
    },
    "chat.completions",
    "claude-3-5-sonnet-v2@20241022",
  );

  assert.equal(converted.object, "chat.completion");
  assert.equal(converted.choices[0].message.content, "Hi Vertex Claude");
  assert.equal(converted.usage.total_tokens, 7);
});

test("GitLab adapter builds direct-access and AI Gateway proxy requests", () => {
  const directAccess = buildGitLabDirectAccessRequest(
    { accessToken: "glpat-user-token" },
  );
  assert.equal(directAccess.path, "/api/v4/ai/third_party_agents/direct_access");
  assert.equal(directAccess.headers.authorization, "Bearer glpat-user-token");
  assert.deepEqual(directAccess.body, {});

  const anthropicRequest = buildGitLabProviderRequest(
    {
      token: "gitlab-direct-token",
      headers: { "x-gitlab-realm": "saas" },
    },
    {
      model: "duo-chat-opus-4-5",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
      ],
      max_tokens: 64,
      stream: true,
    },
    false,
  );

  assert.equal(anthropicRequest.kind, "anthropic");
  assert.equal(anthropicRequest.baseUrl, "https://cloud.gitlab.com/ai/v1/proxy/anthropic");
  assert.equal(anthropicRequest.path, "/v1/messages");
  assert.equal(anthropicRequest.headers.authorization, "Bearer gitlab-direct-token");
  assert.equal(anthropicRequest.headers["x-gitlab-realm"], "saas");
  assert.equal(anthropicRequest.body.model, "claude-opus-4-5-20251101");
  assert.equal(anthropicRequest.body.system, "Be concise.");
  assert.equal(anthropicRequest.body.max_tokens, 64);
  assert.equal(anthropicRequest.body.stream, false);

  const openAiRequest = buildGitLabProviderRequest(
    {
      token: "gitlab-direct-token",
      headers: {},
      aiGatewayUrl: "https://gateway.example.test",
    },
    {
      model: "duo-chat-gpt-5-4",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 32,
    },
    false,
  );

  assert.equal(openAiRequest.kind, "openai-chat");
  assert.equal(openAiRequest.baseUrl, "https://gateway.example.test/ai/v1/proxy/openai");
  assert.equal(openAiRequest.path, "/v1/chat/completions");
  assert.equal(openAiRequest.headers.authorization, "Bearer gitlab-direct-token");
  assert.equal(openAiRequest.body.model, "gpt-5.4-2026-03-05");
  assert.equal(openAiRequest.body.max_completion_tokens, 32);
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
      reasoningConfig: { type: "enabled", budgetTokens: 16000 },
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
  assert.deepEqual(request.body.reasoningConfig, {
    type: "enabled",
    budgetTokens: 16000,
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

test("Amazon Bedrock adapter removes empty string messages before upstream requests", () => {
  const request = buildNativeProviderRequest(
    "amazon-bedrock",
    { accessToken: "bedrock-key" },
    {
      model: "anthropic.claude-3-haiku-20240307-v1:0",
      messages: [
        { role: "user", content: "" },
        { role: "user", content: "Keep me" },
      ],
    },
    false,
  );

  assert.deepEqual(request.body.messages, [
    { role: "user", content: [{ text: "Keep me" }] },
  ]);
});

test("Amazon Bedrock adapter signs requests with AWS SigV4 credentials", () => {
  const credentials = resolveAwsBedrockCredentials(
    { region: "us-east-1" },
    {
      AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
      AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      AWS_SESSION_TOKEN: "session-token",
    },
  );
  assert.deepEqual(credentials, {
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    sessionToken: "session-token",
    region: "us-east-1",
  });

  const headers = buildAwsSigV4Headers({
    method: "POST",
    url: "https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-haiku-20240307-v1%3A0/converse",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ messages: [{ role: "user", content: [{ text: "Hello" }] }] }),
    credentials,
    now: new Date("2015-08-30T12:36:00Z"),
  });

  assert.equal(headers.authorization?.startsWith("AWS4-HMAC-SHA256 "), true);
  assert.match(
    headers.authorization,
    /Credential=AKIDEXAMPLE\/20150830\/us-east-1\/bedrock\/aws4_request/,
  );
  assert.match(
    headers.authorization,
    /SignedHeaders=accept;content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token/,
  );
  assert.match(headers.authorization, /Signature=[a-f0-9]{64}$/);
  assert.equal(headers["x-amz-date"], "20150830T123600Z");
  assert.equal(headers["x-amz-security-token"], "session-token");
  assert.match(headers["x-amz-content-sha256"], /^[a-f0-9]{64}$/);
});

test("Amazon Bedrock adapter resolves named AWS profile credentials", () => {
  const parsed = parseAwsCredentialsFile(
    `
[default]
aws_access_key_id = DEFAULTKEY
aws_secret_access_key = DEFAULTSECRET

[prod]
aws_access_key_id = PRODKEY
aws_secret_access_key = PRODSECRET
aws_session_token = PRODSESSION
`,
    "prod",
  );
  assert.deepEqual(parsed, {
    accessKeyId: "PRODKEY",
    secretAccessKey: "PRODSECRET",
    sessionToken: "PRODSESSION",
  });
});

test("SAP AI Core adapter builds service-key auth and orchestration requests", () => {
  const serviceKey = parseSapAiCoreServiceKey(
    JSON.stringify({
      clientid: "sap-client",
      clientsecret: "sap-secret",
      url: "http://sap-auth.example",
      serviceurls: {
        AI_API_URL: "http://sap-ai.example/v2",
      },
    }),
  );

  const tokenRequest = buildSapAiCoreTokenRequest(serviceKey);
  assert.equal(tokenRequest.url, "http://sap-auth.example/oauth/token");
  assert.equal(
    tokenRequest.headers.authorization,
    `Basic ${Buffer.from("sap-client:sap-secret").toString("base64")}`,
  );
  assert.equal(tokenRequest.body, "grant_type=client_credentials");

  const providerRequest = buildSapAiCoreProviderRequest(
    serviceKey,
    { accessToken: "sap-oauth-token" },
    {
      model: "anthropic--claude-4.5-sonnet",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
      ],
      max_tokens: 64,
      temperature: 0.2,
      modelParams: {
        thinking: { type: "enabled", budget_tokens: 16000 },
      },
    },
    {
      deploymentId: "orchestration-deployment",
      resourceGroup: "rg-ai",
    },
  );

  assert.equal(providerRequest.baseUrl, "http://sap-ai.example/v2");
  assert.equal(
    providerRequest.path,
    "/inference/deployments/orchestration-deployment/v2/completion",
  );
  assert.equal(providerRequest.headers.authorization, "Bearer sap-oauth-token");
  assert.equal(providerRequest.headers["ai-resource-group"], "rg-ai");
  assert.equal(
    providerRequest.body.config.modules.prompt_templating.model.name,
    "anthropic--claude-4.5-sonnet",
  );
  assert.equal(
    providerRequest.body.config.modules.prompt_templating.model.params.max_tokens,
    64,
  );
  assert.equal(
    providerRequest.body.config.modules.prompt_templating.model.params.temperature,
    0.2,
  );
  assert.deepEqual(
    providerRequest.body.config.modules.prompt_templating.model.params.thinking,
    { type: "enabled", budget_tokens: 16000 },
  );
  assert.deepEqual(
    providerRequest.body.config.modules.prompt_templating.prompt.template,
    [
      { role: "system", content: "Be concise." },
      { role: "user", content: "Hello" },
    ],
  );

  const converted = convertSapAiCoreResponse(
    {
      request_id: "sap-request-1",
      final_result: {
        id: "chatcmpl-sap",
        object: "chat.completion",
        created: 1,
        model: "anthropic--claude-4.5-sonnet",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "SAP OK" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      },
      intermediate_results: {},
    },
    "chat.completions",
    "anthropic--claude-4.5-sonnet",
  );

  assert.equal(converted.object, "chat.completion");
  assert.equal(converted.choices[0].message.content, "SAP OK");
  assert.equal(converted.usage.total_tokens, 7);
});

test("OpenCode auth import enables native Anthropic, Google, Vertex, Vertex Anthropic, Cohere, Bedrock, and SAP adapters", async () => {
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

  const vertexPayload = parseOpenCodeConfigPayload(`{
    "provider": {
      "google-vertex": {
        "npm": "@ai-sdk/google-vertex",
        "options": {
          "project": "vertex-project",
          "location": "us-central1",
          "apiKey": "vertex-token"
        },
        "models": {
          "gemini-2.5-pro": { "name": "Gemini 2.5 Pro" }
        }
      },
      "google-vertex-anthropic": {
        "npm": "@ai-sdk/google-vertex/anthropic",
        "options": {
          "project": "vertex-project",
          "location": "us-east5",
          "apiKey": "vertex-ant-token"
        },
        "models": {
          "claude-3-5-sonnet-v2@20241022": { "name": "Claude 3.5 Sonnet v2" }
        }
      }
    }
  }`);
  const vertexAccounts = await accountsFromOpenCodeAuthPayload(
    { "google-vertex": {} },
    {
      providerConfig: providerConfigFromOpenCodeConfigPayload(vertexPayload),
      providerConfigSecrets: providerSecretsFromOpenCodeConfigPayload(vertexPayload),
    },
  );
  const vertex = vertexAccounts.find((account) => account.providerId === "google-vertex");
  assert.equal(vertex?.provider, "vertex");
  assert.equal(vertex?.providerAdapter, "vertex");
  assert.equal(
    vertex?.baseUrl,
    "https://us-central1-aiplatform.googleapis.com/v1/projects/vertex-project/locations/us-central1",
  );
  assert.equal(vertex?.accessToken, "vertex-token");
  assert.equal(vertex?.enabled, true);
  assert.deepEqual(vertex?.providerAuthEnv, [
    "GOOGLE_VERTEX_ACCESS_TOKEN",
    "GOOGLE_ACCESS_TOKEN",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_VERTEX_PROJECT",
    "VERTEX_LOCATION",
    "GOOGLE_VERTEX_LOCATION",
  ]);
  assert.ok(vertex?.providerModels?.["gemini-2.5-pro"]);

  const vertexAnthropicAccounts = await accountsFromOpenCodeAuthPayload(
    { "google-vertex-anthropic": {} },
    {
      providerConfig: providerConfigFromOpenCodeConfigPayload(vertexPayload),
      providerConfigSecrets: providerSecretsFromOpenCodeConfigPayload(vertexPayload),
    },
  );
  const vertexAnthropic = vertexAnthropicAccounts.find(
    (account) => account.providerId === "google-vertex-anthropic",
  );
  assert.equal(vertexAnthropic?.provider, "vertex-anthropic");
  assert.equal(vertexAnthropic?.providerAdapter, "vertex-anthropic");
  assert.equal(
    vertexAnthropic?.baseUrl,
    "https://us-east5-aiplatform.googleapis.com/v1/projects/vertex-project/locations/us-east5",
  );
  assert.equal(vertexAnthropic?.accessToken, "vertex-ant-token");
  assert.equal(vertexAnthropic?.enabled, true);
  assert.deepEqual(vertexAnthropic?.providerAuthEnv, [
    "GOOGLE_VERTEX_ACCESS_TOKEN",
    "GOOGLE_ACCESS_TOKEN",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_VERTEX_PROJECT",
    "VERTEX_LOCATION",
    "GOOGLE_VERTEX_LOCATION",
  ]);
  assert.ok(vertexAnthropic?.providerModels?.["claude-3-5-sonnet-v2@20241022"]);

  assert.equal(byId.get("cohere")?.providerAdapter, "cohere");
  assert.equal(byId.get("cohere")?.baseUrl, "https://api.cohere.com");
  assert.equal(byId.get("cohere")?.enabled, true);
  assert.equal(byId.get("amazon-bedrock")?.providerAdapter, "amazon-bedrock");
  assert.deepEqual(byId.get("amazon-bedrock")?.providerAuthEnv, [
    "AWS_BEARER_TOKEN_BEDROCK",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_PROFILE",
    "AWS_DEFAULT_PROFILE",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
    "AWS_SHARED_CREDENTIALS_FILE",
  ]);
  assert.equal(
    byId.get("amazon-bedrock")?.baseUrl,
    "https://bedrock-runtime.us-east-1.amazonaws.com",
  );
  assert.equal(byId.get("amazon-bedrock")?.enabled, true);

  const sapPayload = parseOpenCodeConfigPayload(`{
    "provider": {
      "sap-ai-core": {
        "npm": "@jerome-benoit/sap-ai-provider-v2",
        "options": {
          "deploymentId": "orchestration-deployment",
          "resourceGroup": "rg-ai",
          "apiKey": "{\\"clientid\\":\\"sap-client\\",\\"clientsecret\\":\\"sap-secret\\",\\"url\\":\\"http://sap-auth.example\\",\\"serviceurls\\":{\\"AI_API_URL\\":\\"http://sap-ai.example/v2\\"}}"
        },
        "models": {
          "anthropic--claude-4.5-sonnet": { "name": "Claude via SAP" }
        }
      }
    }
  }`);
  const sapAccounts = await accountsFromOpenCodeAuthPayload(
    { "sap-ai-core": {} },
    {
      providerConfig: providerConfigFromOpenCodeConfigPayload(sapPayload),
      providerConfigSecrets: providerSecretsFromOpenCodeConfigPayload(sapPayload),
    },
  );
  const sap = sapAccounts.find((account) => account.providerId === "sap-ai-core");
  assert.equal(sap?.provider, "sap-ai-core");
  assert.equal(sap?.providerAdapter, "sap-ai-core");
  assert.equal(sap?.enabled, true);
  assert.deepEqual(sap?.providerAuthEnv, ["AICORE_SERVICE_KEY"]);
  assert.equal(sap?.baseUrl, "http://sap-ai.example/v2");
  assert.equal(sap?.providerOptions?.deploymentId, "orchestration-deployment");
  assert.equal(sap?.providerOptions?.resourceGroup, "rg-ai");
  assert.ok(sap?.providerModels?.["anthropic--claude-4.5-sonnet"]);

  const sapServiceKeyAccounts = await accountsFromOpenCodeAuthPayload({
    "sap-ai-core": {
      serviceKey: {
        clientid: "sap-client",
        clientsecret: "sap-secret",
        url: "http://sap-auth.example",
        serviceurls: {
          AI_API_URL: "http://sap-ai.example/v2",
        },
      },
    },
  });
  assert.equal(sapServiceKeyAccounts[0]?.providerAdapter, "sap-ai-core");
  assert.equal(sapServiceKeyAccounts[0]?.enabled, true);
  assert.equal(sapServiceKeyAccounts[0]?.baseUrl, "http://sap-ai.example/v2");
  assert.equal(
    JSON.parse(sapServiceKeyAccounts[0]?.accessToken ?? "{}").serviceurls.AI_API_URL,
    "http://sap-ai.example/v2",
  );
});

test("OpenCode config parser accepts JSONC trailing commas without changing string values", () => {
  const payload = parseOpenCodeConfigPayload(`{
    "provider": {
      "commagenie": {
        "npm": "@ai-sdk/openai-compatible",
        "options": {
          "baseURL": "https://comma.example/v1",
          "apiKey": "comma-secret",
        },
        "models": {
          "comma-model": {
            "name": "literal ,} stays",
          },
        },
      },
    },
  }`);

  const providerConfig = providerConfigFromOpenCodeConfigPayload(payload);
  const providerSecrets = providerSecretsFromOpenCodeConfigPayload(payload);
  const entry = providerConfig.get("commagenie");
  const model = entry?.models?.["comma-model"];

  assert.equal(entry?.providerAdapter, "openai-compatible");
  assert.equal(entry?.baseUrl, "https://comma.example");
  assert.equal(providerSecrets.get("commagenie"), "comma-secret");
  assert.equal(
    model && typeof model === "object" && !Array.isArray(model)
      ? model.name
      : undefined,
    "literal ,} stays",
  );
});

test("OpenCode config preserves runtime provider options without duplicating secrets", () => {
  const payload = parseOpenCodeConfigPayload(`{
    "provider": {
      "timed-provider": {
        "npm": "@ai-sdk/openai-compatible",
        "options": {
          "baseURL": "https://timed.example/v1",
          "apiKey": "timed-secret",
          "timeout": 600000,
          "chunkTimeout": 30000,
          "setCacheKey": true,
          "headers": {
            "x-safe": "ok",
            "authorization": "Bearer should-not-preserve"
          }
        },
        "models": {
          "timed-model": { "name": "Timed Model" }
        }
      }
    }
  }`);

  const providerConfig = providerConfigFromOpenCodeConfigPayload(payload);
  const providerSecrets = providerSecretsFromOpenCodeConfigPayload(payload);
  const entry = providerConfig.get("timed-provider");

  assert.equal(providerSecrets.get("timed-provider"), "timed-secret");
  assert.equal(entry?.baseUrl, "https://timed.example");
  assert.deepEqual(entry?.providerOptions, {
    timeout: 600000,
    chunkTimeout: 30000,
    setCacheKey: true,
    headers: { "x-safe": "ok" },
  });
});

test("OpenCode config strips native provider version suffixes from baseURL", async () => {
  const payload = parseOpenCodeConfigPayload(`{
    "provider": {
      "anthropic": {
        "npm": "@ai-sdk/anthropic",
        "options": {
          "baseURL": "https://api.anthropic.com/v1",
          "apiKey": "ant-config-key"
        },
        "models": {
          "claude-sonnet-4-5": { "name": "Claude Sonnet 4.5" }
        }
      }
    }
  }`);

  const accounts = await accountsFromOpenCodeAuthPayload(
    {},
    {
      providerConfig: providerConfigFromOpenCodeConfigPayload(payload),
      providerConfigSecrets: providerSecretsFromOpenCodeConfigPayload(payload),
    },
  );
  const anthropic = accounts.find((account) => account.providerId === "anthropic");

  assert.equal(anthropic?.providerAdapter, "anthropic");
  assert.equal(anthropic?.baseUrl, "https://api.anthropic.com");
  assert.equal(anthropic?.accessToken, "ant-config-key");
  assert.equal(anthropic?.enabled, true);
  assert.ok(anthropic?.providerModels?.["claude-sonnet-4-5"]);
});

test("OpenCode auth import preserves OAuth access refresh and expiry fields", async () => {
  const providerConfig = new Map([
    [
      "gitlab",
      {
        id: "gitlab",
        providerId: "gitlab",
        label: "GitLab",
        provider: "gitlab",
        providerAdapter: "gitlab",
        providerNpm: "gitlab-ai-provider",
        providerSource: "manual",
        providerDoc: "https://opencode.ai/docs/providers/",
        baseUrl: "https://gitlab.com",
        tokenEnv: ["GITLAB_TOKEN"],
        authType: "api-key",
        runtimeSupported: true,
        models: {
          "duo-chat-sonnet-4-5": { name: "Duo Chat Sonnet 4.5" },
        },
      },
    ],
  ]);

  const accounts = await accountsFromOpenCodeAuthPayload(
    {
      gitlab: {
        type: "oauth",
        methodID: "oauth",
        access: "gitlab-oauth-access",
        refresh: "gitlab-oauth-refresh",
        expires: 9999999999999,
      },
    },
    { providerConfig },
  );
  const gitlab = accounts.find((account) => account.providerId === "gitlab");

  assert.equal(gitlab?.providerAdapter, "gitlab");
  assert.equal(gitlab?.accessToken, "gitlab-oauth-access");
  assert.equal(gitlab?.refreshToken, "gitlab-oauth-refresh");
  assert.equal(gitlab?.expiresAt, 9999999999999);
  assert.equal(gitlab?.providerAuthType, "oauth");
  assert.ok(gitlab?.providerModels?.["duo-chat-sonnet-4-5"]);
});

test("GitLab Duo directory provider resolves to GitLab native adapter", async () => {
  const entry = await resolveProviderRegistryEntry("gitlab-duo");

  assert.equal(entry.id, "gitlab");
  assert.equal(entry.providerId, "gitlab");
  assert.equal(entry.provider, "gitlab");
  assert.equal(entry.providerAdapter, "gitlab");
  assert.equal(entry.runtimeSupported, true);
  assert.equal(entry.baseUrl, "https://gitlab.com");
  assert.deepEqual(entry.tokenEnv, ["GITLAB_TOKEN"]);
});

test("OpenCode auth import accepts stored credential records", async () => {
  const providerConfig = new Map([
    [
      "gitlab",
      {
        id: "gitlab",
        providerId: "gitlab",
        label: "GitLab",
        provider: "gitlab",
        providerAdapter: "gitlab",
        providerNpm: "gitlab-ai-provider",
        providerSource: "manual",
        providerDoc: "https://opencode.ai/docs/providers/",
        baseUrl: "https://gitlab.com",
        tokenEnv: ["GITLAB_TOKEN"],
        authType: "api-key",
        runtimeSupported: true,
        models: {
          "duo-chat-sonnet-4-5": { name: "Duo Chat Sonnet 4.5" },
        },
      },
    ],
  ]);

  const accounts = await accountsFromOpenCodeAuthPayload(
    [
      {
        id: "cred_work",
        integrationID: "gitlab",
        label: "Work",
        value: {
          type: "oauth",
          methodID: "oauth",
          access: "stored-oauth-access",
          refresh: "stored-oauth-refresh",
          expires: 9999999999999,
        },
      },
    ],
    { providerConfig },
  );
  const gitlab = accounts.find((account) => account.providerId === "gitlab");

  assert.equal(gitlab?.id, "gitlab-work");
  assert.equal(gitlab?.providerAdapter, "gitlab");
  assert.equal(gitlab?.accessToken, "stored-oauth-access");
  assert.equal(gitlab?.refreshToken, "stored-oauth-refresh");
  assert.equal(gitlab?.expiresAt, 9999999999999);
  assert.equal(gitlab?.providerAuthType, "oauth");
  assert.ok(gitlab?.providerModels?.["duo-chat-sonnet-4-5"]);
});

test("OpenCode auth import enables Amazon Bedrock through AWS credential-chain config", async () => {
  const previous = {
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN,
    AWS_REGION: process.env.AWS_REGION,
  };
  process.env.AWS_ACCESS_KEY_ID = "AKIDIMPORT";
  process.env.AWS_SECRET_ACCESS_KEY = "SECRETIMPORT";
  process.env.AWS_SESSION_TOKEN = "SESSIONIMPORT";
  delete process.env.AWS_REGION;
  try {
    const payload = parseOpenCodeConfigPayload(`{
      "provider": {
        "amazon-bedrock": {
          "npm": "@ai-sdk/amazon-bedrock",
          "options": {
            "region": "us-west-2",
            "profile": "prod"
          },
          "models": {
            "anthropic.claude-3-haiku-20240307-v1:0": {
              "name": "Claude 3 Haiku"
            }
          }
        }
      }
    }`);
    const accounts = await accountsFromOpenCodeAuthPayload(
      { "amazon-bedrock": {} },
      {
        providerConfig: providerConfigFromOpenCodeConfigPayload(payload),
        providerConfigSecrets: providerSecretsFromOpenCodeConfigPayload(payload),
      },
    );
    const bedrock = accounts.find((account) => account.providerId === "amazon-bedrock");

    assert.equal(bedrock?.provider, "amazon-bedrock");
    assert.equal(bedrock?.providerAdapter, "amazon-bedrock");
    assert.equal(bedrock?.accessToken, AWS_BEDROCK_SIGV4_PLACEHOLDER);
    assert.equal(bedrock?.baseUrl, "https://bedrock-runtime.us-west-2.amazonaws.com");
    assert.equal(bedrock?.providerOptions?.region, "us-west-2");
    assert.equal(bedrock?.providerOptions?.profile, "prod");
    assert.equal(bedrock?.enabled, true);
    assert.ok(bedrock?.providerModels?.["anthropic.claude-3-haiku-20240307-v1:0"]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("OpenCode auth import enables Google Vertex through ADC service-account credentials", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const dir = mkdtempSync(join(tmpdir(), "opencodex-vertex-adc-"));
  const credentialsPath = join(dir, "service-account.json");
  writeFileSync(
    credentialsPath,
    JSON.stringify({
      type: "service_account",
      project_id: "vertex-project",
      private_key_id: "import-key-id",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
      client_email: "vertex-import@example.iam.gserviceaccount.com",
      token_uri: "https://oauth2.example/token",
    }),
  );

  const previous = {
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
    GOOGLE_VERTEX_PROJECT: process.env.GOOGLE_VERTEX_PROJECT,
    VERTEX_LOCATION: process.env.VERTEX_LOCATION,
    GOOGLE_VERTEX_LOCATION: process.env.GOOGLE_VERTEX_LOCATION,
    GOOGLE_VERTEX_ACCESS_TOKEN: process.env.GOOGLE_VERTEX_ACCESS_TOKEN,
    GOOGLE_ACCESS_TOKEN: process.env.GOOGLE_ACCESS_TOKEN,
  };
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
  process.env.GOOGLE_CLOUD_PROJECT = "vertex-project";
  process.env.VERTEX_LOCATION = "global";
  delete process.env.GOOGLE_VERTEX_PROJECT;
  delete process.env.GOOGLE_VERTEX_LOCATION;
  delete process.env.GOOGLE_VERTEX_ACCESS_TOKEN;
  delete process.env.GOOGLE_ACCESS_TOKEN;

  try {
    const payload = parseOpenCodeConfigPayload(`{
      "provider": {
        "google-vertex": {
          "npm": "@ai-sdk/google-vertex",
          "options": {
            "project": "vertex-project",
            "location": "global"
          },
          "models": {
            "gemini-2.5-pro": { "name": "Gemini 2.5 Pro" }
          }
        }
      }
    }`);
    const accounts = await accountsFromOpenCodeAuthPayload(
      { "google-vertex": {} },
      {
        providerConfig: providerConfigFromOpenCodeConfigPayload(payload),
        providerConfigSecrets: providerSecretsFromOpenCodeConfigPayload(payload),
      },
    );
    const vertex = accounts.find((account) => account.providerId === "google-vertex");

    assert.equal(vertex?.provider, "vertex");
    assert.equal(vertex?.providerAdapter, "vertex");
    assert.equal(vertex?.accessToken, GOOGLE_VERTEX_ADC_PLACEHOLDER);
    assert.equal(
      vertex?.baseUrl,
      "https://aiplatform.googleapis.com/v1/projects/vertex-project/locations/global",
    );
    assert.equal(vertex?.providerOptions?.project, "vertex-project");
    assert.equal(vertex?.providerOptions?.location, "global");
    assert.equal(vertex?.enabled, true);
    assert.deepEqual(vertex?.providerAuthEnv, [
      "GOOGLE_VERTEX_ACCESS_TOKEN",
      "GOOGLE_ACCESS_TOKEN",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "GOOGLE_CLOUD_PROJECT",
      "GOOGLE_VERTEX_PROJECT",
      "VERTEX_LOCATION",
      "GOOGLE_VERTEX_LOCATION",
    ]);
    assert.ok(vertex?.providerModels?.["gemini-2.5-pro"]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("OpenAI-compatible SDK providers are runtime-routable through the bridge", async () => {
  const expected = new Map([
    ["xai", "https://api.x.ai"],
    ["groq", "https://api.groq.com/openai"],
    ["deepinfra", "https://api.deepinfra.com/v1/openai"],
    ["cerebras", "https://api.cerebras.ai"],
    ["togetherai", "https://api.together.ai"],
    ["perplexity", "https://api.perplexity.ai"],
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
    assert.equal(
      entry.compatibilityMode,
      providerId === "xai" ? "responses" : "chat-completions-bridge",
      providerId,
    );
  }

  const perplexity = await resolveProviderRegistryEntry("perplexity");
  assert.equal(perplexity.openAiPathPrefix, "none");
  assert.ok(perplexity.models?.["sonar-pro"]);
});

test("OpenCode directory display names resolve to canonical provider ids", async () => {
  const expected = new Map([
    ["Deep Infra", "deepinfra"],
    ["Google Vertex AI", "google-vertex"],
    ["Hugging Face", "huggingface"],
    ["LM Studio", "lmstudio"],
    ["Moonshot AI", "moonshotai"],
    ["Nebius Token Factory", "nebius"],
    ["OVHcloud AI Endpoints", "ovhcloud"],
    ["Together AI", "togetherai"],
    ["Venice AI", "venice"],
    ["Vercel AI Gateway", "vercel"],
  ]);

  for (const [providerName, canonicalId] of expected) {
    const entry = await resolveProviderRegistryEntry(providerName);
    assert.equal(entry.id, canonicalId, providerName);
    assert.notEqual(entry.providerAdapter, "unsupported", providerName);
  }
});

test("Vercel AI Gateway is runtime-routable through the Gateway adapter", async () => {
  const entry = await resolveProviderRegistryEntry("vercel");
  assert.equal(entry.providerAdapter, "gateway");
  assert.equal(entry.provider, "gateway");
  assert.equal(entry.runtimeSupported, true);
  assert.equal(entry.baseUrl, "https://ai-gateway.vercel.sh/v3/ai");
  assert.deepEqual(entry.tokenEnv, ["AI_GATEWAY_API_KEY"]);

  const fromMetadata = providerRegistryEntryFromMetadata("vercel", {
    id: "vercel",
    name: "Vercel AI Gateway",
    npm: "@ai-sdk/gateway",
    api: "https://ai-gateway.vercel.sh/v3/ai",
    env: ["AI_GATEWAY_API_KEY"],
    models: {
      "openai/gpt-5": { name: "GPT-5" },
    },
  });
  assert.equal(fromMetadata.providerAdapter, "gateway");
  assert.equal(fromMetadata.provider, "gateway");
  assert.equal(fromMetadata.baseUrl, "https://ai-gateway.vercel.sh/v3/ai");
  assert.equal(fromMetadata.runtimeSupported, true);
  assert.ok(fromMetadata.models?.["openai/gpt-5"]);
});

test("OpenCode directory OpenAI-compatible providers have offline runtime defaults", () => {
  const expected = {
    "302ai": "https://api.302.ai",
    abacus: "https://routellm.abacus.ai",
    "abliteration-ai": "https://api.abliteration.ai",
    alibaba: "https://dashscope-intl.aliyuncs.com/compatible-mode",
    "alibaba-cn": "https://dashscope.aliyuncs.com/compatible-mode",
    "alibaba-coding-plan": "https://coding-intl.dashscope.aliyuncs.com",
    "alibaba-coding-plan-cn": "https://coding.dashscope.aliyuncs.com",
    "alibaba-token-plan":
      "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode",
    "alibaba-token-plan-cn":
      "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode",
    ambient: "https://api.ambient.xyz",
    anyapi: "https://api.anyapi.ai",
    "atomic-chat": "http://127.0.0.1:1337",
    auriko: "https://api.auriko.ai",
    bailing: "https://api.tbox.cn/api/llm/v1/chat/completions",
    baseten: "https://inference.baseten.co",
    berget: "https://api.berget.ai",
    chutes: "https://llm.chutes.ai",
    claudinio: "https://api.claudin.io",
    clarifai: "https://api.clarifai.com/v2/ext/openai",
    "cloudferro-sherlock": "https://api-sherlock.cloudferro.com/openai",
    cortecs: "https://api.cortecs.ai",
    crof: "https://crof.ai",
    deepseek: "https://api.deepseek.com",
    digitalocean: "https://inference.do-ai.run",
    dinference: "https://api.dinference.com",
    drun: "https://chat.d.run",
    evroc: "https://models.think.evroc.com",
    fastrouter: "https://go.fastrouter.ai/api",
    firepass: "https://api.fireworks.ai/inference",
    "fireworks-ai": "https://api.fireworks.ai/inference",
    friendli: "https://api.friendli.ai/serverless",
    frogbot: "https://app.frogbot.ai/api",
    gmicloud: "https://api.gmi-serving.com",
    "github-copilot": "https://api.githubcopilot.com",
    "github-models": "https://models.github.ai/inference",
    huggingface: "https://router.huggingface.co",
    helicone: "https://ai-gateway.helicone.ai",
    "io-net": "https://api.intelligence.io.solutions/api",
    "hpc-ai": "https://api.hpc-ai.com/inference",
    iflowcn: "https://apis.iflow.cn",
    inception: "https://api.inceptionlabs.ai",
    inceptron: "https://api.inceptron.io",
    inference: "https://inference.net",
    jiekou: "https://api.jiekou.ai/openai",
    kilo: "https://api.kilo.ai/api/gateway",
    "kuae-cloud-coding-plan": "https://coding-plan-endpoint.kuaecloud.net",
    llama: "https://api.llama.com/compat",
    lilac: "https://api.getlilac.com",
    llmgateway: "https://api.llmgateway.io",
    llmtr: "https://llmtr.com",
    lucidquery: "https://api.lucidquery.com",
    meganova: "https://api.meganova.ai",
    mixlayer: "https://models.mixlayer.ai",
    moark: "https://moark.com",
    modelscope: "https://api-inference.modelscope.cn",
    moonshotai: "https://api.moonshot.ai",
    "moonshotai-cn": "https://api.moonshot.cn",
    morph: "https://api.morphllm.com",
    "nano-gpt": "https://nano-gpt.com/api",
    nearai: "https://cloud-api.near.ai",
    neuralwatt: "https://api.neuralwatt.com",
    nvidia: "https://integrate.api.nvidia.com",
    nebius: "https://api.tokenfactory.nebius.com",
    nova: "https://api.nova.amazon.com",
    "ollama-cloud": "https://ollama.com",
    opencode: "https://opencode.ai/zen",
    "opencode-go": "https://opencode.ai/zen/go",
    openrouter: "https://openrouter.ai/api",
    "novita-ai": "https://api.novita.ai/openai",
    orcarouter: "https://api.orcarouter.ai",
    ovhcloud: "https://oai.endpoints.kepler.ai.cloud.ovh.net",
    poe: "https://api.poe.com",
    poolside: "https://inference.poolside.ai",
    "privatemode-ai": "http://localhost:8080",
    "qihang-ai": "https://api.qhaigc.net",
    "qiniu-ai": "https://api.qnaigc.com",
    "regolo-ai": "https://api.regolo.ai",
    requesty: "https://router.requesty.ai",
    "routing-run": "https://ai.routing.sh",
    sarvam: "https://api.sarvam.ai",
    scaleway: "https://api.scaleway.ai",
    siliconflow: "https://api.siliconflow.com",
    "siliconflow-cn": "https://api.siliconflow.cn",
    stackit: "https://api.openai-compat.model-serving.eu01.onstackit.cloud",
    stepfun: "https://api.stepfun.com",
    "stepfun-ai": "https://api.stepfun.ai/step_plan",
    submodel: "https://llm.submodel.ai",
    synthetic: "https://api.synthetic.new/openai",
    "tencent-coding-plan": "https://api.lkeap.cloud.tencent.com/coding/v3",
    "tencent-tokenhub": "https://tokenhub.tencentmaas.com",
    "the-grid-ai": "https://api.thegrid.ai",
    "umans-ai": "https://api.code.umans.ai",
    "umans-ai-coding-plan": "https://api.code.umans.ai",
    upstage: "https://api.upstage.ai/v1/solar",
    vivgrid: "https://api.vivgrid.com",
    vultr: "https://api.vultrinference.com",
    "wafer.ai": "https://pass.wafer.ai",
    wandb: "https://api.inference.wandb.ai",
    xiaomi: "https://api.xiaomimimo.com",
    "xiaomi-token-plan-ams": "https://token-plan-ams.xiaomimimo.com",
    "xiaomi-token-plan-cn": "https://token-plan-cn.xiaomimimo.com",
    "xiaomi-token-plan-sgp": "https://token-plan-sgp.xiaomimimo.com",
    xpersona: "https://www.xpersona.co",
    zeldoc: "https://api.zeldoc.ai",
    zhipuai: "https://open.bigmodel.cn/api/paas/v4",
    "zhipuai-coding-plan": "https://open.bigmodel.cn/api/coding/paas/v4",
    "zai-coding-plan": "https://api.z.ai/api/coding/paas/v4",
    zenmux: "https://zenmux.ai/api",
  };
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { resolveProviderRegistryEntry } = await import("./dist/provider-registry.js");
const expected = ${JSON.stringify(expected)};
const out = {};
for (const providerId of Object.keys(expected)) {
  const entry = await resolveProviderRegistryEntry(providerId);
  out[providerId] = {
    providerAdapter: entry.providerAdapter,
    runtimeSupported: entry.runtimeSupported,
    baseUrl: entry.baseUrl,
    compatibilityMode: entry.compatibilityMode,
  };
}
console.log(JSON.stringify(out));`,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MODELS_DEV_API_URL: "data:application/json,{}",
      },
      encoding: "utf8",
    },
  );
  const entries = JSON.parse(output);

  for (const [providerId, baseUrl] of Object.entries(expected)) {
    assert.equal(entries[providerId]?.providerAdapter, "openai-compatible", providerId);
    assert.equal(entries[providerId]?.runtimeSupported, true, providerId);
    assert.equal(entries[providerId]?.baseUrl, baseUrl, providerId);
    assert.equal(
      entries[providerId]?.compatibilityMode,
      "chat-completions-bridge",
      providerId,
    );
  }
});

test("OpenCode provider plugin header defaults are mirrored offline", () => {
  const expectedHeaders = {
    anthropic: {
      "anthropic-beta":
        "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
    },
    cerebras: {
      "X-Cerebras-3rd-Party-Integration": "opencode",
    },
    kilo: {
      "HTTP-Referer": "https://opencode.ai/",
      "X-Title": "opencode",
    },
    llmgateway: {
      "HTTP-Referer": "https://opencode.ai/",
      "X-Title": "opencode",
      "X-Source": "opencode",
    },
    nvidia: {
      "HTTP-Referer": "https://opencode.ai/",
      "X-Title": "opencode",
      "X-BILLING-INVOKE-ORIGIN": "OpenCode",
    },
    openrouter: {
      "HTTP-Referer": "https://opencode.ai/",
      "X-Title": "opencode",
    },
    v0: {
      "http-referer": "https://opencode.ai/",
      "x-title": "opencode",
    },
    zenmux: {
      "HTTP-Referer": "https://opencode.ai/",
      "X-Title": "opencode",
    },
  };
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { resolveProviderRegistryEntry } = await import("./dist/provider-registry.js");
const expected = ${JSON.stringify(Object.keys(expectedHeaders))};
const out = {};
for (const providerId of expected) {
  const entry = await resolveProviderRegistryEntry(providerId);
  out[providerId] = entry.providerOptions?.headers ?? {};
}
console.log(JSON.stringify(out));`,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MODELS_DEV_API_URL: "data:application/json,{}",
      },
      encoding: "utf8",
    },
  );
  const entries = JSON.parse(output);

  for (const [providerId, headers] of Object.entries(expectedHeaders)) {
    assert.deepEqual(entries[providerId], headers, providerId);
  }
});

test("OpenCode directory Anthropic-compatible providers have offline runtime defaults", () => {
  const expected = {
    freemodel: "https://cc.freemodel.dev",
    "kimi-for-coding": "https://api.kimi.com/coding",
    minimax: "https://api.minimax.io/anthropic",
    "minimax-cn": "https://api.minimaxi.com/anthropic",
    "minimax-cn-coding-plan": "https://api.minimaxi.com/anthropic",
    "minimax-coding-plan": "https://api.minimax.io/anthropic",
  };
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { resolveProviderRegistryEntry } = await import("./dist/provider-registry.js");
const expected = ${JSON.stringify(expected)};
const out = {};
for (const providerId of Object.keys(expected)) {
  const entry = await resolveProviderRegistryEntry(providerId);
  out[providerId] = {
    providerAdapter: entry.providerAdapter,
    runtimeSupported: entry.runtimeSupported,
    baseUrl: entry.baseUrl,
  };
}
console.log(JSON.stringify(out));`,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MODELS_DEV_API_URL: "data:application/json,{}",
      },
      encoding: "utf8",
    },
  );
  const entries = JSON.parse(output);

  for (const [providerId, baseUrl] of Object.entries(expected)) {
    assert.equal(entries[providerId]?.providerAdapter, "anthropic", providerId);
    assert.equal(entries[providerId]?.runtimeSupported, true, providerId);
    assert.equal(entries[providerId]?.baseUrl, baseUrl, providerId);
  }
});

test("OpenCode directory native providers have offline runtime defaults", () => {
  const expected = {
    gitlab: {
      providerAdapter: "gitlab",
      baseUrl: "https://gitlab.com",
    },
  };
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { resolveProviderRegistryEntry } = await import("./dist/provider-registry.js");
const expected = ${JSON.stringify(expected)};
const out = {};
for (const providerId of Object.keys(expected)) {
  const entry = await resolveProviderRegistryEntry(providerId);
  out[providerId] = {
    providerAdapter: entry.providerAdapter,
    runtimeSupported: entry.runtimeSupported,
    baseUrl: entry.baseUrl,
  };
}
console.log(JSON.stringify(out));`,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MODELS_DEV_API_URL: "data:application/json,{}",
      },
      encoding: "utf8",
    },
  );
  const entries = JSON.parse(output);

  for (const [providerId, expectedEntry] of Object.entries(expected)) {
    assert.equal(
      entries[providerId]?.providerAdapter,
      expectedEntry.providerAdapter,
      providerId,
    );
    assert.equal(entries[providerId]?.runtimeSupported, true, providerId);
    assert.equal(entries[providerId]?.baseUrl, expectedEntry.baseUrl, providerId);
  }
});

test("OpenCode directory resource-templated providers resolve from env offline", () => {
  const expected = {
    azure: "https://az-offline.openai.azure.com/openai",
    "azure-cognitive-services":
      "https://azc-offline.cognitiveservices.azure.com",
    "cloudflare-ai-gateway":
      "https://gateway.ai.cloudflare.com/v1/cf-workers/cf-gateway/openai",
    "cloudflare-workers-ai":
      "https://api.cloudflare.com/client/v4/accounts/cf-workers/ai",
    databricks: "https://dbc.example.com/ai-gateway/mlflow",
    neon: "https://neon.example/ai-gateway/mlflow",
    "snowflake-cortex":
      "https://snowflake-acct.snowflakecomputing.com/api/v2/cortex",
  };
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { resolveProviderRegistryEntry } = await import("./dist/provider-registry.js");
const expected = ${JSON.stringify(expected)};
const out = {};
for (const providerId of Object.keys(expected)) {
  const entry = await resolveProviderRegistryEntry(providerId);
  out[providerId] = {
    providerAdapter: entry.providerAdapter,
    runtimeSupported: entry.runtimeSupported,
    baseUrl: entry.baseUrl,
  };
}
console.log(JSON.stringify(out));`,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MODELS_DEV_API_URL: "data:application/json,{}",
        AZURE_RESOURCE_NAME: "az-offline",
        AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: "azc-offline",
        CLOUDFLARE_ACCOUNT_ID: "cf-workers",
        CLOUDFLARE_GATEWAY_ID: "cf-gateway",
        CLOUDFLARE_API_TOKEN: "cf-gateway-token",
        DATABRICKS_HOST: "https://dbc.example.com",
        NEON_AI_GATEWAY_BASE_URL: "https://neon.example",
        SNOWFLAKE_ACCOUNT: "snowflake-acct",
      },
      encoding: "utf8",
    },
  );
  const entries = JSON.parse(output);

  for (const [providerId, baseUrl] of Object.entries(expected)) {
    assert.equal(entries[providerId]?.providerAdapter, "openai-compatible", providerId);
    assert.equal(entries[providerId]?.runtimeSupported, true, providerId);
    assert.equal(entries[providerId]?.baseUrl, baseUrl, providerId);
  }
});

test("major v0 providers import as enabled runtime accounts offline", () => {
  const providerIds = [
    "deepseek",
    "xiaomi",
    "xiaomi-token-plan-ams",
    "xiaomi-token-plan-cn",
    "xiaomi-token-plan-sgp",
    "neuralwatt",
    "fireworks-ai",
    "firepass",
    "openai",
    "anthropic",
    "google",
  ];
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { resolveProviderRegistryEntry } = await import("./dist/provider-registry.js");
const { accountsFromOpenCodeAuthPayload } = await import("./dist/opencode-auth.js");
const providerIds = ${JSON.stringify(providerIds)};
const payload = Object.fromEntries(providerIds.map((id) => [id, { apiKey: id + "-key" }]));
const accounts = await accountsFromOpenCodeAuthPayload(payload);
const rows = [];
for (const id of providerIds) {
  const entry = await resolveProviderRegistryEntry(id);
  const account = accounts.find((item) => item.providerId === id || item.id.includes(id));
  rows.push({
    id,
    providerAdapter: entry.providerAdapter,
    runtimeSupported: entry.runtimeSupported,
    baseUrl: entry.baseUrl,
    imported: Boolean(account),
    enabled: Boolean(account?.enabled),
  });
}
console.log(JSON.stringify(rows));`,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MODELS_DEV_API_URL: "data:application/json,{}",
      },
      encoding: "utf8",
    },
  );
  const rows = JSON.parse(output);

  const expectedAdapters = {
    deepseek: "openai-compatible",
    xiaomi: "openai-compatible",
    "xiaomi-token-plan-ams": "openai-compatible",
    "xiaomi-token-plan-cn": "openai-compatible",
    "xiaomi-token-plan-sgp": "openai-compatible",
    neuralwatt: "openai-compatible",
    "fireworks-ai": "openai-compatible",
    firepass: "openai-compatible",
    openai: "openai-compatible",
    anthropic: "anthropic",
    google: "google",
  };

  for (const row of rows) {
    assert.equal(row.providerAdapter, expectedAdapters[row.id], row.id);
    assert.equal(row.runtimeSupported, true, row.id);
    assert.equal(row.imported, true, row.id);
    assert.equal(row.enabled, true, row.id);
    assert.ok(row.baseUrl, row.id);
  }
});

test("built-in registry entries preserve Models.dev model metadata", () => {
  const api = `data:application/json,${encodeURIComponent(JSON.stringify({
    anthropic: {
      id: "anthropic",
      name: "Anthropic from Models.dev",
      npm: "@ai-sdk/anthropic",
      env: ["ANTHROPIC_API_KEY"],
      models: {
        "claude-test": {
          id: "claude-test",
          name: "Claude Test",
          limit: { context: 200000, output: 64000 },
        },
      },
    },
  }))}`;
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { resolveProviderRegistryEntry } = await import("./dist/provider-registry.js");
const entry = await resolveProviderRegistryEntry("anthropic");
console.log(JSON.stringify({
  providerAdapter: entry.providerAdapter,
  baseUrl: entry.baseUrl,
  providerSource: entry.providerSource,
  models: Object.keys(entry.models ?? {}),
  modelsCount: entry.modelsCount
}));`,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, MODELS_DEV_API_URL: api },
      encoding: "utf8",
    },
  );
  const entry = JSON.parse(output);

  assert.equal(entry.providerAdapter, "anthropic");
  assert.equal(entry.baseUrl, "https://api.anthropic.com");
  assert.equal(entry.providerSource, "builtin");
  assert.deepEqual(entry.models, ["claude-test"]);
  assert.equal(entry.modelsCount, 1);
});

test("Ollama is available as an auth-free local OpenAI-compatible provider", async () => {
  const entry = await resolveProviderRegistryEntry("ollama");

  assert.equal(entry.provider, "openai-compatible");
  assert.equal(entry.providerAdapter, "openai-compatible");
  assert.equal(entry.baseUrl, "http://127.0.0.1:11434");
  assert.equal(entry.authType, "none");
  assert.deepEqual(entry.tokenEnv, []);
  assert.equal(entry.runtimeSupported, true);
  assert.equal(entry.upstreamMode, "chat/completions");
  assert.equal(entry.compatibilityMode, "chat-completions-bridge");
});

test("OpenCode local provider config imports without auth.json credentials", async () => {
  const providerConfig = providerConfigFromOpenCodeConfigPayload(
    parseOpenCodeConfigPayload(`{
      "provider": {
        "ollama": {
          "npm": "@ai-sdk/openai-compatible",
          "name": "Ollama (local)",
          "options": {
            "baseURL": "http://127.0.0.1:11434/v1"
          },
          "models": {
            "gpt-oss:20b": {
              "name": "gpt-oss 20B"
            }
          }
        }
      }
    }`),
  );
  const accounts = await accountsFromOpenCodeAuthPayload(
    {},
    { providerConfig },
  );
  const ollama = accounts.find((account) => account.providerId === "ollama");

  assert.equal(ollama?.provider, "openai-compatible");
  assert.equal(ollama?.providerAdapter, "openai-compatible");
  assert.equal(ollama?.providerLabel, "Ollama (local)");
  assert.equal(ollama?.baseUrl, "http://127.0.0.1:11434");
  assert.equal(ollama?.accessToken, NO_AUTH_ACCESS_TOKEN);
  assert.equal(ollama?.providerAuthType, "none");
  assert.equal(ollama?.enabled, true);
  assert.ok(ollama?.providerModels?.["gpt-oss:20b"]);
});

test("OpenCode local Models.dev providers import without optional token env credentials", async () => {
  const previousToken = process.env.ATOMIC_CHAT_API_KEY;
  delete process.env.ATOMIC_CHAT_API_KEY;
  try {
    const registry = providerRegistryEntryFromMetadata("atomic-chat", {
      id: "atomic-chat",
      name: "Atomic Chat",
      npm: "@ai-sdk/openai-compatible",
      api: "http://127.0.0.1:1337/v1",
      env: ["ATOMIC_CHAT_API_KEY"],
      models: {
        "gemma-local": { name: "Gemma Local" },
      },
    });

    assert.equal(registry.authType, "none");
    assert.equal(registry.runtimeSupported, true);

    const accounts = await accountsFromOpenCodeAuthPayload(
      {},
      { providerConfig: new Map([["atomic-chat", registry]]) },
    );
    const atomic = accounts.find((account) => account.providerId === "atomic-chat");

    assert.equal(atomic?.provider, "openai-compatible");
    assert.equal(atomic?.providerAdapter, "openai-compatible");
    assert.equal(atomic?.baseUrl, "http://127.0.0.1:1337");
    assert.equal(atomic?.accessToken, NO_AUTH_ACCESS_TOKEN);
    assert.equal(atomic?.providerAuthType, "none");
    assert.equal(atomic?.enabled, true);
    assert.ok(atomic?.providerModels?.["gemma-local"]);
  } finally {
    if (previousToken === undefined) delete process.env.ATOMIC_CHAT_API_KEY;
    else process.env.ATOMIC_CHAT_API_KEY = previousToken;
  }
});

test("OpenCode local Models.dev providers still honor configured token env secrets", async () => {
  const previousToken = process.env.ATOMIC_CHAT_API_KEY;
  process.env.ATOMIC_CHAT_API_KEY = "atomic-local-token";
  try {
    const registry = providerRegistryEntryFromMetadata("atomic-chat", {
      id: "atomic-chat",
      name: "Atomic Chat",
      npm: "@ai-sdk/openai-compatible",
      api: "http://127.0.0.1:1337/v1",
      env: ["ATOMIC_CHAT_API_KEY"],
      models: {
        "gemma-local": { name: "Gemma Local" },
      },
    });

    assert.equal(registry.authType, "api-key");

    const accounts = await accountsFromOpenCodeAuthPayload(
      {},
      { providerConfig: new Map([["atomic-chat", registry]]) },
    );
    const atomic = accounts.find((account) => account.providerId === "atomic-chat");

    assert.equal(atomic?.accessToken, "atomic-local-token");
    assert.equal(atomic?.providerAuthType, "api-key");
    assert.equal(atomic?.enabled, true);
  } finally {
    if (previousToken === undefined) delete process.env.ATOMIC_CHAT_API_KEY;
    else process.env.ATOMIC_CHAT_API_KEY = previousToken;
  }
});

test("Cloudflare AI Gateway registry metadata stays OpenAI-compatible when endpoint env is missing", () => {
  const entry = providerRegistryEntryFromMetadata("cloudflare-ai-gateway", {
    id: "cloudflare-ai-gateway",
    name: "Cloudflare AI Gateway",
    npm: "ai-gateway-provider",
    env: [
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_GATEWAY_ID",
    ],
    models: {
      "openai/gpt-5.1": { name: "GPT 5.1 through Cloudflare" },
    },
  });

  assert.equal(entry.provider, "openai-compatible");
  assert.equal(entry.providerAdapter, "openai-compatible");
  assert.equal(entry.runtimeSupported, false);
  assert.equal(entry.baseUrl, undefined);
  assert.equal(entry.upstreamMode, "chat/completions");
  assert.equal(entry.compatibilityMode, "chat-completions-bridge");
  assert.deepEqual(entry.tokenEnv, [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_GATEWAY_ID",
  ]);
  assert.ok(entry.models?.["openai/gpt-5.1"]);
});

test("OpenCode auth import derives Cloudflare endpoints from credential metadata", async () => {
  const gatewayRegistry = providerRegistryEntryFromMetadata("cloudflare-ai-gateway", {
    id: "cloudflare-ai-gateway",
    name: "Cloudflare AI Gateway",
    npm: "ai-gateway-provider",
    models: {
      "openai/gpt-5.1": { name: "GPT 5.1 through Cloudflare" },
    },
  });
  const workersRegistry = providerRegistryEntryFromMetadata("cloudflare-workers-ai", {
    id: "cloudflare-workers-ai",
    name: "Cloudflare Workers AI",
    npm: "@ai-sdk/openai-compatible",
    models: {
      "@cf/moonshotai/kimi-k2.6": { name: "Kimi K2.6" },
    },
  });

  const accounts = await accountsFromOpenCodeAuthPayload(
    {
      "cloudflare-ai-gateway": {
        type: "api",
        key: "cf-gateway-token",
        metadata: {
          accountId: "cf-account",
          gatewayId: "team-gateway",
        },
      },
      "cloudflare-workers-ai": {
        type: "api",
        key: "cf-workers-token",
        metadata: {
          accountId: "cf-workers-account",
          gatewayId: "workers-gateway",
        },
      },
    },
    {
      providerConfig: new Map([
        ["cloudflare-ai-gateway", gatewayRegistry],
        ["cloudflare-workers-ai", workersRegistry],
      ]),
    },
  );
  const byId = new Map(accounts.map((account) => [account.providerId, account]));

  assert.equal(byId.get("cloudflare-ai-gateway")?.provider, "openai-compatible");
  assert.equal(
    byId.get("cloudflare-ai-gateway")?.baseUrl,
    "https://gateway.ai.cloudflare.com/v1/cf-account/team-gateway/openai",
  );
  assert.deepEqual(
    byId.get("cloudflare-ai-gateway")?.providerOptions,
    { gatewayId: "team-gateway" },
  );
  assert.equal(byId.get("cloudflare-ai-gateway")?.accessToken, "cf-gateway-token");
  assert.equal(byId.get("cloudflare-ai-gateway")?.enabled, true);
  assert.ok(byId.get("cloudflare-ai-gateway")?.providerModels?.["openai/gpt-5.1"]);

  assert.equal(byId.get("cloudflare-workers-ai")?.provider, "openai-compatible");
  assert.equal(
    byId.get("cloudflare-workers-ai")?.baseUrl,
    "https://api.cloudflare.com/client/v4/accounts/cf-workers-account/ai",
  );
  assert.deepEqual(
    byId.get("cloudflare-workers-ai")?.providerOptions,
    { gatewayId: "workers-gateway" },
  );
  assert.equal(byId.get("cloudflare-workers-ai")?.accessToken, "cf-workers-token");
  assert.equal(byId.get("cloudflare-workers-ai")?.enabled, true);
  assert.ok(byId.get("cloudflare-workers-ai")?.providerModels?.["@cf/moonshotai/kimi-k2.6"]);
});

test("OpenCode config preserves Cloudflare AI Gateway REST endpoint gateway options", async () => {
  const previous = {
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
  };
  process.env.CLOUDFLARE_ACCOUNT_ID = "cf-account";
  try {
    const payload = parseOpenCodeConfigPayload(`{
      "provider": {
        "cloudflare-ai-gateway": {
          "npm": "@ai-sdk/openai-compatible",
          "options": {
            "baseURL": "https://api.cloudflare.com/client/v4/accounts/{env:CLOUDFLARE_ACCOUNT_ID}/ai/v1",
            "gatewayId": "team-gateway",
            "apiKey": "cf-rest-token"
          },
          "models": {
            "openai/gpt-5.1": { "name": "GPT 5.1" }
          }
        }
      }
    }`);
    const providerConfig = providerConfigFromOpenCodeConfigPayload(payload);
    const entry = providerConfig.get("cloudflare-ai-gateway");

    assert.equal(entry?.provider, "openai-compatible");
    assert.equal(entry?.providerAdapter, "openai-compatible");
    assert.equal(
      entry?.baseUrl,
      "https://api.cloudflare.com/client/v4/accounts/cf-account/ai",
    );
    assert.deepEqual(entry?.providerOptions, { gatewayId: "team-gateway" });
    assert.equal(entry?.runtimeSupported, true);

    const accounts = await accountsFromOpenCodeAuthPayload(
      { "cloudflare-ai-gateway": {} },
      {
        providerConfig,
        providerConfigSecrets: providerSecretsFromOpenCodeConfigPayload(payload),
      },
    );
    const gateway = accounts.find(
      (account) => account.providerId === "cloudflare-ai-gateway",
    );

    assert.equal(gateway?.provider, "openai-compatible");
    assert.equal(gateway?.providerAdapter, "openai-compatible");
    assert.equal(
      gateway?.baseUrl,
      "https://api.cloudflare.com/client/v4/accounts/cf-account/ai",
    );
    assert.deepEqual(gateway?.providerOptions, { gatewayId: "team-gateway" });
    assert.equal(gateway?.accessToken, "cf-rest-token");
    assert.equal(gateway?.enabled, true);
    assert.ok(gateway?.providerModels?.["openai/gpt-5.1"]);
  } finally {
    if (previous.CLOUDFLARE_ACCOUNT_ID === undefined) {
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
    } else {
      process.env.CLOUDFLARE_ACCOUNT_ID = previous.CLOUDFLARE_ACCOUNT_ID;
    }
  }
});

test("OpenCode config imports Cloudflare Workers AI account and gateway options", async () => {
  const previous = {
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_GATEWAY_ID: process.env.CLOUDFLARE_GATEWAY_ID,
  };
  process.env.CLOUDFLARE_ACCOUNT_ID = "cf-account";
  process.env.CLOUDFLARE_GATEWAY_ID = "env-gateway";
  try {
    const envEntry = providerRegistryEntryFromMetadata("cloudflare-workers-ai", {
      id: "cloudflare-workers-ai",
      name: "Cloudflare Workers AI",
      npm: "@ai-sdk/openai-compatible",
    });
    assert.equal(
      envEntry.baseUrl,
      "https://api.cloudflare.com/client/v4/accounts/cf-account/ai",
    );
    assert.deepEqual(envEntry.providerOptions, { gatewayId: "env-gateway" });

    const payload = parseOpenCodeConfigPayload(`{
      "provider": {
        "cloudflare-workers-ai": {
          "npm": "@ai-sdk/openai-compatible",
          "options": {
            "accountId": "{env:CLOUDFLARE_ACCOUNT_ID}",
            "gatewayId": "team-gateway",
            "apiKey": "cf-workers-token"
          },
          "models": {
            "@cf/moonshotai/kimi-k2.6": { "name": "Kimi K2.6" }
          }
        }
      }
    }`);
    const providerConfig = providerConfigFromOpenCodeConfigPayload(payload);
    const entry = providerConfig.get("cloudflare-workers-ai");

    assert.equal(entry?.provider, "openai-compatible");
    assert.equal(entry?.providerAdapter, "openai-compatible");
    assert.equal(
      entry?.baseUrl,
      "https://api.cloudflare.com/client/v4/accounts/cf-account/ai",
    );
    assert.deepEqual(entry?.providerOptions, { gatewayId: "team-gateway" });
    assert.equal(entry?.runtimeSupported, true);

    const accounts = await accountsFromOpenCodeAuthPayload(
      { "cloudflare-workers-ai": {} },
      {
        providerConfig,
        providerConfigSecrets: providerSecretsFromOpenCodeConfigPayload(payload),
      },
    );
    const workers = accounts.find(
      (account) => account.providerId === "cloudflare-workers-ai",
    );

    assert.equal(workers?.provider, "openai-compatible");
    assert.equal(workers?.providerAdapter, "openai-compatible");
    assert.equal(
      workers?.baseUrl,
      "https://api.cloudflare.com/client/v4/accounts/cf-account/ai",
    );
    assert.deepEqual(workers?.providerOptions, { gatewayId: "team-gateway" });
    assert.equal(workers?.accessToken, "cf-workers-token");
    assert.equal(workers?.enabled, true);
    assert.ok(workers?.providerModels?.["@cf/moonshotai/kimi-k2.6"]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Azure registry metadata stays OpenAI-compatible when resource env is missing", () => {
  const entry = providerRegistryEntryFromMetadata("azure", {
    id: "azure",
    name: "Azure",
    npm: "@ai-sdk/azure",
    env: ["AZURE_RESOURCE_NAME", "AZURE_API_KEY"],
    models: {
      "gpt-5.1-prod": { name: "GPT 5.1 Azure deployment" },
    },
  });

  assert.equal(entry.provider, "openai-compatible");
  assert.equal(entry.providerAdapter, "openai-compatible");
  assert.equal(entry.runtimeSupported, false);
  assert.equal(entry.baseUrl, undefined);
  assert.equal(entry.upstreamMode, "responses");
  assert.equal(entry.compatibilityMode, "responses");
  assert.deepEqual(entry.tokenEnv, ["AZURE_RESOURCE_NAME", "AZURE_API_KEY"]);
  assert.ok(entry.models?.["gpt-5.1-prod"]);
});

test("Azure OpenAI directory provider resolves to OpenAI-compatible responses route", async () => {
  const entry = await resolveProviderRegistryEntry("azure-openai");

  assert.equal(entry.id, "azure");
  assert.equal(entry.providerId, "azure");
  assert.equal(entry.provider, "openai-compatible");
  assert.equal(entry.providerAdapter, "openai-compatible");
  assert.equal(entry.runtimeSupported, false);
  assert.equal(entry.baseUrl, undefined);
  assert.equal(entry.upstreamMode, "responses");
  assert.equal(entry.compatibilityMode, "responses");
  assert.deepEqual(entry.tokenEnv, ["AZURE_RESOURCE_NAME", "AZURE_API_KEY"]);
});

test("Azure Cognitive Services directory provider derives cognitive services endpoint", () => {
  const entry = providerRegistryEntryFromMetadata("azure-cognitive-services", {
    id: "azure-cognitive-services",
    name: "Azure Cognitive Services",
    npm: "@ai-sdk/azure",
    options: {
      resourceName: "azc-resource",
    },
    env: [
      "AZURE_COGNITIVE_SERVICES_RESOURCE_NAME",
      "AZURE_COGNITIVE_SERVICES_API_KEY",
    ],
    models: {
      "gpt-5.1-prod": { name: "GPT 5.1 Prod" },
    },
  });

  assert.equal(entry.providerAdapter, "openai-compatible");
  assert.equal(entry.baseUrl, "https://azc-resource.cognitiveservices.azure.com");
  assert.equal(entry.upstreamMode, "responses");
  assert.equal(entry.compatibilityMode, "responses");
  assert.equal(entry.runtimeSupported, true);
});

test("OpenCode auth import derives Azure endpoint from credential metadata", async () => {
  const accounts = await accountsFromOpenCodeAuthPayload({
    azure: {
      type: "key",
      key: "az-test-key",
      metadata: {
        resourceName: "az-auth-resource",
      },
    },
  });
  const azure = accounts.find(
    (account) =>
      account.providerId === "azure" &&
      account.providerAdapter === "openai-compatible",
  );

  assert.equal(azure?.provider, "openai-compatible");
  assert.equal(azure?.providerAdapter, "openai-compatible");
  assert.equal(azure?.baseUrl, "https://az-auth-resource.openai.azure.com/openai");
  assert.equal(azure?.upstreamMode, "responses");
  assert.equal(azure?.compatibilityMode, "responses");
  assert.equal(azure?.accessToken, "az-test-key");
  assert.equal(azure?.enabled, true);
});

test("OpenCode config imports custom Azure SDK providers with resource metadata", async () => {
  const payload = parseOpenCodeConfigPayload(`{
    "provider": {
      "custom-azure": {
        "npm": "@ai-sdk/azure",
        "options": {
          "resourceName": "custom-az-resource",
          "apiKey": "custom-az-key"
        },
        "models": {
          "gpt-5.1-prod": { "name": "GPT 5.1 Azure deployment" }
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
  const azure = accounts.find(
    (account) =>
      account.providerId === "custom-azure" &&
      account.providerAdapter === "openai-compatible",
  );

  assert.equal(azure?.provider, "openai-compatible");
  assert.equal(azure?.baseUrl, "https://custom-az-resource.openai.azure.com/openai");
  assert.equal(azure?.upstreamMode, "responses");
  assert.equal(azure?.compatibilityMode, "responses");
  assert.equal(azure?.accessToken, "custom-az-key");
  assert.equal(azure?.enabled, true);
  assert.ok(azure?.providerModels?.["gpt-5.1-prod"]);
});

test("OpenCode auth import splits model-level provider overrides into virtual accounts", async () => {
  const previous = {
    AZURE_COGNITIVE_SERVICES_RESOURCE_NAME:
      process.env.AZURE_COGNITIVE_SERVICES_RESOURCE_NAME,
    AZURE_COGNITIVE_SERVICES_API_KEY:
      process.env.AZURE_COGNITIVE_SERVICES_API_KEY,
  };
  process.env.AZURE_COGNITIVE_SERVICES_RESOURCE_NAME = "azc-resource";
  process.env.AZURE_COGNITIVE_SERVICES_API_KEY = "azc-key";
  try {
    const registry = providerRegistryEntryFromMetadata(
      "azure-cognitive-services",
      {
        id: "azure-cognitive-services",
        name: "Azure Cognitive Services",
        npm: "@ai-sdk/azure",
        env: [
          "AZURE_COGNITIVE_SERVICES_RESOURCE_NAME",
          "AZURE_COGNITIVE_SERVICES_API_KEY",
        ],
        models: {
          "gpt-5.1-prod": { id: "gpt-5.1-prod", name: "GPT 5.1" },
          "claude-sonnet-4-5": {
            id: "claude-sonnet-4-5",
            name: "Claude Sonnet 4.5",
            provider: {
              npm: "@ai-sdk/anthropic",
              api: "https://${AZURE_COGNITIVE_SERVICES_RESOURCE_NAME}.services.ai.azure.com/anthropic/v1",
            },
          },
        },
      },
    );

    const accounts = await accountsFromOpenCodeAuthPayload(
      { "azure-cognitive-services": {} },
      { providerConfig: new Map([["azure-cognitive-services", registry]]) },
    );
    const parent = accounts.find(
      (account) =>
        account.providerId === "azure-cognitive-services" &&
        account.providerAdapter === "openai-compatible",
    );
    const anthropic = accounts.find(
      (account) =>
        account.providerId === "azure-cognitive-services" &&
        account.providerAdapter === "anthropic",
    );

    assert.equal(parent?.baseUrl, "https://azc-resource.cognitiveservices.azure.com");
    assert.equal(parent?.accessToken, "azc-key");
    assert.equal(parent?.enabled, true);
    assert.ok(parent?.providerModels?.["gpt-5.1-prod"]);
    assert.equal(parent?.providerModels?.["claude-sonnet-4-5"], undefined);

    assert.equal(anthropic?.provider, "anthropic");
    assert.equal(anthropic?.baseUrl, "https://azc-resource.services.ai.azure.com/anthropic");
    assert.equal(anthropic?.accessToken, "azc-key");
    assert.equal(anthropic?.enabled, true);
    assert.ok(anthropic?.providerModels?.["claude-sonnet-4-5"]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("OpenCode auth import derives Google Vertex endpoint for MaaS model overrides", async () => {
  const previous = {
    GOOGLE_VERTEX_PROJECT: process.env.GOOGLE_VERTEX_PROJECT,
    GOOGLE_VERTEX_LOCATION: process.env.GOOGLE_VERTEX_LOCATION,
    GOOGLE_VERTEX_ENDPOINT: process.env.GOOGLE_VERTEX_ENDPOINT,
    GOOGLE_VERTEX_ACCESS_TOKEN: process.env.GOOGLE_VERTEX_ACCESS_TOKEN,
  };
  process.env.GOOGLE_VERTEX_PROJECT = "vertex-project";
  process.env.GOOGLE_VERTEX_LOCATION = "us-central1";
  process.env.GOOGLE_VERTEX_ACCESS_TOKEN = "vertex-token";
  delete process.env.GOOGLE_VERTEX_ENDPOINT;
  try {
    const registry = providerRegistryEntryFromMetadata("google-vertex", {
      id: "google-vertex",
      name: "Vertex",
      npm: "@ai-sdk/google-vertex",
      env: [
        "GOOGLE_VERTEX_PROJECT",
        "GOOGLE_VERTEX_LOCATION",
        "GOOGLE_APPLICATION_CREDENTIALS",
      ],
      models: {
        "moonshotai/kimi-k2-thinking-maas": {
          id: "moonshotai/kimi-k2-thinking-maas",
          name: "Kimi K2 Thinking MaaS",
          provider: {
            npm: "@ai-sdk/openai-compatible",
            api: "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}/endpoints/openapi",
          },
        },
      },
    });

    const accounts = await accountsFromOpenCodeAuthPayload(
      { "google-vertex": {} },
      { providerConfig: new Map([["google-vertex", registry]]) },
    );
    const maas = accounts.find(
      (account) =>
        account.providerId === "google-vertex" &&
        account.providerAdapter === "openai-compatible",
    );

    assert.equal(maas?.provider, "openai-compatible");
    assert.equal(
      maas?.baseUrl,
      "https://us-central1-aiplatform.googleapis.com/v1/projects/vertex-project/locations/us-central1/endpoints/openapi",
    );
    assert.equal(maas?.accessToken, "vertex-token");
    assert.equal(maas?.enabled, true);
    assert.ok(maas?.providerModels?.["moonshotai/kimi-k2-thinking-maas"]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("OpenCode auth import routes Amazon Bedrock Mantle model overrides through Responses", async () => {
  const previous = {
    AWS_REGION: process.env.AWS_REGION,
    AWS_BEARER_TOKEN_BEDROCK: process.env.AWS_BEARER_TOKEN_BEDROCK,
  };
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_BEARER_TOKEN_BEDROCK = "bedrock-api-key";
  try {
    const registry = providerRegistryEntryFromMetadata("amazon-bedrock", {
      id: "amazon-bedrock",
      name: "Amazon Bedrock",
      npm: "@ai-sdk/amazon-bedrock",
      env: ["AWS_BEARER_TOKEN_BEDROCK", "AWS_REGION"],
      models: {
        "anthropic.claude-3-5-sonnet-20241022-v2:0": {
          id: "anthropic.claude-3-5-sonnet-20241022-v2:0",
          name: "Claude 3.5 Sonnet",
        },
        "openai.gpt-oss-120b": {
          id: "openai.gpt-oss-120b",
          name: "GPT OSS 120B",
          provider: {
            npm: "@ai-sdk/amazon-bedrock/mantle",
            api: "https://bedrock-mantle.${AWS_REGION}.api.aws/v1",
            shape: "responses",
          },
        },
      },
    });

    const accounts = await accountsFromOpenCodeAuthPayload(
      { "amazon-bedrock": {} },
      { providerConfig: new Map([["amazon-bedrock", registry]]) },
    );
    const parent = accounts.find(
      (account) =>
        account.providerId === "amazon-bedrock" &&
        account.providerAdapter === "amazon-bedrock",
    );
    const mantle = accounts.find(
      (account) =>
        account.providerId === "amazon-bedrock" &&
        account.providerAdapter === "openai-compatible",
    );

    assert.ok(parent?.providerModels?.["anthropic.claude-3-5-sonnet-20241022-v2:0"]);
    assert.equal(parent?.providerModels?.["openai.gpt-oss-120b"], undefined);

    assert.equal(mantle?.provider, "openai-compatible");
    assert.equal(mantle?.baseUrl, "https://bedrock-mantle.us-east-1.api.aws");
    assert.equal(mantle?.upstreamMode, "responses");
    assert.equal(mantle?.compatibilityMode, "responses");
    assert.equal(mantle?.accessToken, "bedrock-api-key");
    assert.equal(mantle?.enabled, true);
    assert.ok(mantle?.providerModels?.["openai.gpt-oss-120b"]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("OpenCode auth import keeps Cloudflare AI Gateway no-api provider hints on the parent account", async () => {
  const previous = {
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_GATEWAY_ID: process.env.CLOUDFLARE_GATEWAY_ID,
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
  };
  process.env.CLOUDFLARE_ACCOUNT_ID = "cf-account";
  process.env.CLOUDFLARE_GATEWAY_ID = "cf-gateway";
  process.env.CLOUDFLARE_API_TOKEN = "cf-token";
  try {
    const registry = providerRegistryEntryFromMetadata("cloudflare-ai-gateway", {
      id: "cloudflare-ai-gateway",
      name: "Cloudflare AI Gateway",
      npm: "ai-gateway-provider",
      env: [
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_GATEWAY_ID",
      ],
      models: {
        "anthropic/claude-opus-4-7": {
          id: "anthropic/claude-opus-4-7",
          name: "Claude Opus 4.7",
          provider: {
            npm: "@ai-sdk/anthropic",
          },
        },
      },
    });

    const accounts = await accountsFromOpenCodeAuthPayload(
      { "cloudflare-ai-gateway": {} },
      { providerConfig: new Map([["cloudflare-ai-gateway", registry]]) },
    );
    const parent = accounts.find(
      (account) =>
        account.providerId === "cloudflare-ai-gateway" &&
        account.providerAdapter === "openai-compatible",
    );
    const anthropic = accounts.find(
      (account) =>
        account.providerId === "cloudflare-ai-gateway" &&
        account.providerAdapter === "anthropic",
    );

    assert.equal(anthropic, undefined);
    assert.equal(
      parent?.baseUrl,
      "https://gateway.ai.cloudflare.com/v1/cf-account/cf-gateway/openai",
    );
    assert.ok(parent?.providerModels?.["anthropic/claude-opus-4-7"]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Snowflake Cortex provider metadata expands account env templates and token env aliases", () => {
  const previous = {
    SNOWFLAKE_ACCOUNT: process.env.SNOWFLAKE_ACCOUNT,
  };
  process.env.SNOWFLAKE_ACCOUNT = "acme-test";
  try {
    const entry = providerConfigFromOpenCodeConfigPayload(
      parseOpenCodeConfigPayload(`{
        "provider": {
          "snowflake-cortex": {
            "npm": "@ai-sdk/openai-compatible",
            "options": {
              "baseURL": "https://\${SNOWFLAKE_ACCOUNT}.snowflakecomputing.com/api/v2/cortex"
            },
            "models": {
              "claude-sonnet-4-5": { "name": "Claude Sonnet 4.5" }
            }
          }
        }
      }`),
    ).get("snowflake-cortex");

    assert.equal(entry?.provider, "openai-compatible");
    assert.equal(entry?.providerAdapter, "openai-compatible");
    assert.equal(
      entry?.baseUrl,
      "https://acme-test.snowflakecomputing.com/api/v2/cortex",
    );
    assert.equal(entry?.upstreamMode, "chat/completions");
    assert.equal(entry?.compatibilityMode, "chat-completions-bridge");
    assert.deepEqual(entry?.tokenEnv, [
      "SNOWFLAKE_ACCOUNT",
      "SNOWFLAKE_CORTEX_TOKEN",
      "SNOWFLAKE_CORTEX_PAT",
    ]);
    assert.equal(entry?.runtimeSupported, true);
    assert.ok(entry?.models?.["claude-sonnet-4-5"]);
  } finally {
    if (previous.SNOWFLAKE_ACCOUNT === undefined) delete process.env.SNOWFLAKE_ACCOUNT;
    else process.env.SNOWFLAKE_ACCOUNT = previous.SNOWFLAKE_ACCOUNT;
  }
});

test("OpenCode auth import enables Snowflake Cortex through env PAT/JWT token", async () => {
  const previous = {
    SNOWFLAKE_ACCOUNT: process.env.SNOWFLAKE_ACCOUNT,
    SNOWFLAKE_CORTEX_TOKEN: process.env.SNOWFLAKE_CORTEX_TOKEN,
    SNOWFLAKE_CORTEX_PAT: process.env.SNOWFLAKE_CORTEX_PAT,
  };
  process.env.SNOWFLAKE_ACCOUNT = "acme-test";
  process.env.SNOWFLAKE_CORTEX_TOKEN = "snowflake-env-token";
  delete process.env.SNOWFLAKE_CORTEX_PAT;
  try {
    const payload = parseOpenCodeConfigPayload(`{
      "provider": {
        "snowflake-cortex": {
          "npm": "@ai-sdk/openai-compatible",
          "options": {
            "baseURL": "https://\${SNOWFLAKE_ACCOUNT}.snowflakecomputing.com/api/v2/cortex"
          },
          "models": {
            "claude-sonnet-4-5": { "name": "Claude Sonnet 4.5" }
          }
        }
      }
    }`);
    const accounts = await accountsFromOpenCodeAuthPayload(
      { "snowflake-cortex": {} },
      {
        providerConfig: providerConfigFromOpenCodeConfigPayload(payload),
        providerConfigSecrets: providerSecretsFromOpenCodeConfigPayload(payload),
      },
    );
    const snowflake = accounts.find(
      (account) => account.providerId === "snowflake-cortex",
    );

    assert.equal(snowflake?.provider, "openai-compatible");
    assert.equal(snowflake?.providerAdapter, "openai-compatible");
    assert.equal(
      snowflake?.baseUrl,
      "https://acme-test.snowflakecomputing.com/api/v2/cortex",
    );
    assert.equal(snowflake?.accessToken, "snowflake-env-token");
    assert.equal(snowflake?.enabled, true);
    assert.ok(snowflake?.providerModels?.["claude-sonnet-4-5"]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("OpenCode auth import handles Databricks host env values that include a URL scheme", async () => {
  const previous = {
    DATABRICKS_HOST: process.env.DATABRICKS_HOST,
    DATABRICKS_TOKEN: process.env.DATABRICKS_TOKEN,
  };
  process.env.DATABRICKS_HOST = "https://dbc.example.com";
  process.env.DATABRICKS_TOKEN = "db-token";
  try {
    const registry = providerRegistryEntryFromMetadata("databricks", {
      id: "databricks",
      name: "Databricks",
      npm: "@ai-sdk/openai-compatible",
      api: "https://${DATABRICKS_HOST}/ai-gateway/mlflow/v1",
      env: ["DATABRICKS_HOST", "DATABRICKS_TOKEN"],
      models: {
        "databricks-gpt-5": { name: "GPT-5" },
      },
    });
    assert.equal(
      registry.baseUrl,
      "https://dbc.example.com/ai-gateway/mlflow",
    );
    assert.equal(registry.runtimeSupported, true);

    const accounts = await accountsFromOpenCodeAuthPayload(
      { databricks: {} },
      { providerConfig: new Map([["databricks", registry]]) },
    );
    const databricks = accounts.find(
      (account) => account.providerId === "databricks",
    );

    assert.equal(databricks?.provider, "openai-compatible");
    assert.equal(databricks?.providerAdapter, "openai-compatible");
    assert.equal(
      databricks?.baseUrl,
      "https://dbc.example.com/ai-gateway/mlflow",
    );
    assert.equal(databricks?.accessToken, "db-token");
    assert.equal(databricks?.enabled, true);
    assert.ok(databricks?.providerModels?.["databricks-gpt-5"]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("OpenCode auth import derives env-templated endpoints from credential metadata", async () => {
  const previous = {
    DATABRICKS_HOST: process.env.DATABRICKS_HOST,
    DATABRICKS_TOKEN: process.env.DATABRICKS_TOKEN,
    NEON_AI_GATEWAY_BASE_URL: process.env.NEON_AI_GATEWAY_BASE_URL,
    NEON_AI_GATEWAY_TOKEN: process.env.NEON_AI_GATEWAY_TOKEN,
    SNOWFLAKE_ACCOUNT: process.env.SNOWFLAKE_ACCOUNT,
    SNOWFLAKE_CORTEX_TOKEN: process.env.SNOWFLAKE_CORTEX_TOKEN,
    SNOWFLAKE_CORTEX_PAT: process.env.SNOWFLAKE_CORTEX_PAT,
  };
  for (const key of Object.keys(previous)) delete process.env[key];
  try {
    const accounts = await accountsFromOpenCodeAuthPayload({
      databricks: {
        apiKey: "db-token",
        metadata: {
          DATABRICKS_HOST: "https://dbc.example.com",
        },
      },
      neon: {
        apiKey: "neon-token",
        metadata: {
          NEON_AI_GATEWAY_BASE_URL: "https://neon.example",
        },
      },
      "snowflake-cortex": {
        apiKey: "snowflake-token",
        metadata: {
          SNOWFLAKE_ACCOUNT: "acme-test",
        },
      },
    });
    const byProviderId = new Map(
      accounts.map((account) => [account.providerId, account]),
    );

    assert.equal(
      byProviderId.get("databricks")?.baseUrl,
      "https://dbc.example.com/ai-gateway/mlflow",
    );
    assert.equal(byProviderId.get("databricks")?.accessToken, "db-token");
    assert.equal(byProviderId.get("databricks")?.enabled, true);

    assert.equal(
      byProviderId.get("neon")?.baseUrl,
      "https://neon.example/ai-gateway/mlflow",
    );
    assert.equal(byProviderId.get("neon")?.accessToken, "neon-token");
    assert.equal(byProviderId.get("neon")?.enabled, true);

    assert.equal(
      byProviderId.get("snowflake-cortex")?.baseUrl,
      "https://acme-test.snowflakecomputing.com/api/v2/cortex",
    );
    assert.equal(
      byProviderId.get("snowflake-cortex")?.accessToken,
      "snowflake-token",
    );
    assert.equal(byProviderId.get("snowflake-cortex")?.enabled, true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("OpenCode auth import enables GitHub Copilot OAuth and enterprise routing", async () => {
  const payload = parseOpenCodeConfigPayload(`{
    "provider": {
      "github-copilot": {
        "npm": "@ai-sdk/github-copilot",
        "options": {
          "enterpriseUrl": "https://ghe.example.com"
        },
        "models": {
          "gpt-5.1-codex": { "name": "GPT 5.1 Codex" }
        }
      }
    }
  }`);
  const accounts = await accountsFromOpenCodeAuthPayload(
    {
      "github-copilot": {
        type: "oauth",
        access: "copilot-access-token",
        refresh: "copilot-refresh-token",
        expires: 0,
        enterpriseUrl: "https://ghe.example.com",
      },
    },
    {
      providerConfig: providerConfigFromOpenCodeConfigPayload(payload),
      providerConfigSecrets: providerSecretsFromOpenCodeConfigPayload(payload),
    },
  );
  const copilot = accounts.find((account) => account.providerId === "github-copilot");

  assert.equal(copilot?.providerAdapter, "openai-compatible");
  assert.equal(copilot?.providerNpm, "@ai-sdk/github-copilot");
  assert.equal(copilot?.providerAuthType, "oauth");
  assert.equal(copilot?.accessToken, "copilot-refresh-token");
  assert.equal(copilot?.refreshToken, "copilot-refresh-token");
  assert.equal(copilot?.expiresAt, 0);
  assert.equal(copilot?.baseUrl, "https://copilot-api.ghe.example.com");
  assert.equal(copilot?.providerOptions?.enterpriseUrl, "ghe.example.com");
  assert.equal(copilot?.enabled, true);
  assert.ok(copilot?.providerModels?.["gpt-5.1-codex"]);
});

test("OpenCode auth import enables xAI OAuth through Responses API", async () => {
  const payload = parseOpenCodeConfigPayload(`{
    "provider": {
      "xai": {
        "npm": "@ai-sdk/xai",
        "models": {
          "grok-4": { "name": "Grok 4" }
        }
      }
    }
  }`);
  const accounts = await accountsFromOpenCodeAuthPayload(
    {
      xai: {
        type: "oauth",
        access: "xai-access-token",
        refresh: "xai-refresh-token",
        expires: 1,
      },
    },
    {
      providerConfig: providerConfigFromOpenCodeConfigPayload(payload),
      providerConfigSecrets: providerSecretsFromOpenCodeConfigPayload(payload),
    },
  );
  const xai = accounts.find((account) => account.providerId === "xai");

  assert.equal(xai?.providerAdapter, "openai-compatible");
  assert.equal(xai?.providerNpm, "@ai-sdk/xai");
  assert.equal(xai?.providerAuthType, "oauth");
  assert.equal(xai?.accessToken, "xai-access-token");
  assert.equal(xai?.refreshToken, "xai-refresh-token");
  assert.equal(xai?.expiresAt, 1);
  assert.equal(xai?.baseUrl, "https://api.x.ai");
  assert.equal(xai?.upstreamMode, "responses");
  assert.equal(xai?.compatibilityMode, "responses");
  assert.equal(xai?.enabled, true);
  assert.ok(xai?.providerModels?.["grok-4"]);
});

test("OpenCode auth import surfaces DigitalOcean cached inference routers", async () => {
  const accounts = await accountsFromOpenCodeAuthPayload({
    digitalocean: {
      type: "api",
      key: "do-model-access-key",
      metadata: {
        routers: JSON.stringify([
          {
            name: "my-router",
            uuid: "11f1499a-aaaa-bbbb-cccc-4e013e2ddde4",
            description: "Route to the best model",
          },
          {
            name: "other-router",
            uuid: "22f1499a-aaaa-bbbb-cccc-4e013e2ddde4",
          },
        ]),
        routers_fetched_at: String(Date.now()),
        oauth_access: "doo_v1_test",
        oauth_expires: String(Date.now() + 60 * 60 * 1000),
      },
    },
  });

  const digitalocean = accounts.find((account) => account.providerId === "digitalocean");
  assert.equal(digitalocean?.providerAdapter, "openai-compatible");
  assert.equal(digitalocean?.baseUrl, "https://inference.do-ai.run");
  assert.equal(digitalocean?.enabled, true);
  assert.equal(digitalocean?.providerModels?.["router:my-router"]?.api?.id, "router:my-router");
  assert.equal(digitalocean?.providerModels?.["router:my-router"]?.api?.url, "https://inference.do-ai.run/v1");
  assert.equal(digitalocean?.providerModels?.["router:my-router"]?.api?.npm, "@ai-sdk/openai-compatible");
  assert.equal(digitalocean?.providerModels?.["router:my-router"]?.name, "my-router");
  assert.equal(digitalocean?.providerModels?.["router:my-router"]?.description, "Route to the best model");
  assert.ok(digitalocean?.providerModels?.["router:other-router"]);
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
            "Authorization": "Bearer header-secret",
            "X-Provider-Route": "beta"
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
  assert.deepEqual(byId.get("headergenie")?.providerOptions?.headers, {
    "X-Provider-Route": "beta",
  });
  assert.ok(byId.get("headergenie")?.providerModels?.["glm-5.2"]);
});

test("OpenCode auth import prefers WellKnown token over key", async () => {
  const payload = parseOpenCodeConfigPayload(`{
    "provider": {
      "fhgenie": {
        "npm": "@ai-sdk/openai-compatible",
        "name": "FhGenie",
        "options": {
          "baseURL": "https://fhgenie.example/v1"
        },
        "models": {
          "Kimi-K2-Thinking": { "name": "Kimi K2 Thinking" }
        }
      }
    }
  }`);
  const providerConfig = providerConfigFromOpenCodeConfigPayload(payload);
  const accounts = await accountsFromOpenCodeAuthPayload(
    {
      fhgenie: {
        type: "wellknown",
        key: "fhgenie",
        token: "wellknown-secret-token",
      },
    },
    { providerConfig },
  );
  const fhgenie = accounts.find((account) => account.providerId === "fhgenie");

  assert.equal(fhgenie?.accessToken, "wellknown-secret-token");
  assert.equal(fhgenie?.providerAuthType, "api-key");
  assert.equal(fhgenie?.baseUrl, "https://fhgenie.example");
  assert.equal(fhgenie?.enabled, true);
  assert.ok(fhgenie?.providerModels?.["Kimi-K2-Thinking"]);
});

test("OpenCode config imports ordinary bundled OpenAI-compatible SDK packages", async () => {
  const payload = parseOpenCodeConfigPayload(`{
    "provider": {
      "custom-groq": {
        "npm": "@ai-sdk/groq",
        "options": {
          "baseURL": "https://api.groq.com/openai/v1",
          "apiKey": "groq-secret"
        },
        "models": {
          "llama-3.3-70b-versatile": { "name": "Llama 3.3 70B" }
        }
      },
      "custom-xai": {
        "npm": "@ai-sdk/xai",
        "options": {
          "apiKey": "xai-secret"
        },
        "models": {
          "grok-4": { "name": "Grok 4" }
        }
      },
      "custom-openrouter": {
        "npm": "@openrouter/ai-sdk-provider",
        "options": {
          "apiKey": "openrouter-secret"
        },
        "models": {
          "openai/gpt-5": { "name": "GPT-5" },
          "openai/gpt-5-chat": { "name": "GPT-5 Chat" },
          "gpt-5-chat-latest": { "name": "GPT-5 Chat Latest" }
        }
      },
      "custom-deepinfra": {
        "npm": "@ai-sdk/deepinfra",
        "options": {
          "baseURL": "https://api.deepinfra.com/v1/openai",
          "apiKey": "deepinfra-secret"
        },
        "models": {
          "meta-llama/Meta-Llama-3.1-70B-Instruct": { "name": "Llama 3.1 70B" }
        }
      },
      "custom-cerebras": {
        "npm": "@ai-sdk/cerebras",
        "options": {
          "baseURL": "https://api.cerebras.ai/v1",
          "apiKey": "cerebras-secret"
        },
        "models": {
          "llama3.1-8b": { "name": "Llama 3.1 8B" }
        }
      },
      "custom-together": {
        "npm": "@ai-sdk/togetherai",
        "options": {
          "baseURL": "https://api.together.xyz/v1",
          "apiKey": "together-secret"
        },
        "models": {
          "meta-llama/Llama-3.3-70B-Instruct-Turbo": { "name": "Llama 3.3 70B Turbo" }
        }
      },
      "custom-perplexity": {
        "npm": "@ai-sdk/perplexity",
        "options": {
          "baseURL": "https://api.perplexity.ai",
          "apiKey": "perplexity-secret"
        },
        "models": {
          "sonar-pro": { "name": "Sonar Pro" }
        }
      },
      "custom-venice": {
        "npm": "venice-ai-sdk-provider",
        "options": {
          "apiKey": "venice-secret"
        },
        "models": {
          "llama-3.3-70b": { "name": "Llama 3.3 70B" }
        }
      },
      "custom-alibaba": {
        "npm": "@ai-sdk/alibaba",
        "options": {
          "baseURL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
          "apiKey": "alibaba-secret"
        },
        "models": {
          "qwen-plus": { "name": "Qwen Plus" }
        }
      },
      "custom-vercel-v0": {
        "npm": "@ai-sdk/vercel",
        "options": {
          "apiKey": "vercel-secret"
        },
        "models": {
          "v0-1.5-md": { "name": "v0 1.5 MD" }
        }
      },
      "custom-aihubmix": {
        "npm": "@aihubmix/ai-sdk-provider",
        "options": {
          "apiKey": "aihubmix-secret"
        },
        "models": {
          "gpt-5": { "name": "GPT-5" }
        }
      },
      "custom-merge-gateway": {
        "npm": "merge-gateway-ai-sdk-provider",
        "options": {
          "apiKey": "merge-secret"
        },
        "models": {
          "claude-sonnet-4-5": { "name": "Claude Sonnet 4.5" }
        }
      },
      "custom-responses": {
        "npm": "@ai-sdk/openai",
        "options": {
          "baseURL": "https://responses.example/v1",
          "apiKey": "responses-secret"
        },
        "models": {
          "response-model": { "name": "Response Model" }
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

  assert.equal(byId.get("custom-groq")?.providerAdapter, "openai-compatible");
  assert.equal(byId.get("custom-groq")?.baseUrl, "https://api.groq.com/openai");
  assert.equal(byId.get("custom-groq")?.accessToken, "groq-secret");
  assert.equal(byId.get("custom-groq")?.enabled, true);
  assert.ok(byId.get("custom-groq")?.providerModels?.["llama-3.3-70b-versatile"]);

  assert.equal(byId.get("custom-xai")?.providerAdapter, "openai-compatible");
  assert.equal(byId.get("custom-xai")?.baseUrl, "https://api.x.ai");
  assert.equal(byId.get("custom-xai")?.accessToken, "xai-secret");
  assert.equal(byId.get("custom-xai")?.enabled, true);
  assert.ok(byId.get("custom-xai")?.providerModels?.["grok-4"]);

  assert.equal(byId.get("custom-openrouter")?.providerAdapter, "openai-compatible");
  assert.equal(byId.get("custom-openrouter")?.baseUrl, "https://openrouter.ai/api");
  assert.equal(byId.get("custom-openrouter")?.accessToken, "openrouter-secret");
  assert.equal(byId.get("custom-openrouter")?.enabled, true);
  assert.ok(byId.get("custom-openrouter")?.providerModels?.["openai/gpt-5"]);
  assert.equal(byId.get("custom-openrouter")?.providerModels?.["openai/gpt-5-chat"], undefined);
  assert.equal(byId.get("custom-openrouter")?.providerModels?.["gpt-5-chat-latest"], undefined);

  assert.equal(byId.get("custom-deepinfra")?.providerAdapter, "openai-compatible");
  assert.equal(byId.get("custom-deepinfra")?.baseUrl, "https://api.deepinfra.com/v1/openai");
  assert.equal(byId.get("custom-deepinfra")?.enabled, true);

  assert.equal(byId.get("custom-cerebras")?.providerAdapter, "openai-compatible");
  assert.equal(byId.get("custom-cerebras")?.baseUrl, "https://api.cerebras.ai");
  assert.equal(byId.get("custom-cerebras")?.enabled, true);

  assert.equal(byId.get("custom-together")?.providerAdapter, "openai-compatible");
  assert.equal(byId.get("custom-together")?.baseUrl, "https://api.together.xyz");
  assert.equal(byId.get("custom-together")?.enabled, true);

  assert.equal(byId.get("custom-perplexity")?.providerAdapter, "openai-compatible");
  assert.equal(byId.get("custom-perplexity")?.baseUrl, "https://api.perplexity.ai");
  assert.equal(byId.get("custom-perplexity")?.openAiPathPrefix, "none");
  assert.equal(byId.get("custom-perplexity")?.enabled, true);

  assert.equal(byId.get("custom-venice")?.providerAdapter, "openai-compatible");
  assert.equal(byId.get("custom-venice")?.baseUrl, "https://api.venice.ai/api");
  assert.equal(byId.get("custom-venice")?.accessToken, "venice-secret");
  assert.equal(byId.get("custom-venice")?.enabled, true);
  assert.ok(byId.get("custom-venice")?.providerModels?.["llama-3.3-70b"]);

  assert.equal(byId.get("custom-alibaba")?.providerAdapter, "openai-compatible");
  assert.equal(
    byId.get("custom-alibaba")?.baseUrl,
    "https://dashscope.aliyuncs.com/compatible-mode",
  );
  assert.equal(byId.get("custom-alibaba")?.enabled, true);

  assert.equal(byId.get("custom-vercel-v0")?.providerAdapter, "openai-compatible");
  assert.equal(byId.get("custom-vercel-v0")?.baseUrl, "https://api.v0.dev");
  assert.equal(byId.get("custom-vercel-v0")?.accessToken, "vercel-secret");
  assert.equal(byId.get("custom-vercel-v0")?.enabled, true);
  assert.ok(byId.get("custom-vercel-v0")?.providerModels?.["v0-1.5-md"]);

  assert.equal(byId.get("custom-aihubmix")?.providerAdapter, "openai-compatible");
  assert.equal(byId.get("custom-aihubmix")?.baseUrl, "https://aihubmix.com");
  assert.equal(byId.get("custom-aihubmix")?.accessToken, "aihubmix-secret");
  assert.equal(byId.get("custom-aihubmix")?.enabled, true);
  assert.ok(byId.get("custom-aihubmix")?.providerModels?.["gpt-5"]);

  assert.equal(byId.get("custom-merge-gateway")?.providerAdapter, "openai-compatible");
  assert.equal(
    byId.get("custom-merge-gateway")?.baseUrl,
    "https://api-gateway.merge.dev/v1/openai",
  );
  assert.equal(byId.get("custom-merge-gateway")?.accessToken, "merge-secret");
  assert.equal(byId.get("custom-merge-gateway")?.enabled, true);
  assert.ok(
    byId.get("custom-merge-gateway")?.providerModels?.["claude-sonnet-4-5"],
  );

  assert.equal(byId.get("custom-responses")?.providerAdapter, "openai-compatible");
  assert.equal(byId.get("custom-responses")?.baseUrl, "https://responses.example");
  assert.equal(byId.get("custom-responses")?.accessToken, "responses-secret");
  assert.equal(byId.get("custom-responses")?.upstreamMode, "responses");
  assert.equal(byId.get("custom-responses")?.compatibilityMode, "responses");
  assert.equal(byId.get("custom-responses")?.enabled, true);
  assert.ok(byId.get("custom-responses")?.providerModels?.["response-model"]);
});

test("OpenCode auth import enables OpenAI-compatible SDK providers", async () => {
  const accounts = await accountsFromOpenCodeAuthPayload({
    xai: { apiKey: "xai-key" },
    groq: { apiKey: "groq-key" },
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

test("OpenCode opencode provider imports with public fallback when no API key exists", async () => {
  const previous = process.env.OPENCODE_API_KEY;
  delete process.env.OPENCODE_API_KEY;
  try {
    const payload = parseOpenCodeConfigPayload(`{
      "provider": {
        "opencode": {
          "models": {
            "kimi-k2.7-code": {
              "name": "Kimi K2.7 Code",
              "cost": [{ "input": 0, "output": 0 }]
            },
            "paid-opencode-model": {
              "name": "Paid OpenCode Model",
              "cost": [{ "input": 1.25, "output": 5 }]
            }
          }
        },
        "opencode-go": {
          "models": {
            "glm-5.2-fast": {
              "name": "GLM 5.2 Fast",
              "cost": [{ "input": 0, "output": 0 }]
            },
            "paid-go-model": {
              "name": "Paid Go Model",
              "cost": [{ "input": 0.2, "output": 1 }]
            }
          }
        }
      }
    }`);
    const providerConfig = providerConfigFromOpenCodeConfigPayload(payload);

    const accounts = await accountsFromOpenCodeAuthPayload({}, { providerConfig });
    const byId = new Map(accounts.map((account) => [account.providerId, account]));

    assert.equal(byId.get("opencode")?.accessToken, "public");
    assert.equal(byId.get("opencode")?.baseUrl, "https://opencode.ai/zen");
    assert.equal(byId.get("opencode")?.enabled, true);
    assert.ok(byId.get("opencode")?.providerModels?.["kimi-k2.7-code"]);
    assert.equal(byId.get("opencode")?.providerModels?.["paid-opencode-model"], undefined);
    assert.equal(byId.get("opencode-go")?.accessToken, "public");
    assert.equal(byId.get("opencode-go")?.baseUrl, "https://opencode.ai/zen/go");
    assert.equal(byId.get("opencode-go")?.enabled, true);
    assert.ok(byId.get("opencode-go")?.providerModels?.["glm-5.2-fast"]);
    assert.equal(byId.get("opencode-go")?.providerModels?.["paid-go-model"], undefined);
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = previous;
  }
});

test("OpenCode auth import enables Vercel AI Gateway API keys", async () => {
  const registry = providerRegistryEntryFromMetadata("vercel", {
    id: "vercel",
    name: "Vercel AI Gateway",
    npm: "@ai-sdk/gateway",
    api: "https://ai-gateway.vercel.sh/v3/ai",
    env: ["AI_GATEWAY_API_KEY"],
    models: {
      "openai/gpt-5": { name: "GPT-5" },
    },
  });
  const accounts = await accountsFromOpenCodeAuthPayload(
    {
      vercel: { apiKey: "gateway-key" },
    },
    { providerConfig: new Map([["vercel", registry]]) },
  );
  const gateway = accounts.find((account) => account.providerId === "vercel");
  assert.equal(gateway?.provider, "gateway");
  assert.equal(gateway?.providerAdapter, "gateway");
  assert.equal(gateway?.baseUrl, "https://ai-gateway.vercel.sh/v3/ai");
  assert.equal(gateway?.accessToken, "gateway-key");
  assert.equal(gateway?.enabled, true);
  assert.ok(gateway?.providerModels?.["openai/gpt-5"]);
});
