export type ApiErrorBody = {
  error?: string;
  message?: string;
};

export type StatsResponse = {
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
