# Publishing

The package name is `@ingwannu/opencodex`. The unscoped `opencodex` name was
rejected by npm because it is too similar to an existing package.

## Local verification

```bash
npm ci
npm --prefix web ci
npm test
npm run build
git diff --check
node --check bin/codex-multicodex.js
npm audit --audit-level=high
npm --prefix web audit --audit-level=high
npm pack --dry-run --json --ignore-scripts
npm publish --dry-run --access public
```

Check the `npm pack --dry-run` output before publishing. The tarball should
include only package metadata plus:

- `bin/`
- `docs/`
- `dist/`
- `web-dist/`
- `README.md`
- `PUBLISHING.md`

It must not include `data/`, tokens, traces, logs, `.env`, `node_modules/`, or
local Codex/agent state.

## Publish

```bash
npm login
npm publish --access public
```

## User install

```bash
npm install -g @ingwannu/opencodex
opencodex install
opencodex doctor
```

`opencodex install` writes managed wrappers to `~/.local/bin` and stores runtime
state in `~/.codex/opencodex/data` by default. Running `codex` after install
lazily starts the local proxy if it is not already healthy.
