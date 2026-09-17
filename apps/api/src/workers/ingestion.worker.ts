import { toDecimal } from "@chiffra/shared";
import { Worker } from "bullmq";
import { ingestDocument } from "../agents/ingestor.js";
import { pool } from "../db/client.js";
import {
  type IngestionJobData,
  ingestionRedisConnection,
  publishIngestionProgress
} from "../queues/ingestion.queue.js";

function periodFromDate(date: string): string {
  return date.slice(0, 7);
}

async function markDocumentNonTraite(documentId: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE documents
     SET status = 'non_traite',
         ocr_cache = jsonb_build_object('reason', $2)
     WHERE id = $1`,
    [documentId, reason]
  );
}

export const ingestionWorker = new Worker<IngestionJobData>(
  "document-ingestion",
  async (job) => {
    const { documentId, filename, mimeType, contentBase64 } = job.data;
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
        [documentId, result.rawText ?? null, JSON.stringify(result)]
      );

      publishIngestionProgress({
        documentId,
        filename,
        status: "non_traite",
        reason: result.reason
      });
      return result;
    }

    const invoice = result.invoice;

    await pool.query("BEGIN");
    try {
      await pool.query(
        `UPDATE documents
         SET status = 'done',
             raw_text = $2,
             ocr_cache = $3::jsonb
         WHERE id = $1`,
        [documentId, result.rawText, JSON.stringify(result)]
      );

      await pool.query(
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

      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }

    publishIngestionProgress({
      documentId,
      filename,
      status: "done"
    });

    return result;
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

  const reason = error instanceof Error ? error.message : "ingestion_failed";
  await markDocumentNonTraite(job.data.documentId, reason);
  publishIngestionProgress({
    documentId: job.data.documentId,
    filename: job.data.filename,
    status: "non_traite",
    reason
  });
});

