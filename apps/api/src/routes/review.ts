import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/client.js";

const reviewBodySchema = z.object({
  decision: z.enum(["validated", "rejected"]),
  note: z.string().optional().default("")
}).superRefine((body, context) => {
  if (body.decision === "rejected" && body.note.trim().length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["note"],
      message: "A rejection reason is required."
    });
  }
});

export async function registerReviewRoutes(app: FastifyInstance): Promise<void> {
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
        review: review.rows[0],
        feedback: {
          rejected_type_lowers_future_priority: body.data.decision === "rejected"
        }
      };
    }
  );
}

