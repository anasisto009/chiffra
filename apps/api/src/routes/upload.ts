import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { pool } from "../db/client.js";
import {
  ingestionEvents,
  ingestionQueue,
  publishIngestionProgress
} from "../queues/ingestion.queue.js";
import { errorReason } from "../utils/errors.js";

const ALLOWED_EXTENSIONS = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".tiff",
  ".tif",
  ".webp",
  ".bmp",
  ".xlsx",
  ".xls",
  ".xlsm",
  ".csv",
  ".tsv",
  ".txt"
];

function detectDocType(filename: string, mimetype?: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf" || mimetype === "application/pdf") return "application/pdf";
  if (["jpg", "jpeg", "png", "webp", "tiff", "tif", "bmp"].includes(ext) || mimetype?.startsWith("image/")) {
    return mimetype || `image/${ext === "jpg" ? "jpeg" : ext}`;
  }
  if (["xlsx", "xls", "xlsm"].includes(ext) || mimetype?.includes("spreadsheet") || mimetype?.includes("excel")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (["csv", "tsv", "txt"].includes(ext) || mimetype === "text/csv") {
    return "text/csv";
  }
  return mimetype || "application/octet-stream";
}

export async function registerUploadRoutes(app: FastifyInstance): Promise<void> {
  const uploadDirectory = join(process.cwd(), "uploads");
  await mkdir(uploadDirectory, { recursive: true });

  await app.register(multipart, {
    limits: {
      files: 200,
      fileSize: 25 * 1024 * 1024
    }
  });

  app.post("/api/upload", async (request, reply) => {
    const uploaded: Array<{ documentId: string; filename: string; jobId: string | undefined }> = [];

    for await (const part of request.files()) {
      let documentId: string | undefined;

      const lowerName = part.filename.toLowerCase();
      const hasValidExt = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));

      if (!hasValidExt) {
        request.log.warn({ filename: part.filename }, "upload_unsupported_file_extension");
        const docType = detectDocType(part.filename, part.mimetype);
        const docRes = await pool.query<{ id: string }>(
          `INSERT INTO documents (filename, type, status, ocr_cache)
           VALUES ($1, $2, 'non_traite', jsonb_build_object('reason', 'unsupported_file_type', 'message', 'Format de fichier non supporté'))
           RETURNING id`,
          [part.filename, docType]
        );
        documentId = docRes.rows[0].id;
        uploaded.push({
          documentId,
          filename: part.filename,
          jobId: undefined
        });
        continue;
      }

      try {
        const buffer = await part.toBuffer();
        const storedFilename = `${randomUUID()}-${part.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const storagePath = join(uploadDirectory, storedFilename);
        await writeFile(storagePath, buffer);

        const docType = detectDocType(part.filename, part.mimetype);

        const documentResult = await pool.query<{ id: string }>(
          `INSERT INTO documents (filename, type, storage_path, status)
           VALUES ($1, $2, $3, 'pending')
           RETURNING id`,
          [part.filename, docType, storagePath]
        );
        documentId = documentResult.rows[0].id;

        const job = await ingestionQueue.add("ingest-document", {
          documentId,
          filename: part.filename,
          mimeType: docType,
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
      } catch (error) {
        const reason = errorReason(error);
        const message = error instanceof Error ? error.message : "Échec du stockage ou de la mise en file";
        request.log.error({ document_id: documentId, reason }, "upload_file_failed");

        if (documentId) {
          await pool.query(
            `UPDATE documents
             SET status = 'non_traite',
                 ocr_cache = jsonb_build_object('reason', $2, 'message', $3)
             WHERE id = $1`,
            [documentId, reason, message]
          );
        }

        return reply.code(400).send({
          error: "upload_failed",
          document_id: documentId,
          reason,
          message
        });
      }
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
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      Vary: "Origin"
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
