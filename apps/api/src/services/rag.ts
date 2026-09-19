import { createHash } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { pool } from "../db/client.js";
import { clientEmbeddings, clientGPT41 } from "../llm/clients.js";

type SearchDocument = {
  document_id: string;
  filename: string;
  raw_text: string;
  distance: string;
};

const askResponseSchema = z.object({
  answer_fr: z.string().min(1),
  sources: z.array(z.object({
    document_id: z.string(),
    filename: z.string()
  }))
});

function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => Number(value).toFixed(8)).join(",")}]`;
}

function parseJsonObject(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced?.[1] ?? content;
  return JSON.parse(jsonText);
}

export async function embedText(text: string): Promise<number[]> {
  const embedding = await clientEmbeddings.embeddings.create({
    model: config.embedding.model,
    input: text,
    dimensions: config.embedding.dimensions
  });

  return embedding.data[0]?.embedding ?? [];
}

export async function ensureDocumentEmbedding(documentId: string, rawText: string): Promise<void> {
  const contentHash = hashContent(rawText);
  const existing = await pool.query(
    `SELECT document_id
     FROM document_embeddings
     WHERE document_id = $1 AND content_hash = $2 AND model = $3`,
    [documentId, contentHash, config.embedding.model]
  );

  if ((existing.rowCount ?? 0) > 0) {
    return;
  }

  const embedding = await embedText(rawText);

  if (embedding.length !== config.embedding.dimensions) {
    throw new Error("embedding_dimensions_mismatch");
  }

  await pool.query(
    `INSERT INTO document_embeddings (document_id, content_hash, embedding, model)
     VALUES ($1, $2, $3::vector, $4)
     ON CONFLICT (document_id)
     DO UPDATE SET content_hash = EXCLUDED.content_hash,
                   embedding = EXCLUDED.embedding,
                   model = EXCLUDED.model,
                   created_at = now()`,
    [documentId, contentHash, vectorLiteral(embedding), config.embedding.model]
  );
}

export async function ensureAllDocumentEmbeddings(): Promise<void> {
  const documents = await pool.query<{ id: string; raw_text: string }>(
    `SELECT id, raw_text
     FROM documents
     WHERE status = 'done' AND raw_text IS NOT NULL AND length(raw_text) > 0`
  );

  for (const document of documents.rows) {
    await ensureDocumentEmbedding(document.id, document.raw_text);
  }
}

export async function askDocuments(question: string): Promise<{
  answer_fr: string;
  sources: Array<{ document_id: string; filename: string }>;
}> {
  await ensureAllDocumentEmbeddings();
  const questionEmbedding = await embedText(question);
  const relevant = await pool.query<SearchDocument>(
    `SELECT documents.id AS document_id,
            documents.filename,
            documents.raw_text,
            (document_embeddings.embedding <=> $1::vector)::text AS distance
     FROM document_embeddings
     JOIN documents ON documents.id = document_embeddings.document_id
     ORDER BY document_embeddings.embedding <=> $1::vector
     LIMIT 5`,
    [vectorLiteral(questionEmbedding)]
  );

  const completion = await clientGPT41.chat.completions.create({
    model: config.llmFast.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Reponds en francais a partir des sources fournies. Si les sources ne suffisent pas, dis-le. Ne calcule jamais de montants: cite uniquement les montants fournis. Retourne JSON {answer_fr, sources:[{document_id, filename}]}."
      },
      {
        role: "user",
        content: JSON.stringify({
          question,
          sources: relevant.rows.map((row) => ({
            document_id: row.document_id,
            filename: row.filename,
            raw_text: row.raw_text.slice(0, 4000)
          }))
        })
      }
    ]
  });

  const content = completion.choices[0]?.message.content;

  if (!content) {
    return {
      answer_fr: "Aucune reponse disponible avec les documents indexes.",
      sources: relevant.rows.map((row) => ({
        document_id: row.document_id,
        filename: row.filename
      }))
    };
  }

  const parsed = askResponseSchema.safeParse(parseJsonObject(content));

  if (!parsed.success) {
    return {
      answer_fr: "Les documents pertinents ont ete trouves, mais la reponse n'a pas pu etre formatee.",
      sources: relevant.rows.map((row) => ({
        document_id: row.document_id,
        filename: row.filename
      }))
    };
  }

  return parsed.data;
}

