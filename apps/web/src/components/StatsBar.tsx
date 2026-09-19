import { useEffect, useState } from "react";
import { apiGet } from "../api";

type Stats = {
  total_docs: number;
  processed: number;
  non_traite: number;
  processed_percentage: string;
  match_rate: string;
  matched_invoices: number;
  total_invoices: number;
  anomalies_high: number;
  anomalies_medium: number;
  anomalies_low: number;
  total_exposure_mad: string;
  processing_time_seconds: number;
};

function formatMad(value: string): string {
  return `${Number(value).toLocaleString("fr-MA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} MAD`;
}

export function StatsBar() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    void apiGet<Stats>("/api/stats")
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  if (!stats) {
    return (
      <section className="stats-bar">
        <div>
          <span>Stats</span>
          <strong>Loading</strong>
        </div>
      </section>
    );
  }

  return (
    <section className="stats-bar" aria-label="Honest processing metrics">
      <div>
        <span>Total docs</span>
        <strong>{stats.total_docs}</strong>
      </div>
      <div>
        <span>Processed</span>
        <strong>
          {stats.processed}/{stats.total_docs} ({stats.processed_percentage}%)
        </strong>
      </div>
      <div>
        <span>Non traite</span>
        <strong>{stats.non_traite}</strong>
      </div>
      <div>
        <span>Match rate</span>
        <strong>
          {stats.match_rate}% ({stats.matched_invoices}/{stats.total_invoices})
        </strong>
      </div>
      <div>
        <span>Anomalies</span>
        <strong>
          H{stats.anomalies_high} / M{stats.anomalies_medium} / L{stats.anomalies_low}
        </strong>
      </div>
      <div>
        <span>Exposure</span>
        <strong>{formatMad(stats.total_exposure_mad)}</strong>
      </div>
      <div>
        <span>Processing time</span>
        <strong>{stats.processing_time_seconds}s</strong>
      </div>
    </section>
  );
}

