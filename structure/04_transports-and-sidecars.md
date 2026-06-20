# Transports And Sidecars SOT

## Responses HTTP/SSE

`/v1/responses` is the main Codex-facing endpoint. The server parses Responses input, routes to a
provider, lets the selected adapter speak the upstream protocol, then bridges adapter events back to
Responses-compatible streaming output.

Native OpenAI/ChatGPT passthrough uses `openai-responses` with `authMode: "forward"`, forwarding only
the allowed Codex/OpenAI auth/session headers.

## WebSocket

The WebSocket endpoint exists at `/v1/responses`, but discovery is opt-in:

```json
{
  "websockets": false
}
```

`websocketsEnabled(config)` is true only for an explicit `true`. When false, opencodex removes
`supports_websockets` from injected provider tables and routed catalog entries, keeping Codex on
HTTP/SSE. When true, Codex may use Responses WebSocket frames handled by `src/ws-bridge.ts`.

The endpoint handles `response.create`, ignores `response.processed`, supports warmup
`generate: false`, and feeds the same request pipeline as HTTP/SSE.

## Reasoning and tool-result compatibility

Native OpenAI passthrough sanitizes routed reasoning history so `reasoning` input items do not send
non-empty `content` arrays to upstream models that reject them. Chat Completions bridging repairs
orphan `toolResult` messages by inserting a synthetic assistant `tool_call` before tool messages.

These compatibility guards are covered by focused tests and should stay close to the adapters that
need them.

## Sidecars

Web search and vision sidecars only run when a forward ChatGPT provider/login exists and the main
request needs that capability.

| Sidecar | Default model | Activation |
| --- | --- | --- |
| `web-search/` | `gpt-5.4-mini` | Hosted `web_search` requested by a non-passthrough routed model. |
| `vision/` | `gpt-5.4-mini` | Input contains images for a model listed in `noVisionModels`. |

Sidecar failures must degrade to text markers or skipped capability, not abort the main request.
