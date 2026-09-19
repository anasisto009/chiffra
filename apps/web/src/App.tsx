import { useState } from "react";
import { Dashboard } from "./pages/Dashboard";
import { Upload } from "./pages/Upload";
import "./styles.css";

type Page = "upload" | "dashboard";

export function App() {
  const [page, setPage] = useState<Page>("upload");

  return (
    <main className="app-shell">
      <nav className="topbar">
        <strong>Chiffra</strong>
        <div className="topbar__tabs">
          <button
            className={page === "upload" ? "topbar__tab topbar__tab--active" : "topbar__tab"}
            type="button"
            onClick={() => setPage("upload")}
          >
            Upload
          </button>
          <button
            className={page === "dashboard" ? "topbar__tab topbar__tab--active" : "topbar__tab"}
            type="button"
            onClick={() => setPage("dashboard")}
          >
            Anomalies
          </button>
        </div>
      </nav>
      {page === "upload" ? <Upload /> : <Dashboard />}
    </main>
  );
}
