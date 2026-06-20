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
- OpenCode configured model provider metadata defaults are forwarded to upstream
  requests via `providerOptions` and `experimental_providerMetadata`, preserving
  provider-specific cache/control hints when the caller did not override them.
- Default `codex` launcher fail-open behavior now falls back through the OpenAI
  profile when the MultiCodex proxy cannot start, so an installed wrapper should
  not trap normal Codex startup on a broken proxy.
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
- Launcher regression coverage that proves the default `codex` wrapper falls
  back to the real Codex CLI when the MultiCodex proxy cannot start.
- Launcher regression coverage that proves `opencodex install` preserves the
  user's default Codex provider outside the managed `codex-multi`/`codex-oai`
  profiles.
- Packed npm tarball install smoke for `@ingwannu/opencodex`, confirming
  `opencodex doctor` can detect `managed-stale` wrappers that still point at an
  older source checkout and that `opencodex install` is the required rewrite
  step after npm upgrades.

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
