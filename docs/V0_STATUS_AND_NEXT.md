# OpenCodex v0 Status and Next Work

This document tracks the v0 release boundary separately from the larger goal of
full OpenCode provider parity.

## v0.2.13 shipped surface

- One Codex launcher/proxy surface for OpenAI, local, and OpenAI-compatible
  providers, with `codex` as the safe default launcher, `codex-multi` as the
  strict proxy launcher, `codex-oai` as the OpenAI-only launcher, and `codex-oss`
  as the local OSS/Ollama launcher.
- Web account management for adding, editing, enabling, disabling, deleting,
  and importing provider accounts.
- OpenCode `auth.json`, current credential records, pasted auth/config content,
  and `opencode.json/jsonc` provider config import.
- DigitalOcean cached Inference Router metadata import, exposing OAuth-discovered
  routers as `router:<name>` models.
- Built-in routing for:
  - OpenAI ChatGPT OAuth and OpenAI API Responses
  - OpenAI-compatible providers
  - Anthropic
  - Google Gemini
  - Google Vertex AI
  - Google Vertex Anthropic
  - Vercel AI Gateway
  - Azure OpenAI and Azure Cognitive Services
  - Cloudflare AI Gateway and Cloudflare Workers AI
  - Amazon Bedrock and Bedrock Mantle
  - Cohere
  - SAP AI Core
  - GitLab Duo
  - GitHub Copilot OAuth
  - Snowflake Cortex
  - xAI/Grok API keys and OpenCode OAuth/SuperGrok refresh
- v0 major-provider coverage for DeepSeek, Xiaomi, Neuralwatt, Fireworks AI,
  OpenAI, Anthropic, Google, and xAI.
- OpenCode plugin header defaults mirrored for Anthropic, Cerebras, OpenRouter,
  Vercel/v0, Kilo, LLM Gateway, Nvidia, and ZenMux provider paths.
- OpenCode Mistral/devstral tool-call transform mirrored for Responses payloads:
  tool IDs are scrubbed to Mistral's nine-character alphanumeric format, and an
  assistant `Done.` turn is inserted between a tool result and the following
  user turn.
- OpenCode Claude-compatible tool-call transform mirrored for chat/completions
  payloads: tool call IDs are scrubbed to Claude's `[A-Za-z0-9_-]` shape before
  forwarding to OpenAI-compatible Claude endpoints.
- OpenCode prompt-caching hints mirrored for Claude-compatible chat/completions
  requests by marking the first two system messages and final two non-system
  messages with ephemeral OpenRouter/OpenAI-compatible cache metadata.
- OpenCode MiniMax M3 Anthropic request default mirrored by sending
  `thinking: { type: "adaptive" }` to Anthropic-compatible upstreams when the
  caller did not provide thinking controls.
- OpenCode configured model provider metadata defaults are forwarded to upstream
  requests via `providerOptions` and `experimental_providerMetadata`, preserving
  provider-specific cache/control hints when the caller did not override them.
- OpenCode OpenRouter and LLM Gateway request defaults now mirror
  `usage: { include: true }` and the Gemini 3 `reasoning: { effort: "high" }`
  hint when the caller did not provide those options.
- Google Gemini and Vertex Gemini 3 native requests now mirror OpenCode's
  default thinking config by sending `includeThoughts: true` and
  `thinkingLevel: "high"` through `generationConfig.thinkingConfig` when the
  caller did not provide a thinking config.
- Google Gemini and Vertex native adapters now forward OpenAI-style function
  tools as Gemini `functionDeclarations` and convert Gemini `functionCall`
  responses back to OpenAI `tool_calls` / Responses `function_call` items.
- Google Gemini and Vertex native tool schemas now mirror OpenCode's Gemini
  sanitizer for enum values, nullable type arrays, invalid `required` fields,
  array item defaults, and non-object `properties` cleanup.
- Additional OpenCode provider-level request defaults are mirrored from provider
  identity and model metadata: OpenRouter/Venice/OpenAI-compatible
  `setCacheKey` session cache keys, Z.ai/ZhipuAI thinking enablement,
  Alibaba CN reasoning `enable_thinking`, Baseten/OpenCode chat-template
  thinking hints, and AI Gateway automatic caching hints.
- OpenRouter and LLM Gateway reasoning variants now mirror OpenCode's provider
  shape by translating requested flat `reasoning_effort` into
  `reasoning: { effort }` before forwarding chat/completions requests.
- Amazon Bedrock Anthropic reasoning variants now mirror OpenCode's Converse
  request shape by deriving `reasoningConfig` budgets from requested effort and
  forwarding them through the native Bedrock adapter.
