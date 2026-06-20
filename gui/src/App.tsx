import { useState } from "react";
import Dashboard from "./pages/Dashboard";
import Providers from "./pages/Providers";
import Models from "./pages/Models";
import Subagents from "./pages/Subagents";
import Logs from "./pages/Logs";
import { IconGrid, IconServer, IconBoxes, IconBot, IconList, IconGithub } from "./icons";

type Page = "dashboard" | "providers" | "models" | "subagents" | "logs";

const API_BASE = import.meta.env.VITE_API_BASE || "";

const NAV: { id: Page; label: string; Icon: typeof IconGrid }[] = [
  { id: "dashboard", label: "Dashboard", Icon: IconGrid },
  { id: "providers", label: "Providers", Icon: IconServer },
  { id: "models", label: "Models", Icon: IconBoxes },
  { id: "subagents", label: "Subagents", Icon: IconBot },
  { id: "logs", label: "Logs", Icon: IconList },
];

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.png" alt="" />
          <span className="name">opencodex</span>
          <span className="ver">v0.0.1</span>
        </div>
        <nav>
          {NAV.map(({ id, label, Icon }) => (
            <button key={id} className={`nav-item${page === id ? " active" : ""}`} onClick={() => setPage(id)}
              aria-current={page === id ? "page" : undefined}>
              <Icon /> {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <a className="sidebar-link" href="https://github.com/Ingwannu/opencodex" target="_blank" rel="noreferrer">
            <IconGithub /> GitHub
          </a>
        </div>
      </aside>

      <main className="main">
        <div className="main-inner">
          {page === "dashboard" && <Dashboard apiBase={API_BASE} />}
          {page === "providers" && <Providers apiBase={API_BASE} />}
          {page === "models" && <Models apiBase={API_BASE} />}
          {page === "subagents" && <Subagents apiBase={API_BASE} />}
          {page === "logs" && <Logs apiBase={API_BASE} />}
        </div>
      </main>
    </div>
  );
}
