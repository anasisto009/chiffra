import { toDecimal } from "@chiffra/shared";
import { Worker } from "bullmq";
import { auditInvoices, type AuditInvoice } from "../agents/auditor.js";
import { ingestDocument } from "../agents/ingestor.js";
import { reconcileBankLines, type ReconciliationBankLine, type ReconciliationInvoice } from "../agents/reconciler.js";
import { pool } from "../db/client.js";
import {
  type IngestionJobData,
  ingestionRedisConnection,
  publishIngestionProgress
} from "../queues/ingestion.queue.js";
import { ensureDocumentEmbedding } from "../services/rag.js";
import { errorReason } from "../utils/errors.js";

function periodFromDate(date: string): string {
  return date.slice(0, 7);
}

async function markDocumentNonTraite(documentId: string, reason: string, message?: string): Promise<void> {
  await pool.query(
    `UPDATE documents
     SET status = 'non_traite',
         ocr_cache = jsonb_build_object('reason', $2::text, 'message', $3::text)
     WHERE id = $1`,
    [documentId, reason, message || null]
  );
}

async function runPostIngestionAuditAndReconciliation(): Promise<void> {
  try {
    const [invoicesResult, bankLinesResult, vendorsResult] = await Promise.all([
      pool.query<AuditInvoice & { id: string }>(
        `SELECT id, vendor, date::text, amount_ht::text, tva::text, tva_rate::text, amount_ttc::text, invoice_number, period
         FROM invoices
         ORDER BY date DESC`
      ),
      pool.query<{ id: string; date: string; description: string; amount: string }>(
        `SELECT id, date::text, description, amount::text
         FROM bank_lines
         ORDER BY date DESC`
      ),
      pool.query<{ nom: string; categorie: string; taux_tva_habituel: string; montant_moyen_ttc_mad: string }>(
        `SELECT nom, categorie, taux_tva_habituel::text, montant_moyen_ttc_mad::text
         FROM fournisseurs`
      )
    ]);

    const invoices = invoicesResult.rows;
    const bankLines = bankLinesResult.rows;
    const vendors = vendorsResult.rows.map((v) => ({
      vendor: v.nom,
      category: v.categorie,
      expectedTvaRate: Number.parseFloat(v.taux_tva_habituel || "20"),
      averageAmountTtc: Number.parseFloat(v.montant_moyen_ttc_mad || "0")
    }));

    if (invoices.length > 0) {
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
    }

    if (bankLines.length > 0 && invoices.length > 0) {
      const reconInvoices: ReconciliationInvoice[] = invoices.map((inv) => ({
        id: inv.id,
        vendor: inv.vendor,
        date: inv.date,
        amount_ttc: inv.amount_ttc,
        invoice_number: inv.invoice_number
      }));

      const reconBankLines: ReconciliationBankLine[] = bankLines.map((bl) => ({
        id: bl.id,
        date: bl.date,
        description: bl.description,
        amount: bl.amount
      }));

      const result = reconcileBankLines(reconInvoices, reconBankLines);

      // Reset existing matches first to ensure fresh and clean state
      await pool.query(`UPDATE bank_lines SET matched_invoice_id = NULL`);

      for (const match of result.matched) {
        if (match.type === "exact") {
          await pool.query(
            `UPDATE bank_lines SET matched_invoice_id = $1 WHERE id = $2`,
            [match.invoice_id, match.bank_line_id]
          );
        } else if (match.type === "grouped" && match.invoice_ids.length > 0) {
          for (const invId of match.invoice_ids) {
            await pool.query(
              `UPDATE bank_lines SET matched_invoice_id = $1 WHERE id = $2`,
              [invId, match.bank_line_id]
            );
          }
        }
      }
    }
  } catch (err) {
    // Non-fatal background sync
    console.error("Post-ingestion audit/reconcile error:", err);
  }
}

export const ingestionWorker = new Worker<IngestionJobData>(
  "document-ingestion",
  async (job) => {
    const { documentId, filename, mimeType, contentBase64 } = job.data;
    try {
      const buffer = Buffer.from(contentBase64, "base64");

      publishIngestionProgress({
        documentId,
        filename,
        status: "processing"
      });

      await pool.query("UPDATE documents SET status = 'processing' WHERE id = $1", [documentId]);

      const result = await ingestDocument(buffer, filename, mimeType);

      if (result.status === "non_traite") {
        await pool.query(
          `UPDATE documents
           SET status = 'non_traite',
               raw_text = $2,
               ocr_cache = $3::jsonb
           WHERE id = $1`,
          [
            documentId,
            result.rawText ?? null,
            JSON.stringify({
              reason: result.reason,
              message: result.message || null
            })
          ]
        );

        publishIngestionProgress({
          documentId,
          filename,
          status: "non_traite",
          reason: result.reason
        });
        return result;
      }

      if (result.status === "bank_lines") {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            `UPDATE documents
             SET status = 'done',
                 raw_text = $2,
                 ocr_cache = $3::jsonb
             WHERE id = $1`,
            [documentId, result.rawText, JSON.stringify(result)]
          );

          for (const line of result.lines) {
            await client.query(
              `INSERT INTO bank_lines (document_id, date, description, amount)
               VALUES ($1, $2, $3, $4)`,
              [
                documentId,
                line.date,
                line.description,
                toDecimal(line.amount).toFixed(2)
              ]
            );
          }

          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }

        await ensureDocumentEmbedding(documentId, result.rawText);
        await runPostIngestionAuditAndReconciliation();

        publishIngestionProgress({
          documentId,
          filename,
          status: "done"
        });

        return result;
      }

      // If invoices
      const invoicesToInsert = result.invoices && result.invoices.length > 0
        ? result.invoices
        : [result.invoice];

      await ensureDocumentEmbedding(documentId, result.rawText);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE documents
           SET status = 'done',
               raw_text = $2,
               ocr_cache = $3::jsonb
           WHERE id = $1`,
          [documentId, result.rawText, JSON.stringify(result)]
        );

        for (const invoice of invoicesToInsert) {
          await client.query(
            `INSERT INTO invoices (
              document_id, vendor, date, amount_ht, tva, tva_rate, amount_ttc, invoice_number, period
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              documentId,
              invoice.vendor,
              invoice.date,
              toDecimal(invoice.amount_ht).toFixed(2),
              toDecimal(invoice.tva).toFixed(2),
              toDecimal(invoice.tva_rate).toFixed(2),
              toDecimal(invoice.amount_ttc).toFixed(2),
              invoice.invoice_number ?? null,
              periodFromDate(invoice.date)
            ]
          );
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      await runPostIngestionAuditAndReconciliation();

      publishIngestionProgress({
        documentId,
        filename,
        status: "done"
      });

      return result;
    } catch (error) {
      const reason = errorReason(error);
      const message = error instanceof Error ? error.message : String(error);
      await markDocumentNonTraite(documentId, reason, message);
      job.log(`document_id=${documentId} reason=${reason} message=${message}`);
      publishIngestionProgress({
        documentId,
        filename,
        status: "non_traite",
        reason
      });
      return {
        status: "non_traite",
        hash: "",
        reason,
        message
      };
    }
  },
  {
    connection: ingestionRedisConnection,
    concurrency: 5
  }
);

ingestionWorker.on("failed", async (job, error) => {
  if (!job) {
    return;
  }

  const reason = errorReason(error);
  const message = error instanceof Error ? error.message : String(error);
  await markDocumentNonTraite(job.data.documentId, reason, message);
  publishIngestionProgress({
    documentId: job.data.documentId,
    filename: job.data.filename,
    status: "non_traite",
    reason
  });
});
