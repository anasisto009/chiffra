import { useState } from "react";
import { apiPost } from "../api";
import type { ApiAnomaly } from "../features/mvp/useMvpData";

export type AnomalyDetail = ApiAnomaly & {
  raw_text?: string;
};

type ReviewPanelProps = {
  anomaly: AnomalyDetail;
  onClose: () => void;
  onReviewed: (status: "validated" | "rejected") => void;
};

function formatMad(value: string): string {
  return `${Number(value).toLocaleString("fr-MA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} MAD`;
}

export function ReviewPanel({ anomaly, onClose, onReviewed }: ReviewPanelProps) {
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(decision: "validated" | "rejected"): Promise<void> {
    setIsSubmitting(true);
    setError(null);

    try {
      await apiPost(`/api/anomalies/${anomaly.id}/review`, {
        decision,
        note
      });
      onReviewed(decision);
    } catch {
      setError("Review was not saved.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <aside className="review-panel">
      <div className="review-panel__header">
        <div>
          <span>Human review</span>
          <strong>{anomaly.type}</strong>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="review-panel__facts">
        <div>
          <span>Exposure</span>
          <strong>{formatMad(anomaly.exposure_mad)}</strong>
        </div>
        <div>
          <span>Severity</span>
          <strong>{anomaly.severity}</strong>
        </div>
      </div>

      <p className="review-panel__description">{anomaly.description}</p>

      <div className="review-panel__source">
        <span>Document source</span>
        <pre>{anomaly.raw_text || "No extracted text available."}</pre>
      </div>

      <label className="review-panel__note">
        Optional note
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} />
      </label>

      {error ? <p className="notice notice--danger">{error}</p> : null}

      <div className="review-panel__actions">
        <button
          className="review-panel__validate"
          type="button"
          disabled={isSubmitting}
          onClick={() => void submit("validated")}
        >
          Validate
        </button>
        <button
          className="review-panel__reject"
          type="button"
          disabled={isSubmitting}
          onClick={() => void submit("rejected")}
        >
          Reject
        </button>
      </div>
    </aside>
  );
}

