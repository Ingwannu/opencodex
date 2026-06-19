# Publishing

The package name is `opencodex`. The public npm name was unclaimed when this
package metadata was prepared.

## Local verification

```bash
npm ci
npm --prefix web ci
npm run build
npm run pack:check
```

Check the `npm pack --dry-run` output before publishing. The tarball should
include only package metadata plus:

- `bin/`
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
npm install -g opencodex
opencodex install
opencodex doctor
```

`opencodex install` writes managed wrappers to `~/.local/bin` and stores runtime
state in `~/.codex/opencodex/data` by default. Running `codex` after install
lazily starts the local proxy if it is not already healthy.
