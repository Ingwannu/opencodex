import { useEffect, useState } from "react";

interface LogEntry {
  timestamp: number;
  model: string;
  provider: string;
  status: number;
  durationMs: number;
}

export default function Logs({ apiBase }: { apiBase: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await fetch(`${apiBase}/api/logs`);
        setLogs(await res.json());
      } catch { /* ignore */ }
    };
    fetchLogs();
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [apiBase, autoRefresh]);

  const statusColor = (s: number) => s >= 200 && s < 300 ? "var(--green)" : s >= 400 ? "var(--red)" : "var(--amber)";

  return (
    <>
      <div className="page-head">
        <h2>Request Logs</h2>
        <label className="muted" style={{ fontSize: 13, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          Auto-refresh
        </label>
      </div>
      <p className="page-sub">Recent requests routed through the local opencodex proxy, newest first.</p>

      {logs.length === 0 ? (
        <div className="empty">No requests yet.</div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Time</th>
                <th>Model</th>
                <th>Provider</th>
                <th>Status</th>
                <th className="num">Duration</th>
              </tr>
            </thead>
            <tbody>
              {[...logs].reverse().map((log, i) => (
                <tr key={i}>
                  <td className="muted mono">{new Date(log.timestamp).toLocaleTimeString()}</td>
                  <td className="mono">{log.model}</td>
                  <td className="muted">{log.provider}</td>
                  <td>
                    <span className="mono" style={{ color: statusColor(log.status), fontWeight: 600 }}>{log.status}</span>
                  </td>
                  <td className="num">{log.durationMs}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
