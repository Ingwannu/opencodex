import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const NO_AUTH_ACCESS_TOKEN = "__opencodex_no_auth__";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("no port"));
      else resolve(address.port);
    });
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function readText(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      resolve(raw);
    });
  });
}

async function waitForHealth(port) {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server on ${port} did not become healthy`);
}

async function closeServer(server) {
  if (typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }
  await Promise.race([
    new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

async function withProxy(accounts, fn) {
  return withProxyEnv(accounts, {}, fn);
}

async function withProxyEnv(accounts, extraEnv, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-proxy-"));
  const portServer = http.createServer((_req, res) => {
    res.writeHead(404).end();
  });
  const port = await listen(portServer);
  await new Promise((resolve) => portServer.close(resolve));

  const storePath = path.join(dir, "accounts.json");
  fs.writeFileSync(
    storePath,
    JSON.stringify({ accounts, modelAliases: [], settings: {} }, null, 2),
  );

  const child = spawn(process.execPath, ["dist/server.js"], {
    cwd: root,
    env: {
      ...process.env,
      ...extraEnv,
      PORT: String(port),
      STORE_PATH: storePath,
      OAUTH_STATE_PATH: path.join(dir, "oauth.json"),
      TRACE_FILE_PATH: path.join(dir, "trace.jsonl"),
      TRACE_STATS_HISTORY_PATH: path.join(dir, "stats.jsonl"),
      MODELS_CACHE_MS: "0",
      MAX_UPSTREAM_RETRIES: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const childExit = new Promise((resolve) => child.once("exit", resolve));

  try {
    await waitForHealth(port);
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    child.kill("SIGTERM");
    const exited = await Promise.race([
      childExit.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    if (!exited) {
      child.kill("SIGKILL");
      await childExit;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(stderr.includes("EADDRINUSE"), false, stderr);
}

test("proxy routes Anthropic chat completions through native Messages API", async () => {
  let capturedRequest;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      assert.equal(req.headers["x-api-key"], "ant-smoke");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "claude-smoke" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/messages") {
      capturedRequest = await readJson(req);
      assert.equal(req.headers["x-api-key"], "ant-smoke");
      assert.equal(req.headers["anthropic-version"], "2023-06-01");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_smoke",
          model: "claude-smoke",
          role: "assistant",
          content: [{ type: "text", text: "Anthropic OK" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 4, output_tokens: 2 },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "anthropic-smoke",
          provider: "anthropic",
          providerId: "anthropic",
          providerAdapter: "anthropic",
          accessToken: "ant-smoke",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-smoke",
            messages: [
              { role: "system", content: "Be concise." },
              { role: "user", content: "Hello" },
            ],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "Anthropic OK");
        assert.equal(capturedRequest.system, "Be concise.");
        assert.equal(capturedRequest.messages[0].role, "user");
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy routes Google responses through native generateContent API", async () => {
  let capturedRequest;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1beta/models?key=gem-smoke") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "models/gemini-3-smoke" }] }));
      return;
    }
    if (
      req.method === "POST" &&
      req.url === "/v1beta/models/gemini-3-smoke:generateContent?key=gem-smoke"
    ) {
      capturedRequest = await readJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: { role: "model", parts: [{ text: "Gemini OK" }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 2,
            totalTokenCount: 7,
          },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "google-smoke",
          provider: "google",
          providerId: "google",
          providerAdapter: "google",
          accessToken: "gem-smoke",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "gemini-3-smoke",
            input: "Hello",
            stream: false,
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.output[0].content[0].text, "Gemini OK");
        assert.equal(capturedRequest.contents[0].role, "user");
        assert.deepEqual(capturedRequest.generationConfig.thinkingConfig, {
          includeThoughts: true,
          thinkingLevel: "high",
        });
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy routes Vercel AI Gateway chat completions through native Gateway API", async () => {
  let capturedRequest;
  let sawModels = false;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v3/ai/config") {
      sawModels = true;
      assert.equal(req.headers.authorization, "Bearer gateway-smoke");
      assert.equal(req.headers["ai-gateway-protocol-version"], "0.0.1");
      assert.equal(req.headers["ai-gateway-auth-method"], "api-key");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
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
        }),
      );
      return;
    }
    if (req.method === "POST" && req.url === "/v3/ai/language-model") {
      capturedRequest = await readJson(req);
      assert.equal(req.headers.authorization, "Bearer gateway-smoke");
      assert.equal(req.headers["ai-gateway-protocol-version"], "0.0.1");
      assert.equal(req.headers["ai-gateway-auth-method"], "api-key");
      assert.equal(req.headers["ai-language-model-specification-version"], "3");
      assert.equal(req.headers["ai-language-model-id"], "openai/gpt-5");
      assert.equal(req.headers["ai-language-model-streaming"], "false");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          content: [{ type: "text", text: "Gateway OK" }],
          finishReason: "stop",
          usage: { inputTokens: 4, outputTokens: 2 },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "gateway-smoke",
          provider: "gateway",
          providerId: "vercel",
          providerAdapter: "gateway",
          accessToken: "gateway-smoke",
          baseUrl: `http://127.0.0.1:${upstreamPort}/v3/ai`,
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const models = await fetch(`${baseUrl}/v1/models`);
        const modelsJson = await models.json();
        assert.equal(models.status, 200);
        assert.ok(modelsJson.data.some((model) => model.id === "openai/gpt-5"));

        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-5",
            messages: [{ role: "user", content: "Hello" }],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "Gateway OK");
        assert.deepEqual(capturedRequest.prompt, [
          { role: "user", content: [{ type: "text", text: "Hello" }] },
        ]);
      },
    );
  } finally {
    await closeServer(upstream);
  }

  assert.equal(sawModels, true);
});

test("proxy routes Cohere chat completions through native v2 chat API", async () => {
  let capturedRequest;
  let capturedModelsAuth;
  let capturedChatAuth;
  const upstream = http.createServer(async (req, res) => {
    if (
      req.method === "GET" &&
      req.url === "/v1/models?endpoint=chat&page_size=1000"
    ) {
      capturedModelsAuth = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          models: [{ name: "command-smoke", context_length: 12345 }],
        }),
      );
      return;
    }
    if (req.method === "POST" && req.url === "/v2/chat") {
      capturedRequest = await readJson(req);
      capturedChatAuth = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "co_smoke",
          finish_reason: "COMPLETE",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Cohere OK" }],
          },
          usage: {
            tokens: { input_tokens: 5, output_tokens: 2 },
          },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "cohere-smoke",
          provider: "cohere",
          providerId: "cohere",
          providerAdapter: "cohere",
          accessToken: "co-smoke",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "command-smoke",
            messages: [
              { role: "system", content: "Be concise." },
              { role: "user", content: "Hello" },
            ],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "Cohere OK");
        assert.equal(capturedModelsAuth, "Bearer co-smoke");
        assert.equal(capturedChatAuth, "Bearer co-smoke");
        assert.equal(capturedRequest.model, "command-smoke");
        assert.deepEqual(capturedRequest.messages, [
          { role: "system", content: "Be concise." },
          { role: "user", content: "Hello" },
        ]);
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy preserves OpenAI-compatible base paths that already contain /v1", async () => {
  let capturedRequest;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/openai/models") {
      assert.equal(req.headers.authorization, "Bearer deep-key");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "deep-model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/openai/chat/completions") {
      capturedRequest = await readJson(req);
      assert.equal(req.headers.authorization, "Bearer deep-key");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-deep",
          object: "chat.completion",
          created: 1,
          model: "deep-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "DeepInfra OK" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "deepinfra-smoke",
          provider: "openai-compatible",
          providerId: "deepinfra",
          providerAdapter: "openai-compatible",
          accessToken: "deep-key",
          baseUrl: `http://127.0.0.1:${upstreamPort}/v1/openai`,
          upstreamMode: "chat/completions",
          compatibilityMode: "chat-completions-bridge",
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "deep-model",
            messages: [{ role: "user", content: "Hello" }],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "DeepInfra OK");
        assert.equal(capturedRequest.model, "deep-model");
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy omits authorization for auth-free local OpenAI-compatible accounts", async () => {
  let sawModels = false;
  let sawChat = false;
  const upstream = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, undefined);
    if (req.method === "GET" && req.url === "/v1/models") {
      sawModels = true;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "gpt-oss:20b" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      sawChat = true;
      await readJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-ollama",
          object: "chat.completion",
          model: "gpt-oss:20b",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Ollama OK" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "ollama-local",
          provider: "openai-compatible",
          providerId: "ollama",
          providerAdapter: "openai-compatible",
          providerAuthType: "none",
          accessToken: NO_AUTH_ACCESS_TOKEN,
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const models = await fetch(`${baseUrl}/v1/models`);
        assert.equal(models.status, 200);

        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "gpt-oss:20b",
            messages: [{ role: "user", content: "Hello" }],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "Ollama OK");
      },
    );
  } finally {
    await closeServer(upstream);
  }

  assert.equal(sawModels, true);
  assert.equal(sawChat, true);
});

