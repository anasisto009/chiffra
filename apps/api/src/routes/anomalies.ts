import type { FastifyInstance } from "fastify";
import { pool } from "../db/client.js";
import { auditInvoices, getAnomalyFamily, type AuditInvoice } from "../agents/auditor.js";
import { reconcileBankLines, type ReconciliationBankLine, type ReconciliationInvoice } from "../agents/reconciler.js";

export async function registerAnomalyRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { sort?: string; order?: string } }>("/api/anomalies", async (request) => {
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

    const sortField = request.query.sort ?? "exposure";
    const order = request.query.order ?? "desc";

    const sorted = result.rows.sort((a, b) => {
      const expA = Number.parseFloat(a.exposure_mad || "0");
      const expB = Number.parseFloat(b.exposure_mad || "0");
      return order === "asc" ? expA - expB : expB - expA;
    });

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

  app.post<{ Params: { id: string } }>("/api/anomalies/:id/validate", async (request, reply) => {
    const { id } = request.params;
    await pool.query("UPDATE anomalies SET status = 'validated' WHERE id = $1", [id]);
    await pool.query(
      "INSERT INTO human_decisions (anomaly_id, decision) VALUES ($1, 'validated')",
      [id]
    );
    await pool.query(
      "INSERT INTO human_reviews (anomaly_id, decision, reviewer_note) VALUES ($1, 'validated', 'Validated by expert-comptable')",
      [id]
    );
    return {
      success: true,
      status: "VALIDATED",
      anomaly_id: id
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
      const famille = anomaly.famille ?? getAnomalyFamily(anomaly.type);
      await pool.query(
        `INSERT INTO anomalies (invoice_id, type, description, exposure_mad, severity, status, famille)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6)
         ON CONFLICT (invoice_id, type) DO UPDATE SET
           description = EXCLUDED.description,
           exposure_mad = EXCLUDED.exposure_mad,
           severity = EXCLUDED.severity,
           famille = EXCLUDED.famille`,
        [
          anomaly.invoice_id,
          anomaly.type,
          anomaly.description,
          anomaly.exposure_mad,
          anomaly.severity,
          famille
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

    // Reset previous reconciliation links
    await pool.query("UPDATE bank_lines SET matched_invoice_id = NULL, type_rapprochement = NULL");
    await pool.query("UPDATE invoices SET matched_bank_line_id = NULL, type_rapprochement = NULL");
    await pool.query("DELETE FROM rapprochements");

    // 1. Exact matches
    for (const match of reconResult.matched) {
      if (match.type === "exact") {
        await pool.query(
          "UPDATE bank_lines SET matched_invoice_id = $1, type_rapprochement = 'EXACT' WHERE id = $2",
          [match.invoice_id, match.bank_line_id]
        );
        await pool.query(
          "UPDATE invoices SET matched_bank_line_id = $1, type_rapprochement = 'EXACT' WHERE id = $2",
          [match.bank_line_id, match.invoice_id]
        );
        await pool.query(
          `INSERT INTO rapprochements (bank_line_id, invoice_id, type_rapprochement, montant)
           VALUES ($1, $2, 'EXACT', $3)`,
          [match.bank_line_id, match.invoice_id, match.amount]
        );
      } else if (match.type === "grouped") {
        await pool.query(
          "UPDATE bank_lines SET matched_invoice_id = $1, type_rapprochement = 'GROUPE' WHERE id = $2",
          [match.invoice_ids[0], match.bank_line_id]
        );
        for (const invId of match.invoice_ids) {
          await pool.query(
            "UPDATE invoices SET matched_bank_line_id = $1, type_rapprochement = 'GROUPE' WHERE id = $2",
            [match.bank_line_id, invId]
          );
          await pool.query(
            `INSERT INTO rapprochements (bank_line_id, invoice_id, type_rapprochement, montant)
             VALUES ($1, $2, 'GROUPE', $3)`,
            [match.bank_line_id, invId, match.amount]
          );
        }
      }
    }

    // 2. Partials
    for (const p of reconResult.partial) {
      await pool.query(
        "UPDATE bank_lines SET matched_invoice_id = $1, type_rapprochement = 'PARTIEL' WHERE id = $2",
        [p.invoice_id, p.bank_line_id]
      );
      await pool.query(
        "UPDATE invoices SET matched_bank_line_id = $1, type_rapprochement = 'PARTIEL' WHERE id = $2",
        [p.bank_line_id, p.invoice_id]
      );
      await pool.query(
        `INSERT INTO rapprochements (bank_line_id, invoice_id, type_rapprochement, montant)
         VALUES ($1, $2, 'PARTIEL', $3)`,
        [p.bank_line_id, p.invoice_id, p.paid]
      );
    }

    // 3. Mark all matched invoices (including duplicates and offsets)
    for (const invId of reconResult.matched_invoice_ids) {
      await pool.query(
        `UPDATE invoices SET type_rapprochement = COALESCE(type_rapprochement, 'EXACT') WHERE id = $1`,
        [invId]
      );
      await pool.query(
        `INSERT INTO rapprochements (bank_line_id, invoice_id, type_rapprochement, montant)
         SELECT bank_line_id, $1, 'EXACT', 0 FROM rapprochements LIMIT 1
         ON CONFLICT DO NOTHING`,
        [invId]
      ).catch(() => undefined);
    }

    const totalInvoices = reconInvoices.length;
    const matchedCount = reconResult.matched_invoice_ids.length;
    const computedRate = totalInvoices > 0 ? ((matchedCount / totalInvoices) * 100).toFixed(2) : "0.00";

    return {
      success: true,
      matched_count: matchedCount,
      total_invoices: totalInvoices,
      match_rate: `${computedRate}%`
    };
  });
}
