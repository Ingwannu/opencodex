import { useEffect, useRef, useState } from "react";
import AddProviderModal from "../components/AddProviderModal";
import { Notice } from "../ui";
import { IconPlus, IconTrash, IconLock, IconExternal } from "../icons";

interface Config {
  port: number;
  defaultProvider: string;
  providers: Record<string, { adapter: string; baseUrl: string; apiKey?: string; defaultModel?: string; authMode?: string }>;
}

interface OAuthStatus { loggedIn: boolean; email?: string; error?: string }

// Friendly labels for the OAuth providers the proxy supports.
const OAUTH_LABELS: Record<string, string> = {
  xai: "xAI (Grok)",
  anthropic: "Anthropic (Claude)",
  kimi: "Kimi (Moonshot)",
};
const oauthLabel = (id: string) => OAUTH_LABELS[id] ?? id;

export default function Providers({ apiBase }: { apiBase: string }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [oauthProviders, setOauthProviders] = useState<string[]>([]);
  const [oauthStatus, setOauthStatus] = useState<Record<string, OAuthStatus>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loginInfo, setLoginInfo] = useState<{ provider: string; url?: string; instructions?: string } | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch(`${apiBase}/api/config`);
      const data = await res.json();
      setConfig(data);
      setDraft(JSON.stringify(data, null, 2));
    } catch {
      setStatus("Failed to load config");
    }
  };

  // Load the list of OAuth-capable providers, then each one's login status.
  const fetchOauth = async () => {
    try {
      const provs: string[] = (await fetch(`${apiBase}/api/oauth/providers`).then(r => r.json())).providers ?? [];
      setOauthProviders(provs);
      const entries = await Promise.all(provs.map(async p => {
        const s = await fetch(`${apiBase}/api/oauth/status?provider=${p}`).then(r => r.json()).catch(() => ({ loggedIn: false }));
        return [p, s] as const;
      }));
      setOauthStatus(Object.fromEntries(entries));
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchConfig(); fetchOauth(); }, [apiBase]);

  const saveConfig = async () => {
    try {
      const parsed = JSON.parse(draft);
      const res = await fetch(`${apiBase}/api/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (res.ok) {
        setStatus("Saved! Restart proxy to apply.");
        setEditing(false);
        fetchConfig();
      } else {
        setStatus("Save failed");
      }
    } catch {
      setStatus("Invalid JSON");
    }
  };

  const loginOAuth = async (provider: string) => {
    setBusy(provider);
    setStatus("");
    setLoginInfo(null);
    try {
      const res = await fetch(`${apiBase}/api/oauth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (!res.ok) { setStatus(data.error || `${provider} login failed to start`); return; }
      // The server opens the browser itself (popup-safe). Show the URL/device code as a fallback.
      if (data.url || data.instructions) setLoginInfo({ provider, url: data.url, instructions: data.instructions });
      // Poll until the loopback callback (or device flow) completes.
      for (let i = 0; i < 150 && aliveRef.current; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const s: OAuthStatus | null = await fetch(`${apiBase}/api/oauth/status?provider=${provider}`).then(r => r.json()).catch(() => null);
        if (!s) continue;
        if (s.loggedIn) {
          setOauthStatus(prev => ({ ...prev, [provider]: s }));
          setStatus(`Logged in to ${oauthLabel(provider)}. Run ocx sync (or it applies live) to list its models.`);
          setLoginInfo(null);
          fetchConfig();
          break;
        }
        if (s.error) { setOauthStatus(prev => ({ ...prev, [provider]: s })); setStatus(`${provider} login error: ${s.error}`); break; }
      }
    } catch {
      setStatus(`${provider} login request failed`);
    } finally {
      if (aliveRef.current) setBusy(null);
    }
  };

  const logoutOAuth = async (provider: string) => {
    await fetch(`${apiBase}/api/oauth/logout?provider=${provider}`, { method: "POST" }).catch(() => {});
    setOauthStatus(prev => ({ ...prev, [provider]: { loggedIn: false } }));
    setStatus(`Logged out of ${oauthLabel(provider)}.`);
    fetchConfig();
  };

  const removeProvider = async (name: string) => {
    if (!window.confirm(`Remove provider "${name}"? Its models disappear from Codex's picker.`)) return;
    const res = await fetch(`${apiBase}/api/providers?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    if (res.ok) { setStatus(`Removed "${name}".`); fetchConfig(); fetchOauth(); }
    else setStatus(`Failed to remove "${name}".`);
  };

  if (!config) return <div className="muted">Loading…</div>;

  const statusOk = status.includes("Saved") || status.includes("Logged in") || status.includes("Removed") || status.includes("Added") || status.includes("Logged out");

  return (
    <>
      <div className="page-head">
        <h2>Providers</h2>
        <div className="row">
          {editing ? (
            <>
              <button className="btn btn-primary" onClick={saveConfig}>Save</button>
              <button className="btn btn-ghost" onClick={() => { setEditing(false); setDraft(JSON.stringify(config, null, 2)); }}>Cancel</button>
            </>
          ) : (
            <>
              <button className="btn btn-primary" onClick={() => setAdding(true)}><IconPlus />Add Provider</button>
              <button className="btn btn-ghost" onClick={() => setEditing(true)}>Edit JSON</button>
            </>
          )}
        </div>
      </div>
      <p className="page-sub">Configure the upstream providers opencodex routes into Codex. Log in with an account, add a provider, or edit the raw config.</p>

      {status && <Notice tone={statusOk ? "ok" : "err"}>{status}</Notice>}

      {/* OAuth Login — every OAuth-capable provider, with its live login status. */}
      <div className="panel panel-accent" style={{ marginBottom: 18 }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <IconLock style={{ width: 16, height: 16, color: "var(--accent)" }} />
          <span style={{ fontWeight: 600 }}>Account login</span>
        </div>
        <div className="stack" style={{ gap: 12 }}>
          {oauthProviders.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No OAuth providers available.</span>}
          {oauthProviders.map(p => {
            const st = oauthStatus[p] ?? { loggedIn: false };
            const isBusy = busy === p;
            return (
              <div key={p} className="row" style={{ flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, minWidth: 170, display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{oauthLabel(p)}</span>
                  {st.loggedIn ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--green)" }}>
                      <span className="dot dot-green" />logged in{st.email ? ` (${st.email})` : ""}
                    </span>
                  ) : (
                    <span className="muted">not logged in</span>
                  )}
                </span>
                {st.loggedIn ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => logoutOAuth(p)}>Logout</button>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={() => loginOAuth(p)} disabled={isBusy}>
                    {isBusy ? <><span className="spin" />Waiting for browser…</> : <><IconLock />Login with {oauthLabel(p)}</>}
                  </button>
                )}
                {loginInfo?.provider === p && (loginInfo.url || loginInfo.instructions) && (
                  <span className="muted" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 8 }}>
                    {loginInfo.url && <a href={loginInfo.url} target="_blank" rel="noreferrer" className="link-btn" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><IconExternal />Didn't open? Click here</a>}
                    {loginInfo.instructions && <span>{loginInfo.instructions}</span>}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {editing ? (
        <textarea
          className="input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          style={{ height: 400 }}
        />
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
            Port: <code className="chip">{config.port}</code> · Default: <code className="chip">{config.defaultProvider}</code>
          </div>
          {Object.entries(config.providers).map(([name, prov]) => (
            <div key={name} className="card prov-card">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <span style={{ fontWeight: 600 }}>{name}</span>
                  {prov.authMode === "oauth" && <span className="badge badge-accent">oauth</span>}
                  {prov.authMode === "forward" && <span className="badge badge-amber">passthrough</span>}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  <code className="chip">{prov.adapter}</code> · {prov.baseUrl}
                  {prov.defaultModel && <> · {prov.defaultModel}</>}
                  {prov.apiKey && <> · {prov.apiKey}</>}
                </div>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => removeProvider(name)} aria-label={`Remove ${name}`} style={{ flexShrink: 0 }}><IconTrash />Remove</button>
            </div>
          ))}
        </div>
      )}
      {adding && (
        <AddProviderModal
          apiBase={apiBase}
          existingNames={Object.keys(config.providers)}
          onClose={() => setAdding(false)}
          onAdded={(name) => { setAdding(false); setStatus(`Added "${name}". Live now — run ocx sync (or restart) to list its models in Codex's picker.`); fetchConfig(); fetchOauth(); }}
        />
      )}
    </>
  );
}