- Default `codex` launcher behavior now uses the OpenAI profile without
  requiring MultiCodex proxy startup, while `codex-multi` owns strict unified
  provider startup. Codex management commands are passed through unchanged.
- SAP AI Core Anthropic reasoning variants now mirror OpenCode's wrapped
  `modelParams.thinking` shape and the native SAP adapter forwards those params
  into orchestration `model.params`.
- `opencodex install` no longer forces the user's top-level
  `~/.codex/config.toml` into the MultiCodex provider. It writes managed
  profiles/catalogs and cleans stale managed catalog/provider entries, leaving
  strict all-provider startup to `codex-multi` and OpenAI-only startup to
  `codex-oai`.

## Verified for v0.2.13

- `npm test`
- `npm run build`
- `git diff --check`
- `npm audit --audit-level=high`
- `npm --prefix web audit --audit-level=high`
- `npm publish --dry-run --access public`
- DigitalOcean cached router import fixtures for both CLI and web/admin import
  paths.
- OpenCode model `options.topK` / `top_k` request-default fixture.
- OpenCode model `options.providerOptions`, `options.providerMetadata`, and
  `options.experimental_providerMetadata` request-default fixture.
- OpenCode OpenRouter usage and Gemini 3 reasoning default fixture.
- Google native Gemini 3 `thinkingConfig` default fixture.
- Google native tool forwarding and Gemini function-call response conversion
  fixtures.
- Google native Gemini tool-schema sanitizer fixture.
- OpenCode provider identity default fixture for session cache keys, Z.ai
  thinking, Alibaba CN reasoning enablement, and gateway-style request hints.
- OpenCode OpenRouter reasoning variant fixture for request-effort mapping.
- OpenCode Amazon Bedrock Anthropic `reasoningConfig` variant fixture and native
  Bedrock adapter passthrough fixture.
- OpenCode SAP AI Core Anthropic `modelParams.thinking` reasoning fixture and
  native SAP adapter passthrough fixture.
- OpenCode Claude-compatible tool-call ID normalization fixture for
  OpenAI-compatible providers.
- OpenCode Claude-compatible prompt-caching hint fixture for OpenRouter-style
  OpenAI-compatible providers.
- Launcher regression coverage that proves the default `codex` wrapper uses the
  OpenAI profile without requiring proxy startup, while `codex-multi` remains
  the strict unified-provider launcher.
- Launcher regression coverage that proves `opencodex install` preserves the
  user's default Codex provider outside the managed `codex-multi`/`codex-oai`
  profiles.
- Packed npm tarball install smoke for `@ingwannu/opencodex`, confirming
  `opencodex doctor` can detect `managed-stale` wrappers that still point at an
  older source checkout and that `opencodex install` is the required rewrite
  step after npm upgrades.
- Packed npm tarball install smoke now also verifies the generated default
  `codex` launcher runs the detected real Codex binary and does not require
  proxy startup.
- OpenCode MiniMax M3 Anthropic adaptive-thinking fixture and native Anthropic
  adapter passthrough fixture.

## Known gaps

- Live end-to-end calls have not been run for every provider because they require
  real third-party accounts, subscriptions, and API keys.
- Poe is available as an OpenAI-compatible provider with API-key style auth, but
  OpenCode's browser OAuth plugin should still be smoke-tested against a real
  Poe account.
- Provider-specific edge transforms from OpenCode's `provider/transform.ts` are
  not exhaustively mirrored for every minor provider, though model option
  defaults now cover temperature, top-p, top-k, max output tokens, reasoning,
  include, text verbosity, variants, store, prompt-cache keys, usage hints,
  thinking flags/config, chat template args, and gateway caching hints.
- The unscoped `opencodex` npm package name is blocked by npm's similarity
  policy, so the npm package is published as `@ingwannu/opencodex`.
- Install should be followed by `opencodex install`; if a previous wrapper still
  prevents `codex` startup, `opencodex doctor` should show whether it is a stale
  managed wrapper, then `opencodex install` rewrites it.
- Real npm publishing is currently blocked until npm auth is refreshed; the
  latest published registry version observed locally is still `0.2.5`, and
  `npm whoami` currently returns `E401 Unauthorized`.

## Next update order

1. Add live smoke scripts for the major providers with opt-in environment keys.
2. Audit OpenCode `provider/transform.ts` for provider-specific request options
   that should be mirrored in the proxy.
3. Add Poe OAuth live smoke coverage once a test account is available.
4. Continue expanding minor provider fixtures from Models.dev and OpenCode's
   provider config surface.
