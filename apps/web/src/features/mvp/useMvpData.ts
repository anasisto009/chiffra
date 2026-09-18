import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../../api";

export type ApiDocument = {
  id: string;
  filename: string;
  type: string;
  status: "pending" | "processing" | "done" | "non_traite";
  reason?: string | null;
  message?: string | null;
  created_at: string;
  progress?: number;
};

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

export function useMockDocuments() {
  return useQuery({
    queryKey: ["documents"],
    queryFn: async () => (await apiGet<{ documents: ApiDocument[] }>("/api/documents")).documents,
    refetchInterval: 2000
  });
}

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
