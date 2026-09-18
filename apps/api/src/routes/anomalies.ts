import type { FastifyInstance } from "fastify";
import { pool } from "../db/client.js";
import { auditInvoices, type AuditInvoice } from "../agents/auditor.js";
import { reconcileBankLines, type ReconciliationBankLine, type ReconciliationInvoice } from "../agents/reconciler.js";

export async function registerAnomalyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/anomalies", async () => {
    const result = await pool.query(
      `SELECT DISTINCT ON (anomalies.id)
         anomalies.*,
         invoices.vendor,
         invoices.date,
         invoices.invoice_number,
         documents.id AS document_id,
         documents.filename
       FROM anomalies
       LEFT JOIN invoices ON invoices.id = anomalies.invoice_id
       LEFT JOIN documents ON documents.id = invoices.document_id
       ORDER BY anomalies.id, anomalies.exposure_mad DESC`
    );

    // Re-sort by exposure_mad DESC after DISTINCT
    const sorted = result.rows.sort(
      (a, b) => Number.parseFloat(b.exposure_mad || "0") - Number.parseFloat(a.exposure_mad || "0")
    );

    return {
      anomalies: sorted
    };
  });

  app.get<{ Params: { id: string } }>("/api/anomalies/:id", async (request, reply) => {
    const result = await pool.query(
      `SELECT anomalies.*, invoices.*, documents.id AS document_id, documents.filename, documents.raw_text
       FROM anomalies
       LEFT JOIN invoices ON invoices.id = anomalies.invoice_id
       LEFT JOIN documents ON documents.id = invoices.document_id
       WHERE anomalies.id = $1`,
      [request.params.id]
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({
        error: "anomaly_not_found"
      });
    }

    return {
      anomaly: result.rows[0]
    };
  });

  app.all("/api/audit/run", async () => {
    const [invoicesRes, vendorsRes] = await Promise.all([
      pool.query<AuditInvoice & { id: string }>(
        `SELECT id, vendor, date::text, amount_ht::text, tva::text, tva_rate::text, amount_ttc::text, invoice_number, period
         FROM invoices
         ORDER BY date ASC`
      ),
      pool.query<{ nom: string; categorie: string; taux_tva_habituel: string; montant_moyen_ttc_mad: string }>(
        `SELECT nom, categorie, taux_tva_habituel::text, montant_moyen_ttc_mad::text
         FROM fournisseurs`
      )
    ]);

    const invoices = invoicesRes.rows;
    const vendors = vendorsRes.rows.map((v) => ({
      vendor: v.nom,
      category: v.categorie,
      expectedTvaRate: Number.parseFloat(v.taux_tva_habituel || "20"),
      averageAmountTtc: Number.parseFloat(v.montant_moyen_ttc_mad || "0")
    }));

    const anomalies = auditInvoices(invoices, {
      fiscalPeriod: "2026-H1",
      vendorReferential: vendors,
      historicalInvoices: invoices
    });

    for (const anomaly of anomalies) {
      await pool.query(
        `INSERT INTO anomalies (invoice_id, type, description, exposure_mad, severity, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         ON CONFLICT (invoice_id, type) DO UPDATE SET
           description = EXCLUDED.description,
           exposure_mad = EXCLUDED.exposure_mad,
           severity = EXCLUDED.severity`,
        [
          anomaly.invoice_id,
          anomaly.type,
          anomaly.description,
          anomaly.exposure_mad,
          anomaly.severity
        ]
      );
    }

    return {
      success: true,
      invoices_audited: invoices.length,
      anomalies_detected: anomalies.length
    };
  });

  app.all("/api/reconcile/run", async () => {
    const [invoicesRes, bankLinesRes] = await Promise.all([
      pool.query<AuditInvoice & { id: string }>(
        `SELECT id, vendor, date::text, amount_ht::text, tva::text, tva_rate::text, amount_ttc::text, invoice_number, period
         FROM invoices
         ORDER BY date ASC`
      ),
      pool.query<{ id: string; date: string; description: string; amount: string }>(
        `SELECT id, date::text, description, amount::text
         FROM bank_lines
         ORDER BY date ASC`
      )
    ]);

    const reconInvoices: ReconciliationInvoice[] = invoicesRes.rows.map((inv) => ({
      id: inv.id,
      vendor: inv.vendor,
      date: inv.date,
      amount_ttc: inv.amount_ttc,
      invoice_number: inv.invoice_number
    }));

    const reconBankLines: ReconciliationBankLine[] = bankLinesRes.rows.map((bl) => ({
      id: bl.id,
      date: bl.date,
      description: bl.description,
      amount: bl.amount
    }));

    const reconResult = reconcileBankLines(reconInvoices, reconBankLines);

    await pool.query("UPDATE bank_lines SET matched_invoice_id = NULL");
    for (const match of reconResult.matched) {
      if (match.type === "exact") {
        await pool.query("UPDATE bank_lines SET matched_invoice_id = $1 WHERE id = $2", [
          match.invoice_id,
          match.bank_line_id
        ]);
      } else if (match.type === "grouped") {
        for (const invId of match.invoice_ids) {
          await pool.query("UPDATE bank_lines SET matched_invoice_id = $1 WHERE id = $2", [
            invId,
            match.bank_line_id
          ]);
        }
      }
    }

    return {
      success: true,
      matched_count: reconResult.matched.length,
      match_rate: reconResult.match_rate
    };
  });
}

