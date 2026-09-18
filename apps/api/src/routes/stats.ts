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
       exposure_stats AS (
         SELECT COALESCE(SUM(exposure_mad), 0)::numeric(18, 2) AS total_exposure_mad
         FROM anomalies
         WHERE status = 'pending'
       )
       SELECT
         doc_stats.total_docs,
         doc_stats.processed,
         doc_stats.non_traite,
         CASE
           WHEN invoice_stats.total_invoices = 0 THEN '0.00'
           ELSE ROUND((match_stats.matched_invoices / invoice_stats.total_invoices) * 100, 2)::text
         END AS match_rate,
         exposure_stats.total_exposure_mad::text
       FROM doc_stats, invoice_stats, match_stats, exposure_stats`
    );

    return result.rows[0];
  });
}

