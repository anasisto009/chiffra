import type { AgentDefinition } from "@chiffra/shared";
import { toDecimal } from "@chiffra/shared";
import { createHash } from "node:crypto";
import Redis from "ioredis";
import pdfParse from "pdf-parse";
import { z } from "zod";
import { config, env } from "../config.js";
import { clientGPT41 } from "../llm/clients.js";

export const ingestorAgent: AgentDefinition = {
  id: "ingestor",
  label: "Ingestor",
  responsibility: "Normalise les donnees issues de PDF, photos et Excel."
};

const redis = new Redis(env.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 2
});

const extractedInvoiceSchema = z.object({
  vendor: z.string().min(1),
  date: z.string().min(1),
  amount_ht: z.string(),
  tva_rate: z.string(),
  tva: z.string(),
  amount_ttc: z.string(),
  invoice_number: z.string().nullable().optional()
});

export type ExtractedInvoice = z.infer<typeof extractedInvoiceSchema>;

export type IngestorSuccess = {
  status: "done";
  hash: string;
  rawText: string;
  invoice: ExtractedInvoice;
};

export type IngestorFailure = {
  status: "non_traite";
  hash: string;
  reason: "pdf_unreadable" | "amount_validation_failed" | "llm_json_invalid";
  rawText?: string;
};

export type IngestorResult = IngestorSuccess | IngestorFailure;

function documentHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function getCachedResult(hash: string): Promise<IngestorResult | null> {
  if (redis.status === "wait") {
    await redis.connect().catch(() => undefined);
  }
  const cached = await redis.get(`ingestor:${hash}`);

  return cached ? (JSON.parse(cached) as IngestorResult) : null;
}

async function setCachedResult(hash: string, result: IngestorResult): Promise<void> {
  if (redis.status === "wait") {
    await redis.connect().catch(() => undefined);
  }
  await redis.set(`ingestor:${hash}`, JSON.stringify(result));
}

function parseJsonObject(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced?.[1] ?? content;
  return JSON.parse(jsonText);
}

function validateInvoiceMath(invoice: ExtractedInvoice): boolean {
  const expectedTtc = toDecimal(invoice.amount_ht).plus(invoice.tva);
  const actualTtc = toDecimal(invoice.amount_ttc);
  return expectedTtc.minus(actualTtc).abs().lessThanOrEqualTo("0.01");
}

async function extractInvoiceJson(rawText: string): Promise<ExtractedInvoice | null> {
  const completion = await clientGPT41.chat.completions.create({
    model: config.llmFast.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Extract invoice fields from Moroccan accounting text. Return only JSON with keys vendor, date, amount_ht, tva_rate, tva, amount_ttc, invoice_number. Monetary values must be strings in MAD. Never calculate or invent missing values."
      },
      {
        role: "user",
        content: rawText
      }
    ]
  });

  const content = completion.choices[0]?.message.content;

  if (!content) {
    return null;
  }

  const parsed = extractedInvoiceSchema.safeParse(parseJsonObject(content));
  return parsed.success ? parsed.data : null;
}

export async function ingestCleanPdf(buffer: Buffer, filename: string): Promise<IngestorResult> {
  const hash = documentHash(buffer);
  const cached = await getCachedResult(hash);

  if (cached) {
    return cached;
  }

  const parsedPdf = await pdfParse(buffer).catch(() => null);
  const rawText = parsedPdf?.text.trim() ?? "";

  if (!rawText) {
    const result: IngestorFailure = {
      status: "non_traite",
      hash,
      reason: "pdf_unreadable"
    };
    await setCachedResult(hash, result);
    return result;
  }

  const invoice = await extractInvoiceJson(rawText);

  if (!invoice) {
    const result: IngestorFailure = {
      status: "non_traite",
      hash,
      reason: "llm_json_invalid",
      rawText
    };
    await setCachedResult(hash, result);
    return result;
  }

  if (!validateInvoiceMath(invoice)) {
    const result: IngestorFailure = {
      status: "non_traite",
      hash,
      reason: "amount_validation_failed",
      rawText
    };
    await setCachedResult(hash, result);
    return result;
  }

  const result: IngestorSuccess = {
    status: "done",
    hash,
    rawText,
    invoice: {
      ...invoice,
      invoice_number: invoice.invoice_number ?? filename
    }
  };

  await setCachedResult(hash, result);
  return result;
}
