import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { pool } from "../db/client.js";

export async function registerDocumentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/documents", async () => {
    const result = await pool.query(
      `SELECT id, filename, type, status,
              ocr_cache->>'reason' AS reason,
              ocr_cache->>'message' AS message,
              created_at
       FROM documents
       ORDER BY created_at DESC`
    );

    return {
      documents: result.rows
    };
  });

  app.get<{ Params: { id: string } }>("/api/documents/:id/source", async (request, reply) => {
    const result = await pool.query<{ storage_path: string | null; type: string; filename: string }>(
      "SELECT storage_path, type, filename FROM documents WHERE id = $1",
      [request.params.id]
    );
    const document = result.rows[0];

    if (!document?.storage_path) {
      return reply.code(404).send({ error: "document_source_not_found" });
    }

    return reply
      .header("Content-Type", document.type)
      .header("Content-Disposition", `inline; filename="${basename(document.filename)}"`)
      .send(createReadStream(document.storage_path));
  });

  app.get<{ Params: { id: string } }>("/api/documents/:id", async (request, reply) => {
    const documentResult = await pool.query("SELECT * FROM documents WHERE id = $1", [
      request.params.id
    ]);

    if (documentResult.rowCount === 0) {
      return reply.code(404).send({
        error: "document_not_found"
      });
    }

    const [invoices, bankLines, anomalies] = await Promise.all([
      pool.query("SELECT * FROM invoices WHERE document_id = $1 ORDER BY created_at DESC", [
        request.params.id
      ]),
      pool.query("SELECT * FROM bank_lines WHERE document_id = $1 ORDER BY date DESC", [
        request.params.id
      ]),
      pool.query(
        `SELECT anomalies.*
         FROM anomalies
         JOIN invoices ON invoices.id = anomalies.invoice_id
         WHERE invoices.document_id = $1
         ORDER BY anomalies.exposure_mad DESC`,
        [request.params.id]
      )
    ]);

    return {
      document: documentResult.rows[0],
      invoices: invoices.rows,
      bank_lines: bankLines.rows,
      anomalies: anomalies.rows
    };
  });
}
