import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { askDocuments } from "../services/rag.js";

const askBodySchema = z.object({
  question: z.string().min(3).max(1000)
});

export async function registerAskRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>("/api/ask", async (request, reply) => {
    const body = askBodySchema.safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({
        error: "invalid_question",
        details: body.error.flatten()
      });
    }

    const answer = await askDocuments(body.data.question);
    return answer;
  });
}

