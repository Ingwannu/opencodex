# OpenCodex v0 Status and Next Work

This document tracks the v0 release boundary separately from the larger goal of
full OpenCode provider parity.

## v0.2.2 shipped surface

- One Codex launcher/proxy surface for OpenAI, local, and OpenAI-compatible
  providers.
- Web account management for adding, editing, enabling, disabling, deleting,
  and importing provider accounts.
- OpenCode `auth.json`, current credential records, pasted auth/config content,
  and `opencode.json/jsonc` provider config import.
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

## Verified for v0.2.2

- `npm test`
- `npm run build`
- `git diff --check`
- `npm audit --audit-level=high`
- `npm --prefix web audit --audit-level=high`
- `npm publish --dry-run --access public`

## Known gaps

- Live end-to-end calls have not been run for every provider because they require
  real third-party accounts, subscriptions, and API keys.
- DigitalOcean is available as an OpenAI-compatible provider, but OpenCode's
  OAuth plugin also merges `metadata.routers` into `router:<name>` models. That
  router model merge still needs first-class parity.
- Poe is available as an OpenAI-compatible provider with API-key style auth, but
  OpenCode's browser OAuth plugin should still be smoke-tested against a real
  Poe account.
- Provider-specific edge transforms from OpenCode's `provider/transform.ts` are
  not exhaustively mirrored for every minor provider.
- The unscoped `opencodex` npm package name is blocked by npm's similarity
  policy, so the npm package is published as `@ingwannu/opencodex`.

## Next update order

1. Add DigitalOcean router metadata import so OpenCode OAuth credentials expose
   `router:<name>` models locally.
2. Add live smoke scripts for the major providers with opt-in environment keys.
3. Audit OpenCode `provider/transform.ts` for provider-specific request options
   that should be mirrored in the proxy.
4. Add Poe OAuth live smoke coverage once a test account is available.
5. Continue expanding minor provider fixtures from Models.dev and OpenCode's
   provider config surface.
