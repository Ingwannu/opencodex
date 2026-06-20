import { useEffect, useMemo, useState } from "react";
import { Notice } from "../ui";
import { IconArrowUp, IconArrowDown, IconX, IconCheck, IconSearch, IconBot } from "../icons";

export default function Subagents({ apiBase }: { apiBase: string }) {
  const [available, setAvailable] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const r = await fetch(`${apiBase}/api/subagent-models`).then(res => res.json());
      const avail: string[] = r.available ?? [];
      setAvailable(avail);
      setChosen((r.chosen ?? []).filter((m: string) => avail.includes(m)));
    } catch {
      setOk(false);
      setStatus("Failed to load models — is the proxy running?");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [apiBase]);

  const toggle = (m: string) => {
    setStatus("");
    setChosen(prev => prev.includes(m) ? prev.filter(x => x !== m) : (prev.length >= 5 ? prev : [...prev, m]));
  };
  const move = (i: number, dir: -1 | 1) => {
    setChosen(prev => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const save = async () => {
    setStatus("");
    try {
      const r = await fetch(`${apiBase}/api/subagent-models`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models: chosen }),
      });
      const d = await r.json();
      setOk(r.ok);
      setStatus(r.ok
        ? `Saved ${d.applied?.length ?? 0} models. Start a new Codex session (or run 'ocx sync') to see them as spawn_agent overrides.`
        : (d.error || "Save failed"));
    } catch {
      setOk(false);
      setStatus("Network error — is the proxy running?");
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return available.filter(m => !q || m.toLowerCase().includes(q));
  }, [available, query]);

  if (loading) return <div className="muted" style={{ padding: 8 }}>Loading…</div>;

  return (
    <>
      <div className="page-head"><h2>Subagents</h2></div>
      <p className="page-sub">
        Codex's <code className="chip">spawn_agent</code> advertises only the first <b>5</b> models (by priority) as overrides.
        Pick up to 5 here — native gpt or routed — and opencodex sets their catalog priority so exactly
        these lead. Any other model is still callable by its exact name; this only controls what's shown.
      </p>

      {status && <Notice tone={ok ? "ok" : "err"}>{status}</Notice>}

      <div className="h-section">Featured <span className="count">{chosen.length}/5</span></div>
      {chosen.length === 0 ? (
        <div className="empty">None selected — pick from the list below.</div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {chosen.map((m, i) => (
            <div key={m} className="card panel-accent row" style={{ padding: "8px 12px", gap: 10 }}>
              <span className="mono" style={{ width: 18, color: "var(--accent)", fontWeight: 700 }}>{i + 1}</span>
              <code className="mono" style={{ flex: 1, color: "var(--text)" }}>{m}</code>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${m} up`}>
                <IconArrowUp />
              </button>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => move(i, 1)} disabled={i === chosen.length - 1} aria-label={`Move ${m} down`}>
                <IconArrowDown />
              </button>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => toggle(m)} aria-label={`Remove ${m}`} style={{ color: "var(--red)" }}>
                <IconX />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <button className="btn btn-primary" onClick={save}>Save</button>
      </div>

      <div className="h-section">Models <span className="count">{filtered.length}</span></div>
      <div style={{ position: "relative", marginBottom: 10 }}>
        <IconSearch style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", width: 15, height: 15, color: "var(--faint)", pointerEvents: "none" }} />
        <input
          className="input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search models (native gpt + routed)…"
          style={{ paddingLeft: 34 }}
        />
      </div>
      <div className="stack" style={{ gap: 6, maxHeight: 360, overflowY: "auto" }}>
        {filtered.map(m => {
          const sel = chosen.includes(m);
          const full = !sel && chosen.length >= 5;
          return (
            <button
              key={m}
              className="card row"
              onClick={() => toggle(m)}
              disabled={full}
              aria-pressed={sel}
              style={{
                padding: "9px 12px", gap: 10, width: "100%", textAlign: "left", cursor: full ? "not-allowed" : "pointer",
                opacity: full ? 0.45 : 1,
                background: sel ? "var(--accent-soft)" : undefined,
                borderColor: sel ? "var(--accent-ring)" : undefined,
              }}
            >
              <span style={{ width: 16, height: 16, flexShrink: 0, color: "var(--accent)", display: "inline-flex" }}>
                {sel && <IconCheck style={{ width: 16, height: 16 }} />}
              </span>
              <IconBot style={{ width: 15, height: 15, color: "var(--faint)", flexShrink: 0 }} />
              <code className="mono" style={{ color: "var(--text)" }}>{m}</code>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="empty">No models — log into a provider or add one first.</div>
        )}
      </div>
    </>
  );
}
