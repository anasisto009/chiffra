import type { FastifyInstance } from "fastify";
import { pool } from "../db/client.js";

export async function registerAnomalyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/anomalies", async () => {
    const result = await pool.query(
            `SELECT anomalies.*, invoices.vendor, invoices.date, invoices.invoice_number,
              documents.id AS document_id, documents.filename
       FROM anomalies
       LEFT JOIN invoices ON invoices.id = anomalies.invoice_id
       LEFT JOIN documents ON documents.id = invoices.document_id
       ORDER BY anomalies.exposure_mad DESC`
    );

    return {
      anomalies: result.rows
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

}
