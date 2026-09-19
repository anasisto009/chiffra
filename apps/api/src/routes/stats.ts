import type { FastifyInstance } from "fastify";
import { pool } from "../db/client.js";

export async function registerStatsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/stats", async () => {
    const result = await pool.query(
      `WITH doc_stats AS (
         SELECT
           COUNT(*)::int AS total_docs,
           COUNT(*) FILTER (WHERE status = 'done')::int AS processed,
           COUNT(*) FILTER (WHERE status = 'non_traite')::int AS non_traite
         FROM documents
       ),
       invoice_stats AS (
         SELECT COUNT(*)::numeric AS total_invoices FROM invoices
       ),
       match_stats AS (
         SELECT COUNT(DISTINCT matched_invoice_id)::numeric AS matched_invoices
         FROM bank_lines
         WHERE matched_invoice_id IS NOT NULL
       ),
       anomaly_stats AS (
         SELECT
           COUNT(*) FILTER (WHERE severity = 'high')::int AS anomalies_high,
           COUNT(*) FILTER (WHERE severity = 'medium')::int AS anomalies_medium,
           COUNT(*) FILTER (WHERE severity = 'low')::int AS anomalies_low
         FROM anomalies
       ),
       exposure_stats AS (
         SELECT COALESCE(SUM(exposure_mad), 0)::numeric(18, 2) AS total_exposure_mad
         FROM anomalies
         WHERE status = 'pending'
       ),
       time_stats AS (
         SELECT
           COALESCE(EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))), 0)::int
             AS processing_time_seconds
         FROM documents
       )
       SELECT
         doc_stats.total_docs,
         doc_stats.processed,
         doc_stats.non_traite,
         CASE
           WHEN doc_stats.total_docs = 0 THEN '0.00'
           ELSE ROUND((doc_stats.processed::numeric / doc_stats.total_docs::numeric) * 100, 2)::text
         END AS processed_percentage,
         CASE
           WHEN invoice_stats.total_invoices = 0 THEN '0.00'
           ELSE ROUND((match_stats.matched_invoices / invoice_stats.total_invoices) * 100, 2)::text
         END AS match_rate,
         match_stats.matched_invoices::int,
         invoice_stats.total_invoices::int,
         anomaly_stats.anomalies_high,
         anomaly_stats.anomalies_medium,
         anomaly_stats.anomalies_low,
         exposure_stats.total_exposure_mad::text,
         time_stats.processing_time_seconds
       FROM doc_stats, invoice_stats, match_stats, anomaly_stats, exposure_stats, time_stats`
    );

    return result.rows[0];
  });
}
