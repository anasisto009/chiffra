import { AGENT_IDS, formatMad } from "@chiffra/shared";
import "./styles.css";

const agentLabels: Record<(typeof AGENT_IDS)[number], string> = {
  ingestor: "Ingestor",
  reconciler: "Reconciler",
  auditor: "Auditor",
  explainer: "Explainer"
};

export function App() {
  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Comptabilite marocaine multi-agents</p>
          <h1>Chiffra</h1>
          <p className="lede">
            Orchestration IA pour ingestion, rapprochement, audit fiscal et explication des anomalies.
          </p>
        </div>
        <div className="metric" aria-label="Exemple d'exposition">
          <span>Exposition test</span>
          <strong>{formatMad("12500.00")}</strong>
        </div>
      </section>

      <section className="agent-grid" aria-label="Agents Chiffra">
        {AGENT_IDS.map((agentId) => (
          <article className="agent-card" key={agentId}>
            <span>{agentId}</span>
            <h2>{agentLabels[agentId]}</h2>
          </article>
        ))}
      </section>
    </main>
  );
}

