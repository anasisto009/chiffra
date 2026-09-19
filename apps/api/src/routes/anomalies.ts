import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/client.js";

const reviewBodySchema = z.object({
  decision: z.enum(["validated", "rejected"]),
  note: z.string().optional().default("")
});

export async function registerAnomalyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/anomalies", async () => {
    const result = await pool.query(
      `SELECT anomalies.*, invoices.vendor, invoices.date, invoices.invoice_number, documents.filename
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
      `SELECT anomalies.*, invoices.*, documents.filename, documents.raw_text
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

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/anomalies/:id/review",
    async (request, reply) => {
      const body = reviewBodySchema.safeParse(request.body);

      if (!body.success) {
        return reply.code(400).send({
          error: "invalid_review_payload",
          details: body.error.flatten()
        });
      }

      const updated = await pool.query(
        `UPDATE anomalies
         SET status = $2
         WHERE id = $1
         RETURNING *`,
        [request.params.id, body.data.decision]
      );

      if (updated.rowCount === 0) {
        return reply.code(404).send({
          error: "anomaly_not_found"
        });
      }

      const review = await pool.query(
        `INSERT INTO human_reviews (anomaly_id, decision, reviewer_note)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [request.params.id, body.data.decision, body.data.note]
      );

      return {
        anomaly: updated.rows[0],
        review: review.rows[0]
      };
    }
  );
}
