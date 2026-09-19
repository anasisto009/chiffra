import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../../api";

export type ApiDocument = {
  id: string;
  filename: string;
  type: string;
  /** Status as stored in DB: PROCESSED | UNREADABLE | pending | processing */
  status: string;
  failure_reason?: string | null;
  reason?: string | null;
  message?: string | null;
  created_at: string;
  progress?: number;
};

/** Normalized document with UI-friendly status */
export type NormalizedDocument = Omit<ApiDocument, 'status'> & {
  status: 'done' | 'non_traite' | 'processing' | 'pending';
};

function normalizeDocStatus(raw: ApiDocument): NormalizedDocument {
  let status: NormalizedDocument['status'];
  switch (raw.status?.toUpperCase()) {
    case 'PROCESSED': status = 'done'; break;
    case 'UNREADABLE': status = 'non_traite'; break;
    case 'PROCESSING': status = 'processing'; break;
    default: status = 'pending';
  }
  // Expose failure_reason as reason for backwards-compat rendering
  return {
    ...raw,
    status,
    reason: raw.failure_reason ?? raw.reason ?? null,
  };
}

export function useDocuments() {
  return useQuery({
    queryKey: ["documents"],
    queryFn: async () => {
      const raw = await apiGet<{ documents: ApiDocument[] }>("/api/documents");
      return raw.documents.map(normalizeDocStatus);
    },
    refetchInterval: 2000
  });
}

/** @deprecated Use useDocuments() instead */
export function useMockDocuments() {
  return useDocuments();
}

export type ApiAnomaly = {
  id: string;
  invoice_id: string;
  document_id?: string;
  type: string;
  description: string;
  exposure_mad: string;
  severity: "low" | "medium" | "high";
  status: "pending" | "validated" | "rejected";
  vendor?: string;
  date?: string;
  invoice_number?: string;
  filename?: string;
  details?: any;
};

export type ApiStats = {
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


export function useMockMetrics() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: () => apiGet<ApiStats>("/api/stats"),
    refetchInterval: 3000
  });
}

export function useMockAnomalies() {
  return useQuery({
    queryKey: ["anomalies"],
    queryFn: async () => (await apiGet<{ anomalies: ApiAnomaly[] }>("/api/anomalies")).anomalies,
    refetchInterval: 3000
  });
}

export function useReviewAnomaly() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      anomalyId,
      decision,
      note
    }: {
      anomalyId: string;
      decision: "validated" | "rejected";
      note?: string;
    }) => {
      return apiPost<{ anomaly: ApiAnomaly }>(`/api/anomalies/${anomalyId}/review`, {
        decision,
        note: note || (decision === "validated" ? "Validé par le comptable" : "Rejeté lors de la revue")
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["anomalies"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    }
  });
}