test("proxy exposes configured OpenCode models when upstream model listing is unavailable", async () => {
  let capturedRequest;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no model listing" }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      capturedRequest = await readJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-configured",
          object: "chat.completion",
          created: 1,
          model: "configured-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Configured OK" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "configured-smoke",
          provider: "openai-compatible",
          providerId: "configured",
          providerAdapter: "openai-compatible",
          accessToken: "configured-key",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          upstreamMode: "chat/completions",
          compatibilityMode: "chat-completions-bridge",
          providerModels: {
            "configured-model": {
              id: "configured-model",
              name: "Configured Model",
              limit: { context: 1234, output: 567 },
              tool_call: true,
            },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const modelsRes = await fetch(`${baseUrl}/v1/models`);
        const modelsJson = await modelsRes.json();
        assert.equal(modelsRes.status, 200);
        assert.ok(modelsJson.data.some((model) => model.id === "configured-model"));

        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "configured-model",
            messages: [{ role: "user", content: "Hello" }],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "Configured OK");
        assert.equal(capturedRequest.model, "configured-model");
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy exposes configured model keys while routing metadata ids upstream", async () => {
  let capturedRequest;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no model listing" }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      capturedRequest = await readJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-configured-upstream",
          object: "chat.completion",
          created: 1,
          model: "provider-upstream-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Configured ID OK" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "configured-id-smoke",
          provider: "openai-compatible",
          providerId: "configured-id",
          providerAdapter: "openai-compatible",
          accessToken: "configured-key",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          upstreamMode: "chat/completions",
          compatibilityMode: "chat-completions-bridge",
          providerModels: {
            "friendly-model": {
              id: "provider-upstream-model",
              name: "Friendly Model",
            },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const modelsRes = await fetch(`${baseUrl}/v1/models`);
        const modelsJson = await modelsRes.json();
        assert.equal(modelsRes.status, 200);
        assert.ok(modelsJson.data.some((model) => model.id === "friendly-model"));
        assert.equal(
          modelsJson.data.some((model) => model.id === "provider-upstream-model"),
          false,
        );

        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "friendly-model",
            messages: [{ role: "user", content: "Hello" }],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200, JSON.stringify(json));
        assert.equal(json.choices[0].message.content, "Configured ID OK");
        assert.equal(capturedRequest.model, "provider-upstream-model");
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy forwards OpenCode provider option headers to OpenAI-compatible upstreams", async () => {
  let capturedModelsHeaders;
  let capturedChatHeaders;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      capturedModelsHeaders = req.headers;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "header-model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      capturedChatHeaders = req.headers;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-provider-headers",
          object: "chat.completion",
          created: 1,
          model: "header-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Headers OK" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "provider-headers-smoke",
          provider: "openai-compatible",
          providerId: "provider-headers",
          providerAdapter: "openai-compatible",
          accessToken: "configured-key",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          providerOptions: {
            headers: {
              "Helicone-Auth": "Bearer helicone-smoke",
              "X-Provider-Route": "beta",
            },
          },
          upstreamMode: "chat/completions",
          compatibilityMode: "chat-completions-bridge",
          providerModels: {
            "header-model": { name: "Header Model" },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const modelsRes = await fetch(`${baseUrl}/v1/models`);
        const modelsJson = await modelsRes.json();
        assert.equal(modelsRes.status, 200, JSON.stringify(modelsJson));
        assert.equal(capturedModelsHeaders.authorization, "Bearer configured-key");
        assert.equal(capturedModelsHeaders["helicone-auth"], "Bearer helicone-smoke");
        assert.equal(capturedModelsHeaders["x-provider-route"], "beta");

        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "header-model",
            messages: [{ role: "user", content: "Hello" }],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200, JSON.stringify(json));
        assert.equal(json.choices[0].message.content, "Headers OK");
        assert.equal(capturedChatHeaders.authorization, "Bearer configured-key");
        assert.equal(capturedChatHeaders["helicone-auth"], "Bearer helicone-smoke");
        assert.equal(capturedChatHeaders["x-provider-route"], "beta");
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy adds DeepSeek assistant reasoning content for OpenAI-compatible upstreams", async () => {
  let capturedRequest;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "deepseek-chat" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      capturedRequest = await readJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-deepseek-reasoning",
          object: "chat.completion",
          created: 1,
          model: "deepseek-chat",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "DeepSeek OK" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "deepseek-reasoning-smoke",
          provider: "openai-compatible",
          providerId: "deepseek",
          providerAdapter: "openai-compatible",
          accessToken: "deepseek-key",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          upstreamMode: "chat/completions",
          compatibilityMode: "chat-completions-bridge",
          providerModels: {
            "deepseek-chat": { name: "DeepSeek Chat" },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [
              { role: "user", content: "First" },
              { role: "assistant", content: "Answer" },
              { role: "user", content: "Follow up" },
            ],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200, JSON.stringify(json));
        assert.equal(capturedRequest.messages[1].role, "assistant");
        assert.equal(capturedRequest.messages[1].reasoning_content, "");
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy maps interleaved reasoning parts to configured OpenAI-compatible fields", async () => {
  let capturedRequest;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no model listing" }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      capturedRequest = await readJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-interleaved-reasoning",
          object: "chat.completion",
          created: 1,
          model: "interleaved-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Interleaved OK" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "interleaved-reasoning-smoke",
          provider: "openai-compatible",
          providerId: "interleaved-provider",
          providerAdapter: "openai-compatible",
          accessToken: "interleaved-key",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          upstreamMode: "chat/completions",
          compatibilityMode: "chat-completions-bridge",
          providerModels: {
            "interleaved-model": {
              name: "Interleaved Model",
              capabilities: {
                interleaved: { field: "reasoning_content" },
              },
            },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "interleaved-model",
            messages: [
              { role: "user", content: "First" },
              {
                role: "assistant",
                content: [
                  { type: "text", text: "Visible answer" },
                  { type: "reasoning", text: "hidden reasoning" },
                ],
              },
              { role: "user", content: "Follow up" },
            ],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200, JSON.stringify(json));
        assert.equal(capturedRequest.messages[1].role, "assistant");
        assert.equal(capturedRequest.messages[1].reasoning_content, "hidden reasoning");
        assert.deepEqual(capturedRequest.messages[1].content, [
          { type: "text", text: "Visible answer" },
        ]);
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy normalizes Mistral tool ids and tool-user turns", async () => {
  let capturedRequest;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models?client_version=1.0.0") {
      assert.equal(req.headers.authorization, "Bearer mistral-key");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "devstral-small-latest" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/responses") {
      capturedRequest = await readJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "resp_mistral_tools",
          object: "response",
          created_at: 1,
          model: "devstral-small-latest",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "Mistral OK" }],
            },
          ],
          usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxyEnv(
      [
        {
          id: "mistral-smoke",
          provider: "mistral",
          providerId: "mistral",
          providerAdapter: "mistral",
          accessToken: "mistral-key",
          providerModels: {
            "devstral-small-latest": {},
          },
          enabled: true,
        },
      ],
      {
        MISTRAL_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
      },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "devstral-small-latest",
            input: [
              {
                type: "function_call",
                call_id: "call:bad.id/1",
                name: "lookup",
                arguments: "{}",
              },
              {
                type: "function_call_output",
                call_id: "call:bad.id/1",
                output: "Lookup result",
              },
              {
                role: "user",
                content: [{ type: "input_text", text: "Next question" }],
              },
            ],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200, JSON.stringify(json));
        assert.equal(capturedRequest.input[0].call_id, "callbadid");
        assert.equal(capturedRequest.input[1].call_id, "callbadid");
        assert.deepEqual(capturedRequest.input[2], {
          role: "assistant",
          content: [{ type: "input_text", text: "Done." }],
        });
        assert.equal(capturedRequest.input[3].role, "user");
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy applies configured OpenCode model options as request defaults", async () => {
  let capturedRequest;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no model listing" }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/responses") {
      capturedRequest = await readJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "resp_model_options",
          object: "response",
          created_at: 1,
          model: "option-model",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "Options OK" }],
            },
          ],
          usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "model-options-smoke",
          provider: "openai-compatible",
          providerId: "model-options",
          providerAdapter: "openai-compatible",
          accessToken: "configured-key",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          upstreamMode: "responses",
          compatibilityMode: "responses",
          providerModels: {
            "option-model": {
              name: "Option Model",
              options: {
                reasoningEffort: "high",
                reasoningSummary: "auto",
                textVerbosity: "low",
                include: ["reasoning.encrypted_content"],
                temperature: 0.2,
                topP: 0.7,
                topK: 64,
                maxOutputTokens: 123,
                parallelToolCalls: false,
                store: false,
                promptCacheKey: "session-cache-key",
                usage: { include: true },
                enable_thinking: true,
                thinking: { type: "enabled", clear_thinking: false },
                thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 },
                chat_template_args: { enable_thinking: true },
                gateway: { caching: "auto" },
              },
            },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "option-model",
            input: "Hello",
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200, JSON.stringify(json));
        assert.equal(json.output[0].content[0].text, "Options OK");
        assert.deepEqual(capturedRequest.reasoning, {
          effort: "high",
          summary: "auto",
        });
        assert.deepEqual(capturedRequest.text, { verbosity: "low" });
        assert.deepEqual(capturedRequest.include, ["reasoning.encrypted_content"]);
        assert.equal(capturedRequest.temperature, 0.2);
        assert.equal(capturedRequest.top_p, 0.7);
        assert.equal(capturedRequest.top_k, 64);
        assert.equal(capturedRequest.max_output_tokens, 123);
        assert.equal(capturedRequest.parallel_tool_calls, false);
        assert.equal(capturedRequest.store, false);
        assert.equal(capturedRequest.prompt_cache_key, "session-cache-key");
        assert.deepEqual(capturedRequest.usage, { include: true });
        assert.equal(capturedRequest.enable_thinking, true);
        assert.deepEqual(capturedRequest.thinking, {
          type: "enabled",
          clear_thinking: false,
        });
        assert.deepEqual(capturedRequest.thinkingConfig, {
          includeThoughts: true,
          thinkingBudget: 16000,
        });
        assert.deepEqual(capturedRequest.chat_template_args, {
          enable_thinking: true,
        });
        assert.deepEqual(capturedRequest.gateway, { caching: "auto" });
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy applies configured OpenCode provider metadata as request defaults", async () => {
  let capturedRequest;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no model listing" }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/responses") {
      capturedRequest = await readJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "resp_provider_metadata",
          object: "response",
          created_at: 1,
          model: "metadata-model",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "Metadata OK" }],
            },
          ],
          usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "provider-metadata-smoke",
          provider: "openai-compatible",
          providerId: "provider-metadata",
          providerAdapter: "openai-compatible",
          accessToken: "configured-key",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          upstreamMode: "responses",
          compatibilityMode: "responses",
          providerModels: {
            "metadata-model": {
              name: "Metadata Model",
              options: {
                providerOptions: {
                  openaiCompatible: {
                    cache_control: { type: "ephemeral" },
                    customFlag: "configured",
                  },
                },
                experimental_providerMetadata: {
                  anthropic: {
                    cacheControl: { type: "ephemeral" },
                  },
                },
              },
            },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "metadata-model",
            input: "Hello",
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200, JSON.stringify(json));
        assert.equal(json.output[0].content[0].text, "Metadata OK");
        assert.deepEqual(capturedRequest.providerOptions, {
          openaiCompatible: {
            cache_control: { type: "ephemeral" },
            customFlag: "configured",
          },
        });
        assert.deepEqual(capturedRequest.experimental_providerMetadata, {
          anthropic: {
            cacheControl: { type: "ephemeral" },
          },
        });
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy applies OpenCode OpenRouter usage and Gemini 3 reasoning defaults", async () => {
  let capturedRequest;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no model listing" }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      capturedRequest = await readJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl_openrouter_usage",
          object: "chat.completion",
          created_at: 1,
          model: "google/gemini-3-pro-preview",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Usage OK" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "openrouter-usage-smoke",
          provider: "openai-compatible",
          providerId: "openrouter",
          providerAdapter: "openai-compatible",
          providerNpm: "@openrouter/ai-sdk-provider",
          accessToken: "configured-key",
          baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
          upstreamMode: "chat/completions",
          compatibilityMode: "chat-completions-bridge",
          providerModels: {
            "google/gemini-3-pro-preview": { name: "Gemini 3 Pro Preview" },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-3-pro-preview",
            messages: [{ role: "user", content: "Hello" }],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200, JSON.stringify(json));
        assert.equal(json.choices[0].message.content, "Usage OK");
        assert.deepEqual(capturedRequest.usage, { include: true });
        assert.deepEqual(capturedRequest.reasoning, { effort: "high" });
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy replaces unsupported configured model image input with text error", async () => {
  let capturedRequest;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no model listing" }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/responses") {
      capturedRequest = await readJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "resp_unsupported_image",
          object: "response",
          created_at: 1,
          model: "text-only-model",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "Image filtered" }],
            },
          ],
          usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "unsupported-image-smoke",
          provider: "openai-compatible",
          providerId: "unsupported-image",
          providerAdapter: "openai-compatible",
          accessToken: "configured-key",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          upstreamMode: "responses",
          compatibilityMode: "responses",
          providerModels: {
            "text-only-model": {
              name: "Text Only Model",
              capabilities: {
                input: { text: true, image: false },
              },
            },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "text-only-model",
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: "Please inspect this." },
                  {
                    type: "input_image",
                    image_url: "data:image/png;base64,aGVsbG8=",
                  },
                ],
              },
            ],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200, JSON.stringify(json));
        const content = capturedRequest.input[0].content;
        assert.equal(content[0].type, "input_text");
        assert.equal(content[1].type, "input_text");
        assert.match(content[1].text, /Cannot read image/);
        assert.equal(
          content.some((part) => part.type === "input_image"),
          false,
        );
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy replaces empty configured model image input with text error", async () => {
  let capturedRequest;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no model listing" }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/responses") {
      capturedRequest = await readJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "resp_empty_image",
          object: "response",
          created_at: 1,
          model: "vision-model",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "Image checked" }],
            },
          ],
          usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "empty-image-smoke",
          provider: "openai-compatible",
          providerId: "empty-image",
          providerAdapter: "openai-compatible",
          accessToken: "configured-key",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          upstreamMode: "responses",
          compatibilityMode: "responses",
          providerModels: {
            "vision-model": {
              name: "Vision Model",
              capabilities: {
                input: { text: true, image: true },
              },
            },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "vision-model",
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: "Please inspect this." },
                  {
                    type: "input_image",
                    image_url: "data:image/png;base64,",
                  },
                ],
              },
            ],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200, JSON.stringify(json));
        const content = capturedRequest.input[0].content;
        assert.equal(content[1].type, "input_text");
        assert.match(content[1].text, /Image file is empty or corrupted/);
        assert.equal(
          content.some((part) => part.type === "input_image"),
          false,
        );
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy sanitizes invalid configured model text surrogates", async () => {
  let capturedRequest;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no model listing" }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/responses") {
      capturedRequest = await readJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "resp_sanitized_text",
          object: "response",
          created_at: 1,
          model: "text-model",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "Text checked" }],
            },
          ],
          usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "surrogate-smoke",
          provider: "openai-compatible",
          providerId: "surrogate-provider",
          providerAdapter: "openai-compatible",
          accessToken: "configured-key",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          upstreamMode: "responses",
          compatibilityMode: "responses",
          providerModels: {
            "text-model": {
              name: "Text Model",
              capabilities: {
                input: { text: true },
              },
            },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "text-model",
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: "bad \uD800 value" },
                ],
              },
            ],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200, JSON.stringify(json));
        const content = capturedRequest.input[0].content;
        assert.equal(content[0].text, "bad \uFFFD value");
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy applies configured OpenCode model variants from request effort", async () => {
  let capturedRequest;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no model listing" }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/responses") {
      capturedRequest = await readJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "resp_model_variant",
          object: "response",
          created_at: 1,
          model: "variant-model",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "Variant OK" }],
            },
          ],
          usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "model-variant-smoke",
          provider: "openai-compatible",
          providerId: "model-variant",
          providerAdapter: "openai-compatible",
          accessToken: "configured-key",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          upstreamMode: "responses",
          compatibilityMode: "responses",
          providerModels: {
            "variant-model": {
              name: "Variant Model",
              options: {
                reasoningEffort: "low",
                reasoningSummary: "auto",
                textVerbosity: "low",
                temperature: 0.1,
              },
              variants: {
                high: {
                  reasoningEffort: "high",
                  textVerbosity: "high",
                  temperature: 0.4,
                },
              },
            },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "variant-model",
            input: "Hello",
            reasoning_effort: "high",
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200, JSON.stringify(json));
        assert.equal(json.output[0].content[0].text, "Variant OK");
        assert.deepEqual(capturedRequest.reasoning, {
          effort: "high",
          summary: "auto",
        });
        assert.deepEqual(capturedRequest.text, { verbosity: "high" });
        assert.equal(capturedRequest.temperature, 0.4);
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy applies configured OpenCode model variants from request variant", async () => {
  let capturedRequest;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no model listing" }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/responses") {
      capturedRequest = await readJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "resp_model_variant_explicit",
          object: "response",
          created_at: 1,
          model: "variant-model",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "Variant OK" }],
            },
          ],
          usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "model-variant-explicit-smoke",
          provider: "openai-compatible",
          providerId: "model-variant-explicit",
          providerAdapter: "openai-compatible",
          accessToken: "configured-key",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          upstreamMode: "responses",
          compatibilityMode: "responses",
          providerModels: {
            "variant-model": {
              name: "Variant Model",
              options: {
                reasoningEffort: "low",
                textVerbosity: "low",
                temperature: 0.1,
              },
              variants: {
                high: {
                  options: {
                    reasoningEffort: "high",
                    textVerbosity: "high",
                    temperature: 0.4,
                  },
                },
              },
            },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "variant-model",
            input: "Hello",
            variant: "high",
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200, JSON.stringify(json));
        assert.equal(json.output[0].content[0].text, "Variant OK");
        assert.deepEqual(capturedRequest.reasoning, { effort: "high" });
        assert.deepEqual(capturedRequest.text, { verbosity: "high" });
        assert.equal(capturedRequest.temperature, 0.4);
        assert.equal(capturedRequest.variant, undefined);
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy routes Perplexity Sonar compatibility without a /v1 prefix", async () => {
  let capturedRequest;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/models") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no model listing" }));
      return;
    }
    if (req.method === "POST" && req.url === "/chat/completions") {
      capturedRequest = await readJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-sonar",
          object: "chat.completion",
          created: 1,
          model: "sonar-pro",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Sonar OK" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "perplexity-smoke",
          provider: "openai-compatible",
          providerId: "perplexity",
          providerAdapter: "openai-compatible",
          accessToken: "pplx-key",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          openAiPathPrefix: "none",
          upstreamMode: "chat/completions",
          compatibilityMode: "chat-completions-bridge",
          providerModels: {
            "sonar-pro": {
              id: "sonar-pro",
              name: "Sonar Pro",
              limit: { context: 200000, output: 8192 },
            },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "sonar-pro",
            messages: [{ role: "user", content: "Hello" }],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "Sonar OK");
        assert.equal(capturedRequest.model, "sonar-pro");
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy routes Cloudflare AI Gateway with cf-aig authorization", async () => {
  let capturedRequest;
  let capturedModelsCfAuth;
  let capturedModelsAuthorization;
  let capturedChatCfAuth;
  let capturedChatAuthorization;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/cf-account/cf-gateway/openai/models") {
      capturedModelsCfAuth = req.headers["cf-aig-authorization"];
      capturedModelsAuthorization = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "openai/gpt-5.1" }] }));
      return;
    }
    if (
      req.method === "POST" &&
      req.url === "/v1/cf-account/cf-gateway/openai/chat/completions"
    ) {
      capturedRequest = await readJson(req);
      capturedChatCfAuth = req.headers["cf-aig-authorization"];
      capturedChatAuthorization = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-cloudflare",
          object: "chat.completion",
          created: 1,
          model: "openai/gpt-5.1",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Cloudflare OK" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "cloudflare-smoke",
          provider: "openai-compatible",
          providerId: "cloudflare-ai-gateway",
          providerAdapter: "openai-compatible",
          accessToken: "cf-smoke-token",
          baseUrl: `http://127.0.0.1:${upstreamPort}/v1/cf-account/cf-gateway/openai`,
          upstreamMode: "chat/completions",
          compatibilityMode: "chat-completions-bridge",
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-5.1",
            messages: [{ role: "user", content: "Hello" }],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "Cloudflare OK");
        assert.equal(capturedModelsCfAuth, "Bearer cf-smoke-token");
        assert.equal(capturedModelsAuthorization, undefined);
        assert.equal(capturedChatCfAuth, "Bearer cf-smoke-token");
        assert.equal(capturedChatAuthorization, undefined);
        assert.equal(capturedRequest.model, "openai/gpt-5.1");
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy routes Cloudflare AI Gateway REST endpoint with standard authorization", async () => {
  let capturedRequest;
  let capturedModelsAuthorization;
  let capturedModelsGatewayId;
  let capturedModelsCfAuth;
  let capturedChatAuthorization;
  let capturedChatGatewayId;
  let capturedChatCfAuth;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/client/v4/accounts/cf-account/ai/v1/models") {
      capturedModelsAuthorization = req.headers.authorization;
      capturedModelsGatewayId = req.headers["cf-aig-gateway-id"];
      capturedModelsCfAuth = req.headers["cf-aig-authorization"];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "openai/gpt-5.1" }] }));
      return;
    }
    if (
      req.method === "POST" &&
      req.url === "/client/v4/accounts/cf-account/ai/v1/chat/completions"
    ) {
      capturedRequest = await readJson(req);
      capturedChatAuthorization = req.headers.authorization;
      capturedChatGatewayId = req.headers["cf-aig-gateway-id"];
      capturedChatCfAuth = req.headers["cf-aig-authorization"];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-cloudflare-rest",
          object: "chat.completion",
          created: 1,
          model: "openai/gpt-5.1",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Cloudflare REST OK" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "cloudflare-rest-smoke",
          provider: "openai-compatible",
          providerId: "cloudflare-ai-gateway",
          providerAdapter: "openai-compatible",
          accessToken: "cf-rest-token",
          baseUrl: `http://127.0.0.1:${upstreamPort}/client/v4/accounts/cf-account/ai`,
          upstreamMode: "chat/completions",
          compatibilityMode: "chat-completions-bridge",
          providerOptions: { gatewayId: "team-gateway" },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-5.1",
            messages: [{ role: "user", content: "Hello" }],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "Cloudflare REST OK");
        assert.equal(capturedModelsAuthorization, "Bearer cf-rest-token");
        assert.equal(capturedModelsGatewayId, "team-gateway");
        assert.equal(capturedModelsCfAuth, undefined);
        assert.equal(capturedChatAuthorization, "Bearer cf-rest-token");
        assert.equal(capturedChatGatewayId, "team-gateway");
        assert.equal(capturedChatCfAuth, undefined);
        assert.equal(capturedRequest.model, "openai/gpt-5.1");
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy routes Cloudflare Workers AI through REST OpenAI-compatible endpoint", async () => {
  let capturedRequest;
  let capturedModelsAuthorization;
  let capturedModelsGatewayId;
  let capturedModelsCfAuth;
  let capturedChatAuthorization;
  let capturedChatGatewayId;
  let capturedChatCfAuth;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/client/v4/accounts/cf-account/ai/v1/models") {
      capturedModelsAuthorization = req.headers.authorization;
      capturedModelsGatewayId = req.headers["cf-aig-gateway-id"];
      capturedModelsCfAuth = req.headers["cf-aig-authorization"];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "@cf/moonshotai/kimi-k2.6" }] }));
      return;
    }
    if (
      req.method === "POST" &&
      req.url === "/client/v4/accounts/cf-account/ai/v1/chat/completions"
    ) {
      capturedRequest = await readJson(req);
      capturedChatAuthorization = req.headers.authorization;
      capturedChatGatewayId = req.headers["cf-aig-gateway-id"];
      capturedChatCfAuth = req.headers["cf-aig-authorization"];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-workers-ai",
          object: "chat.completion",
          created: 1,
          model: "@cf/moonshotai/kimi-k2.6",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Workers AI OK" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "cloudflare-workers-ai-smoke",
          provider: "openai-compatible",
          providerId: "cloudflare-workers-ai",
          providerAdapter: "openai-compatible",
          accessToken: "cf-workers-token",
          baseUrl: `http://127.0.0.1:${upstreamPort}/client/v4/accounts/cf-account/ai`,
          upstreamMode: "chat/completions",
          compatibilityMode: "chat-completions-bridge",
          providerOptions: { gatewayId: "team-gateway" },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "@cf/moonshotai/kimi-k2.6",
            messages: [{ role: "user", content: "Hello" }],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "Workers AI OK");
        assert.equal(capturedModelsAuthorization, "Bearer cf-workers-token");
        assert.equal(capturedModelsGatewayId, "team-gateway");
        assert.equal(capturedModelsCfAuth, undefined);
        assert.equal(capturedChatAuthorization, "Bearer cf-workers-token");
        assert.equal(capturedChatGatewayId, "team-gateway");
        assert.equal(capturedChatCfAuth, undefined);
        assert.equal(capturedRequest.model, "@cf/moonshotai/kimi-k2.6");
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy routes Azure OpenAI v1 endpoints with api-key authorization", async () => {
  let capturedRequest;
  let capturedModelsApiKey;
  let capturedModelsAuthorization;
  let capturedResponsesApiKey;
  let capturedResponsesAuthorization;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/openai/v1/models") {
      capturedModelsApiKey = req.headers["api-key"];
      capturedModelsAuthorization = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "gpt-5.1-prod" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/openai/v1/responses") {
      capturedRequest = await readJson(req);
      capturedResponsesApiKey = req.headers["api-key"];
      capturedResponsesAuthorization = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "resp_azure",
          object: "response",
          created_at: 1,
          model: "gpt-5.1-prod",
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "Azure OK" }],
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "azure-smoke",
          provider: "openai-compatible",
          providerId: "azure",
          providerAdapter: "openai-compatible",
          accessToken: "az-smoke-key",
          baseUrl: `http://127.0.0.1:${upstreamPort}/openai`,
          upstreamMode: "responses",
          compatibilityMode: "responses",
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "gpt-5.1-prod",
            input: "Hello",
            stream: false,
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.output[0].content[0].text, "Azure OK");
        assert.equal(capturedModelsApiKey, "az-smoke-key");
        assert.equal(capturedModelsAuthorization, undefined);
        assert.equal(capturedResponsesApiKey, "az-smoke-key");
        assert.equal(capturedResponsesAuthorization, undefined);
        assert.equal(capturedRequest.model, "gpt-5.1-prod");
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy refreshes xAI OAuth and routes Responses API", async () => {
  let capturedTokenBody = "";
  let capturedModelsAuthorization;
  let capturedResponsesAuthorization;
  let capturedRequest;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/oauth/token") {
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        capturedTokenBody += chunk;
      });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            access_token: "xai-refreshed-access",
            refresh_token: "xai-rotated-refresh",
            expires_in: 3600,
          }),
        );
      });
      return;
    }
    if (req.method === "GET" && req.url === "/v1/models") {
      capturedModelsAuthorization = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "grok-4" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/responses") {
      capturedResponsesAuthorization = req.headers.authorization;
      capturedRequest = await readJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "resp_xai",
          object: "response",
          created_at: 1,
          model: "grok-4",
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "xAI OK" }],
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);
  const previousTokenUrl = process.env.XAI_OAUTH_TOKEN_URL;
  process.env.XAI_OAUTH_TOKEN_URL = `http://127.0.0.1:${upstreamPort}/oauth/token`;

  try {
    await withProxy(
      [
        {
          id: "xai-oauth-smoke",
          provider: "openai-compatible",
          providerId: "xai",
          providerAdapter: "openai-compatible",
          providerNpm: "@ai-sdk/xai",
          providerAuthType: "oauth",
          accessToken: "xai-expired-access",
          refreshToken: "xai-refresh-token",
          expiresAt: Date.now() - 60_000,
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          upstreamMode: "responses",
          compatibilityMode: "responses",
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "grok-4",
            input: "Hello",
            stream: false,
          }),
        });
        const json = await res.json();
        const tokenParams = new URLSearchParams(capturedTokenBody);
        assert.equal(res.status, 200);
        assert.equal(json.output[0].content[0].text, "xAI OK");
        assert.equal(tokenParams.get("grant_type"), "refresh_token");
        assert.equal(tokenParams.get("client_id"), "b1a00492-073a-47ea-816f-4c329264a828");
        assert.equal(tokenParams.get("refresh_token"), "xai-refresh-token");
        assert.equal(capturedModelsAuthorization, "Bearer xai-refreshed-access");
        assert.equal(capturedResponsesAuthorization, "Bearer xai-refreshed-access");
        assert.equal(capturedRequest.model, "grok-4");
      },
    );
  } finally {
    if (previousTokenUrl === undefined) delete process.env.XAI_OAUTH_TOKEN_URL;
    else process.env.XAI_OAUTH_TOKEN_URL = previousTokenUrl;
    await closeServer(upstream);
  }
});

