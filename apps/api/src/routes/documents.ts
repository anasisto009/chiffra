import type { FastifyInstance } from "fastify";
import { existsSync, createReadStream } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pool } from "../db/client.js";

function resolveDocumentPath(filename: string, storagePath?: string | null): string | null {
  if (storagePath && existsSync(storagePath)) {
    return storagePath;
  }

  const candidateDirs = [
    join(process.cwd(), "uploads"),
    join(process.cwd(), "apps/api/uploads"),
    join(process.cwd(), "sujet-03-chiffra", "factures"),
    join(process.cwd(), "sujet-03-chiffra", "releves"),
    join(process.cwd(), "sujet-03-chiffra"),
    resolve(process.cwd(), "../sujet-03-chiffra/factures"),
    resolve(process.cwd(), "../sujet-03-chiffra/releves"),
    resolve(process.cwd(), "../sujet-03-chiffra"),
    "C:\\Users\\MY PC\\Desktop\\sujet-03-chiffra\\factures",
    "C:\\Users\\MY PC\\Desktop\\sujet-03-chiffra\\releves",
    "C:\\Users\\MY PC\\Desktop\\sujet-03-chiffra"
  ];

  for (const dir of candidateDirs) {
    const full = join(dir, filename);
    if (existsSync(full)) {
      return full;
    }
  }

  return null;
}

export async function registerDocumentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/documents", async () => {
    const result = await pool.query(
      `SELECT id, filename, type, status,
              failure_reason,
              ocr_cache->>'reason' AS reason,
              ocr_cache->>'message' AS message,
              created_at
       FROM documents
       ORDER BY filename ASC, created_at DESC`
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

    if (!document) {
      return reply.code(404).send({ error: "document_not_found" });
    }

    const resolvedPath = resolveDocumentPath(document.filename, document.storage_path);
    if (!resolvedPath) {
      return reply.code(404).send({ error: "document_source_not_found" });
    }

    return reply
      .header("Content-Type", document.type || "application/octet-stream")
      .header("Content-Disposition", `inline; filename="${basename(document.filename)}"`)
      .send(createReadStream(resolvedPath));
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
