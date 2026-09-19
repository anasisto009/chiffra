import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../api";
import { ReviewPanel } from "../components/ReviewPanel";

type Severity = "low" | "medium" | "high";
type AnomalyStatus = "pending" | "validated" | "rejected";

export type AnomalyRow = {
  id: string;
  invoice_id: string;
  type: string;
  description: string;
  exposure_mad: string;
  severity: Severity;
  status: AnomalyStatus;
  vendor?: string;
  date?: string;
  invoice_number?: string;
  filename?: string;
};

export type AnomalyDetail = AnomalyRow & {
  raw_text?: string;
  amount_ht?: string;
  tva?: string;
  amount_ttc?: string;
};

type AnomaliesResponse = {
  anomalies: AnomalyRow[];
};

type DetailResponse = {
  anomaly: AnomalyDetail;
};

function formatMad(value: string): string {
  return `${Number(value).toLocaleString("fr-MA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} MAD`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

export function Dashboard() {
  const [anomalies, setAnomalies] = useState<AnomalyRow[]>([]);
  const [selected, setSelected] = useState<AnomalyDetail | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<AnomaliesResponse>("/api/anomalies")
      .then((payload) => setAnomalies(payload.anomalies))
      .catch(() => setError("Unable to load anomalies."));
  }, []);

  const types = useMemo(() => unique(anomalies.map((anomaly) => anomaly.type)), [anomalies]);
  const totalExposure = useMemo(
    () =>
      filteredAnomalies(anomalies, typeFilter, severityFilter, statusFilter).reduce(
        (sum, anomaly) => sum + Number(anomaly.exposure_mad),
        0
      ),
    [anomalies, severityFilter, statusFilter, typeFilter]
  );
  const visible = useMemo(
    () => filteredAnomalies(anomalies, typeFilter, severityFilter, statusFilter),
    [anomalies, severityFilter, statusFilter, typeFilter]
  );

  async function openSource(anomaly: AnomalyRow): Promise<void> {
    const detail = await apiGet<DetailResponse>(`/api/anomalies/${anomaly.id}`);
    setSelected(detail.anomaly);
  }

  return (
    <section className="workspace">
      <div className="workspace__header">
        <div>
          <p className="eyebrow">T12 Risk dashboard</p>
          <h1>Anomalies</h1>
        </div>
        <div className="summary-strip summary-strip--danger">
          <span>Total exposure</span>
          <strong>{formatMad(totalExposure.toFixed(2))}</strong>
        </div>
      </div>

      {error ? <p className="notice notice--danger">{error}</p> : null}

      <div className="filters">
        <label>
          Type
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="all">All</option>
            {types.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label>
          Severity
          <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}>
            <option value="all">All</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label>
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="validated">Validated</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
      </div>

      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Vendor</th>
              <th>Date</th>
              <th>Exposure</th>
              <th>Severity</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((anomaly) => (
              <tr key={anomaly.id} onClick={() => void openSource(anomaly)}>
                <td>{anomaly.type}</td>
                <td>{anomaly.vendor ?? "Unknown"}</td>
                <td>{anomaly.date ?? "-"}</td>
                <td>{formatMad(anomaly.exposure_mad)}</td>
                <td>
                  <span className={`badge badge--${anomaly.severity}`}>{anomaly.severity}</span>
                </td>
                <td>
                  <span className={`status-pill status-pill--${anomaly.status}`}>
                    {anomaly.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 ? <div className="empty-state">No anomalies match these filters.</div> : null}
      </div>

      {selected ? (
        <ReviewPanel
          anomaly={selected}
          onClose={() => setSelected(null)}
          onReviewed={(status) => {
            setAnomalies((current) =>
              current.map((anomaly) =>
                anomaly.id === selected.id ? { ...anomaly, status } : anomaly
              )
            );
            setSelected({ ...selected, status });
          }}
        />
      ) : null}
    </section>
  );
}

function filteredAnomalies(
  anomalies: AnomalyRow[],
  typeFilter: string,
  severityFilter: string,
  statusFilter: string
): AnomalyRow[] {
  return anomalies
    .filter((anomaly) => typeFilter === "all" || anomaly.type === typeFilter)
    .filter((anomaly) => severityFilter === "all" || anomaly.severity === severityFilter)
    .filter((anomaly) => statusFilter === "all" || anomaly.status === statusFilter)
    .sort((left, right) => Number(right.exposure_mad) - Number(left.exposure_mad));
}
