# GUI And Management API SOT

## Dashboard serving

The bundled React dashboard is built into `gui/dist` and served by the same Bun proxy. `ocx gui`
starts the proxy when needed and opens `http://localhost:<port>`.

## API ownership

Management endpoints live in `src/server.ts` under `/api/*`:

| Endpoint area | Responsibility |
| --- | --- |
| Config | Read/write `~/.opencodex/config.json`; mask secrets on read. |
| Providers | Create/update/delete provider configs and enrich registry metadata. |
| Models | Fetch routed model lists, disabled model visibility, and catalog-facing ids. |
| OAuth | Login/status/logout for OAuth-backed providers. |
| Key providers | Expose API-key provider presets for setup and dashboard flows. |
| Subagents | Read/write the featured `subagentModels` list capped at five ids. |
| Logs | Surface request/runtime logs for local diagnosis. |
| Stop | `POST /api/stop` — restore native Codex, stop any installed service, and exit the proxy. |

Provider writes must not round-trip masked API keys as real secrets. Dashboard actions that change
model visibility or subagent selection should trigger catalog/cache sync behavior through the server
path that owns it.

## Sidebar stop button

The dashboard sidebar includes a stop button that calls `POST /api/stop`. The button shows a
confirmation prompt, then fires the request and accepts the connection drop (the proxy exits). The
endpoint restores native Codex config, stops any installed service to prevent respawn, and exits.

## UX boundary

The dashboard is a local control surface, not a separate service. It should reflect the same config
and catalog invariants documented in this folder rather than inventing parallel state.
