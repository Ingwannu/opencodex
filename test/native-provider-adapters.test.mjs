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

test("OpenCode directory OpenAI-compatible providers have offline runtime defaults", () => {
  const expected = {
    "302ai": "https://api.302.ai",
    cortecs: "https://api.cortecs.ai",
    deepseek: "https://api.deepseek.com",
    "fireworks-ai": "https://api.fireworks.ai/inference",
    huggingface: "https://router.huggingface.co",
    helicone: "https://ai-gateway.helicone.ai",
    "io-net": "https://api.intelligence.io.solutions/api",
    llmgateway: "https://api.llmgateway.io",
    moonshotai: "https://api.moonshot.ai",
    "moonshotai-cn": "https://api.moonshot.cn",
    nvidia: "https://integrate.api.nvidia.com",
    nebius: "https://api.tokenfactory.nebius.com",
    "ollama-cloud": "https://ollama.com",
    opencode: "https://opencode.ai/zen",
    "opencode-go": "https://opencode.ai/zen/go",
    ovhcloud: "https://oai.endpoints.kepler.ai.cloud.ovh.net",
    scaleway: "https://api.scaleway.ai",
    stackit: "https://api.openai-compat.model-serving.eu01.onstackit.cloud",
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

    assert.equal(parent?.baseUrl, "https://azc-resource.openai.azure.com/openai");
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