test("proxy routes Snowflake Cortex through OpenAI-compatible chat completions", async () => {
  let capturedRequest;
  let capturedModelsAuthorization;
  let capturedChatAuthorization;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/api/v2/cortex/v1/models") {
      capturedModelsAuthorization = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "claude-sonnet-4-5" }] }));
      return;
    }
    if (
      req.method === "POST" &&
      req.url === "/api/v2/cortex/v1/chat/completions"
    ) {
      capturedRequest = await readJson(req);
      capturedChatAuthorization = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-snowflake",
          object: "chat.completion",
          created: 1,
          model: "claude-sonnet-4-5",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Snowflake OK" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "snowflake-smoke",
          provider: "openai-compatible",
          providerId: "snowflake-cortex",
          providerAdapter: "openai-compatible",
          accessToken: "snowflake-smoke-token",
          baseUrl: `http://127.0.0.1:${upstreamPort}/api/v2/cortex`,
          upstreamMode: "chat/completions",
          compatibilityMode: "chat-completions-bridge",
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-5",
            messages: [{ role: "user", content: "Hello" }],
            max_tokens: 64,
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "Snowflake OK");
        assert.equal(capturedModelsAuthorization, "Bearer snowflake-smoke-token");
        assert.equal(capturedChatAuthorization, "Bearer snowflake-smoke-token");
        assert.equal(capturedRequest.model, "claude-sonnet-4-5");
        assert.equal(capturedRequest.messages[0].content, "Hello");
        assert.equal(capturedRequest.max_tokens, undefined);
        assert.equal(capturedRequest.max_completion_tokens, 64);
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy routes v0 through OpenAI-compatible chat completions", async () => {
  let capturedRequest;
  let capturedModelsAuthorization;
  let capturedChatAuthorization;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      capturedModelsAuthorization = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "v0-1.5-md" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      capturedRequest = await readJson(req);
      capturedChatAuthorization = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-v0",
          object: "chat.completion",
          created: 1,
          model: "v0-1.5-md",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "v0 OK" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "v0-smoke",
          provider: "openai-compatible",
          providerId: "v0",
          providerAdapter: "openai-compatible",
          accessToken: "v0-smoke-key",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          upstreamMode: "chat/completions",
          compatibilityMode: "chat-completions-bridge",
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "v0-1.5-md",
            messages: [{ role: "user", content: "Hello" }],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "v0 OK");
        assert.equal(capturedModelsAuthorization, "Bearer v0-smoke-key");
        assert.equal(capturedChatAuthorization, "Bearer v0-smoke-key");
        assert.equal(capturedRequest.model, "v0-1.5-md");
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy routes GitHub Copilot with OpenCode-compatible headers", async () => {
  let capturedModelsHeaders;
  let capturedChatHeaders;
  let capturedRequest;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      capturedModelsHeaders = req.headers;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "gpt-5.1-codex" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      capturedChatHeaders = req.headers;
      capturedRequest = await readJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-copilot",
          object: "chat.completion",
          created: 1,
          model: "gpt-5.1-codex",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Copilot OK" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "github-copilot-smoke",
          provider: "openai-compatible",
          providerId: "github-copilot",
          providerAdapter: "openai-compatible",
          providerNpm: "@ai-sdk/github-copilot",
          providerAuthType: "oauth",
          accessToken: "copilot-refresh-token",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          upstreamMode: "chat/completions",
          compatibilityMode: "chat-completions-bridge",
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "gpt-5.1-codex",
            messages: [{ role: "user", content: "Hello" }],
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "Copilot OK");
        assert.equal(
          capturedModelsHeaders.authorization,
          "Bearer copilot-refresh-token",
        );
        assert.equal(
          capturedChatHeaders.authorization,
          "Bearer copilot-refresh-token",
        );
        assert.equal(capturedChatHeaders["x-github-api-version"], "2026-06-01");
        assert.equal(capturedChatHeaders["openai-intent"], "conversation-edits");
        assert.equal(capturedChatHeaders["x-initiator"], "user");
        assert.ok(capturedChatHeaders["user-agent"]?.includes("pi ("));
        assert.equal(capturedRequest.model, "gpt-5.1-codex");
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy routes Amazon Bedrock chat completions through Converse API", async () => {
  let capturedRequest;
  let capturedAuthorization;
  const upstream = http.createServer(async (req, res) => {
    if (
      req.method === "POST" &&
      req.url === "/model/anthropic.claude-3-haiku-20240307-v1%3A0/converse"
    ) {
      capturedRequest = await readJson(req);
      capturedAuthorization = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          output: {
            message: {
              role: "assistant",
              content: [{ text: "Bedrock OK" }],
            },
          },
          stopReason: "end_turn",
          usage: {
            inputTokens: 5,
            outputTokens: 2,
            totalTokens: 7,
          },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "bedrock-smoke",
          provider: "amazon-bedrock",
          providerId: "amazon-bedrock",
          providerAdapter: "amazon-bedrock",
          accessToken: "bedrock-smoke-key",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          providerModels: {
            "anthropic.claude-3-haiku-20240307-v1:0": {
              id: "anthropic.claude-3-haiku-20240307-v1:0",
              name: "Claude 3 Haiku",
            },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "anthropic.claude-3-haiku-20240307-v1:0",
            messages: [
              { role: "system", content: "Be concise." },
              { role: "user", content: "Hello" },
            ],
            max_tokens: 64,
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "Bedrock OK");
        assert.equal(capturedAuthorization, "Bearer bedrock-smoke-key");
        assert.deepEqual(capturedRequest.system, [{ text: "Be concise." }]);
        assert.equal(
          capturedRequest.messages[0].content[0].text,
          "Hello",
        );
        assert.equal(capturedRequest.inferenceConfig.maxTokens, 64);
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy signs Amazon Bedrock Converse requests with AWS SigV4 credentials", async () => {
  let capturedRequest;
  let capturedAuthorization;
  let capturedAmzDate;
  let capturedPayloadHash;
  let capturedSessionToken;
  const upstream = http.createServer(async (req, res) => {
    if (
      req.method === "POST" &&
      req.url === "/model/anthropic.claude-3-haiku-20240307-v1%3A0/converse"
    ) {
      capturedRequest = await readJson(req);
      capturedAuthorization = req.headers.authorization;
      capturedAmzDate = req.headers["x-amz-date"];
      capturedPayloadHash = req.headers["x-amz-content-sha256"];
      capturedSessionToken = req.headers["x-amz-security-token"];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          output: {
            message: {
              role: "assistant",
              content: [{ text: "Bedrock SigV4 OK" }],
            },
          },
          stopReason: "end_turn",
          usage: {
            inputTokens: 5,
            outputTokens: 2,
            totalTokens: 7,
          },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxyEnv(
      [
        {
          id: "bedrock-sigv4-smoke",
          provider: "amazon-bedrock",
          providerId: "amazon-bedrock",
          providerAdapter: "amazon-bedrock",
          accessToken: "__opencodex_aws_sigv4__",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          providerOptions: {
            region: "us-east-1",
          },
          providerModels: {
            "anthropic.claude-3-haiku-20240307-v1:0": {
              id: "anthropic.claude-3-haiku-20240307-v1:0",
              name: "Claude 3 Haiku",
            },
          },
          enabled: true,
        },
      ],
      {
        AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
        AWS_SECRET_ACCESS_KEY: "SECRETEXAMPLE",
        AWS_SESSION_TOKEN: "SESSIONEXAMPLE",
      },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "anthropic.claude-3-haiku-20240307-v1:0",
            messages: [{ role: "user", content: "Hello" }],
            max_tokens: 64,
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "Bedrock SigV4 OK");
        assert.equal(capturedAuthorization?.startsWith("AWS4-HMAC-SHA256 "), true);
        assert.match(
          capturedAuthorization,
          /Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/bedrock\/aws4_request/,
        );
        assert.match(capturedAuthorization, /Signature=[a-f0-9]{64}$/);
        assert.match(String(capturedAmzDate), /^\d{8}T\d{6}Z$/);
        assert.match(String(capturedPayloadHash), /^[a-f0-9]{64}$/);
        assert.equal(capturedSessionToken, "SESSIONEXAMPLE");
        assert.equal(capturedRequest.messages[0].content[0].text, "Hello");
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy routes Vertex chat completions through generateContent API", async () => {
  let capturedRequest;
  let capturedAuthorization;
  const upstream = http.createServer(async (req, res) => {
    if (
      req.method === "GET" &&
      req.url === "/v1/projects/test-project/locations/us-central1/publishers/google/models"
    ) {
      capturedAuthorization = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          publisherModels: [{ name: "publishers/google/models/gemini-vertex-smoke" }],
        }),
      );
      return;
    }
    if (
      req.method === "POST" &&
      req.url === "/v1/projects/test-project/locations/us-central1/publishers/google/models/gemini-vertex-smoke:generateContent"
    ) {
      capturedRequest = await readJson(req);
      capturedAuthorization = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: { role: "model", parts: [{ text: "Vertex OK" }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 2,
            totalTokenCount: 7,
          },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "vertex-smoke",
          provider: "vertex",
          providerId: "google-vertex",
          providerAdapter: "vertex",
          accessToken: "vertex-smoke-token",
          baseUrl: `http://127.0.0.1:${upstreamPort}/v1/projects/test-project/locations/us-central1`,
          providerModels: {
            "gemini-vertex-smoke": {
              id: "gemini-vertex-smoke",
              name: "Gemini Vertex Smoke",
            },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "gemini-vertex-smoke",
            messages: [
              { role: "system", content: "Be concise." },
              { role: "user", content: "Hello" },
            ],
            max_tokens: 64,
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "Vertex OK");
        assert.equal(capturedAuthorization, "Bearer vertex-smoke-token");
        assert.equal(capturedRequest.systemInstruction.parts[0].text, "Be concise.");
        assert.equal(capturedRequest.contents[0].parts[0].text, "Hello");
        assert.equal(capturedRequest.generationConfig.maxOutputTokens, 64);
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy exchanges Vertex service-account ADC and routes chat completions through generateContent API", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  let capturedRequest;
  let capturedAuthorization;
  let capturedTokenBody;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/token") {
      capturedTokenBody = await readText(req);
      assert.match(
        String(req.headers["content-type"]),
        /^application\/x-www-form-urlencoded/,
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: "vertex-oauth-smoke-token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      );
      return;
    }
    if (
      req.method === "GET" &&
      req.url === "/v1/projects/test-project/locations/global/publishers/google/models"
    ) {
      capturedAuthorization = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          publisherModels: [{ name: "publishers/google/models/gemini-vertex-adc-smoke" }],
        }),
      );
      return;
    }
    if (
      req.method === "POST" &&
      req.url === "/v1/projects/test-project/locations/global/publishers/google/models/gemini-vertex-adc-smoke:generateContent"
    ) {
      capturedRequest = await readJson(req);
      capturedAuthorization = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: { role: "model", parts: [{ text: "Vertex ADC OK" }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 3,
            totalTokenCount: 8,
          },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "vertex-adc-smoke",
          provider: "vertex",
          providerId: "google-vertex",
          providerAdapter: "vertex",
          accessToken: "__opencodex_google_vertex_adc__",
          baseUrl: `http://127.0.0.1:${upstreamPort}/v1/projects/test-project/locations/global`,
          providerOptions: {
            googleAuthCredentials: {
              type: "service_account",
              project_id: "test-project",
              private_key_id: "smoke-key-id",
              private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
              client_email: "vertex-smoke@example.iam.gserviceaccount.com",
              token_uri: `http://127.0.0.1:${upstreamPort}/token`,
            },
          },
          providerModels: {
            "gemini-vertex-adc-smoke": {
              id: "gemini-vertex-adc-smoke",
              name: "Gemini Vertex ADC Smoke",
            },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "gemini-vertex-adc-smoke",
            messages: [
              { role: "system", content: "Be concise." },
              { role: "user", content: "Hello" },
            ],
            max_tokens: 64,
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "Vertex ADC OK");
        assert.equal(capturedAuthorization, "Bearer vertex-oauth-smoke-token");
        assert.equal(capturedRequest.systemInstruction.parts[0].text, "Be concise.");
        assert.equal(capturedRequest.contents[0].parts[0].text, "Hello");

        const tokenBody = new URLSearchParams(capturedTokenBody);
        assert.equal(
          tokenBody.get("grant_type"),
          "urn:ietf:params:oauth:grant-type:jwt-bearer",
        );
        const assertion = tokenBody.get("assertion");
        assert.ok(assertion);
        const claims = JSON.parse(
          Buffer.from(assertion.split(".")[1], "base64url").toString("utf8"),
        );
        assert.equal(claims.iss, "vertex-smoke@example.iam.gserviceaccount.com");
        assert.equal(claims.aud, `http://127.0.0.1:${upstreamPort}/token`);
        assert.equal(claims.scope, "https://www.googleapis.com/auth/cloud-platform");
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy routes Vertex Anthropic chat completions through rawPredict API", async () => {
  let capturedRequest;
  let capturedAuthorization;
  const upstream = http.createServer(async (req, res) => {
    if (
      req.method === "POST" &&
      req.url === "/v1/projects/test-project/locations/us-east5/publishers/anthropic/models/claude-3-5-sonnet-v2%4020241022:rawPredict"
    ) {
      capturedRequest = await readJson(req);
      capturedAuthorization = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_vrtx_smoke",
          role: "assistant",
          content: [{ type: "text", text: "Vertex Claude OK" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);

  try {
    await withProxy(
      [
        {
          id: "vertex-anthropic-smoke",
          provider: "vertex-anthropic",
          providerId: "google-vertex-anthropic",
          providerAdapter: "vertex-anthropic",
          accessToken: "vertex-ant-smoke-token",
          baseUrl: `http://127.0.0.1:${upstreamPort}/v1/projects/test-project/locations/us-east5`,
          providerModels: {
            "claude-3-5-sonnet-v2@20241022": {
              id: "claude-3-5-sonnet-v2@20241022",
              name: "Claude 3.5 Sonnet v2",
            },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-3-5-sonnet-v2@20241022",
            messages: [
              { role: "system", content: "Be concise." },
              { role: "user", content: "Hello" },
            ],
            max_tokens: 64,
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "Vertex Claude OK");
        assert.equal(capturedAuthorization, "Bearer vertex-ant-smoke-token");
        assert.equal(capturedRequest.anthropic_version, "vertex-2023-10-16");
        assert.equal(capturedRequest.model, undefined);
        assert.equal(capturedRequest.system, "Be concise.");
        assert.equal(capturedRequest.messages[0].content[0].text, "Hello");
        assert.equal(capturedRequest.max_tokens, 64);
      },
    );
  } finally {
    await closeServer(upstream);
  }
});

test("proxy exchanges GitLab token and routes Duo Claude through AI Gateway", async () => {
  let capturedDirectAccess;
  let capturedGatewayRequest;
  let capturedGatewayAuthorization;
  let directAccessCalls = 0;
  const upstream = http.createServer(async (req, res) => {
    if (
      req.method === "POST" &&
      req.url === "/api/v4/ai/third_party_agents/direct_access"
    ) {
      directAccessCalls += 1;
      capturedDirectAccess = await readJson(req);
      assert.equal(req.headers.authorization, "Bearer glpat-smoke-token");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          token: "gitlab-direct-smoke-token",
          headers: { "x-gitlab-realm": "saas" },
        }),
      );
      return;
    }
    if (
      req.method === "POST" &&
      req.url === "/ai/v1/proxy/anthropic/v1/messages"
    ) {
      capturedGatewayRequest = await readJson(req);
      capturedGatewayAuthorization = req.headers.authorization;
      assert.equal(req.headers["x-gitlab-realm"], "saas");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_gitlab_smoke",
          model: "claude-opus-4-5-20251101",
          role: "assistant",
          content: [{ type: "text", text: "GitLab Duo OK" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 5, output_tokens: 3 },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);
  const previousGatewayUrl = process.env.GITLAB_AI_GATEWAY_URL;
  process.env.GITLAB_AI_GATEWAY_URL = `http://127.0.0.1:${upstreamPort}`;

  try {
    await withProxy(
      [
        {
          id: "gitlab-smoke",
          provider: "gitlab",
          providerId: "gitlab",
          providerAdapter: "gitlab",
          accessToken: "glpat-smoke-token",
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          providerModels: {
            "duo-chat-opus-4-5": {
              id: "duo-chat-opus-4-5",
              name: "Agentic Chat (Claude Opus 4.5)",
            },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "duo-chat-opus-4-5",
            messages: [
              { role: "system", content: "Be concise." },
              { role: "user", content: "Hello" },
            ],
            max_tokens: 64,
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "GitLab Duo OK");
        assert.equal(directAccessCalls, 1);
        assert.deepEqual(capturedDirectAccess, {});
        assert.equal(capturedGatewayAuthorization, "Bearer gitlab-direct-smoke-token");
        assert.equal(capturedGatewayRequest.model, "claude-opus-4-5-20251101");
        assert.equal(capturedGatewayRequest.system, "Be concise.");
        assert.equal(capturedGatewayRequest.messages[0].content[0].text, "Hello");
        assert.equal(capturedGatewayRequest.max_tokens, 64);
      },
    );
  } finally {
    if (previousGatewayUrl === undefined) delete process.env.GITLAB_AI_GATEWAY_URL;
    else process.env.GITLAB_AI_GATEWAY_URL = previousGatewayUrl;
    await closeServer(upstream);
  }
});

test("proxy exchanges SAP AI Core service key and routes orchestration chat completions", async () => {
  let capturedTokenBody = "";
  let capturedTokenAuthorization;
  let capturedCompletionRequest;
  let capturedCompletionAuthorization;
  let capturedCompletionResourceGroup;

  const upstream = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/oauth/token") {
      capturedTokenAuthorization = req.headers.authorization;
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        capturedTokenBody += chunk;
      });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            access_token: "sap-oauth-smoke-token",
            token_type: "bearer",
            expires_in: 3600,
          }),
        );
      });
      return;
    }

    if (
      req.method === "POST" &&
      req.url === "/v2/inference/deployments/orchestration-deployment/v2/completion"
    ) {
      capturedCompletionRequest = await readJson(req);
      capturedCompletionAuthorization = req.headers.authorization;
      capturedCompletionResourceGroup = req.headers["ai-resource-group"];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          request_id: "sap-smoke-request",
          final_result: {
            id: "chatcmpl-sap-smoke",
            object: "chat.completion",
            created: 1,
            model: "anthropic--claude-4.5-sonnet",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "SAP AI Core OK" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
          },
          intermediate_results: {},
        }),
      );
      return;
    }

    res.writeHead(404).end();
  });
  const upstreamPort = await listen(upstream);
  const serviceKey = JSON.stringify({
    clientid: "sap-client",
    clientsecret: "sap-secret",
    url: `http://127.0.0.1:${upstreamPort}`,
    serviceurls: {
      AI_API_URL: `http://127.0.0.1:${upstreamPort}/v2`,
    },
  });

  try {
    await withProxy(
      [
        {
          id: "sap-ai-core-smoke",
          provider: "sap-ai-core",
          providerId: "sap-ai-core",
          providerAdapter: "sap-ai-core",
          accessToken: serviceKey,
          providerOptions: {
            deploymentId: "orchestration-deployment",
            resourceGroup: "rg-ai",
          },
          providerModels: {
            "anthropic--claude-4.5-sonnet": {
              id: "anthropic--claude-4.5-sonnet",
              name: "Claude via SAP",
            },
          },
          enabled: true,
        },
      ],
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "anthropic--claude-4.5-sonnet",
            messages: [
              { role: "system", content: "Be concise." },
              { role: "user", content: "Hello" },
            ],
            max_tokens: 64,
          }),
        });
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.choices[0].message.content, "SAP AI Core OK");
        assert.equal(
          capturedTokenAuthorization,
          `Basic ${Buffer.from("sap-client:sap-secret").toString("base64")}`,
        );
        assert.equal(capturedTokenBody, "grant_type=client_credentials");
        assert.equal(capturedCompletionAuthorization, "Bearer sap-oauth-smoke-token");
        assert.equal(capturedCompletionResourceGroup, "rg-ai");
        assert.equal(
          capturedCompletionRequest.config.modules.prompt_templating.model.name,
          "anthropic--claude-4.5-sonnet",
        );
        assert.equal(
          capturedCompletionRequest.config.modules.prompt_templating.model.params.max_tokens,
          64,
        );
        assert.equal(
          capturedCompletionRequest.config.modules.prompt_templating.prompt.template[0].content,
          "Be concise.",
        );
        assert.equal(
          capturedCompletionRequest.config.modules.prompt_templating.prompt.template[1].content,
          "Hello",
        );
      },
    );
  } finally {
    await closeServer(upstream);
  }
});
