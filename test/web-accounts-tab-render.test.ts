import test from "node:test";
import assert from "node:assert/strict";
import React from "../web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../web/node_modules/react-dom/server.node.js";

import { AccountsTab } from "../web/src/components/tabs/AccountsTab";
import type { TraceStats } from "../web/src/types";

const emptyTraceStats: TraceStats = {
  totals: {
    requests: 0,
    errors: 0,
    errorRate: 0,
    tokensInput: 0,
    tokensOutput: 0,
    tokensTotal: 0,
    costUsd: 0,
    latencyAvgMs: 0,
  },
  models: [],
  timeseries: [],
};

const noop = async () => {};

test("AccountsTab renders the OpenCode account import management surface", () => {
  const html = renderToStaticMarkup(
    React.createElement(AccountsTab, {
      traceStats: emptyTraceStats,
      accounts: [],
      providers: [],
      settings: {},
      sanitized: false,
      patch: noop,
      del: noop,
      unblock: noop,
      refreshUsage: noop,
      createAccount: noop,
      importOpenCodeAuth: async () => ({}),
      patchSettings: noop,
      startOAuth: async () => ({}),
      completeOAuth: async () => ({}),
      oauthRedirectUri: "http://127.0.0.1/auth/callback",
    }),
  );

  assert.match(html, /Accounts/);
  assert.match(html, /Add account/);
  assert.match(html, /Import OpenCode auth/);
  assert.match(html, /OpenCode auth path/);
  assert.match(html, /OpenCode auth content/);
  assert.match(html, /OpenCode config path/);
  assert.match(html, /OpenCode config content/);
  assert.match(html, /id="opencode-auth-path"/);
  assert.match(html, /id="opencode-auth-content"/);
  assert.match(html, /id="opencode-config-path"/);
  assert.match(html, /id="opencode-config-content"/);
});
