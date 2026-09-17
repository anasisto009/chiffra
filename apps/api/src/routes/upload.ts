import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { pool } from "../db/client.js";
import {
  ingestionEvents,
  ingestionQueue,
  publishIngestionProgress
} from "../queues/ingestion.queue.js";

export async function registerUploadRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: {
      files: 200,
      fileSize: 25 * 1024 * 1024
    }
  });

  app.post("/api/upload", async (request, reply) => {
    const uploaded: Array<{ documentId: string; filename: string; jobId: string | undefined }> = [];

    for await (const part of request.files()) {
      const buffer = await part.toBuffer();
      const documentResult = await pool.query<{ id: string }>(
        `INSERT INTO documents (filename, type, status)
         VALUES ($1, $2, 'pending')
         RETURNING id`,
        [part.filename, part.mimetype ?? "application/octet-stream"]
      );
      const documentId = documentResult.rows[0].id;
      const job = await ingestionQueue.add("ingest-document", {
        documentId,
        filename: part.filename,
        mimeType: part.mimetype,
        contentBase64: buffer.toString("base64")
      });

      publishIngestionProgress({
        documentId,
        filename: part.filename,
        status: "queued"
      });

      uploaded.push({
        documentId,
        filename: part.filename,
        jobId: job.id
      });
    }

    return reply.code(202).send({
      queued: uploaded.length,
      documents: uploaded
    });
  });

  app.get("/api/progress", async (_request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });

    const onProgress = (event: unknown) => {
      reply.raw.write(`event: ingestion\n`);
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    ingestionEvents.on("progress", onProgress);
    reply.raw.write(`event: ready\n`);
    reply.raw.write(`data: {"status":"connected"}\n\n`);

    _request.raw.on("close", () => {
      ingestionEvents.off("progress", onProgress);
    });
  });
}

