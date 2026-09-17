import type { AgentDefinition } from "@chiffra/shared";
import { toDecimal } from "@chiffra/shared";
import { createHash } from "node:crypto";
import Redis from "ioredis";
import pdfParse from "pdf-parse";
import { recognize } from "tesseract.js";
import * as XLSX from "xlsx";
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

const OCR_CACHE_TTL_SECONDS = 24 * 60 * 60;

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
  reason:
    | "pdf_unreadable"
    | "image_quality_low"
    | "excel_unreadable"
    | "unsupported_file_type"
    | "amount_validation_failed"
    | "llm_json_invalid";
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
  await redis.set(`ingestor:${hash}`, JSON.stringify(result), "EX", OCR_CACHE_TTL_SECONDS);
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

function isImage(filename: string, mimeType?: string): boolean {
  return Boolean(
    mimeType?.startsWith("image/") || /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(filename)
  );
}

function isExcel(filename: string, mimeType?: string): boolean {
  return Boolean(
    mimeType?.includes("spreadsheet") || /\.(xlsx?|xlsm|csv)$/i.test(filename)
  );
}

function isPdf(filename: string, mimeType?: string): boolean {
  return Boolean(mimeType === "application/pdf" || /\.pdf$/i.test(filename));
}

function stringifyExcelRows(rows: unknown[]): string {
  return rows
    .map((row, index) => `row_${index + 1}: ${JSON.stringify(row)}`)
    .join("\n");
}

function findValue(row: Record<string, unknown>, aliases: string[]): string | null {
  const normalized = Object.entries(row).map(([key, value]) => [
    key.toLowerCase().replace(/[^a-z0-9]/g, ""),
    value
  ] as const);

  for (const alias of aliases) {
    const wanted = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
    const match = normalized.find(([key]) => key.includes(wanted));

    if (match && match[1] !== null && match[1] !== undefined && String(match[1]).trim() !== "") {
      return String(match[1]).trim();
    }
  }

  return null;
}

function extractInvoiceFromExcelRows(rows: Record<string, unknown>[]): ExtractedInvoice | null {
  for (const row of rows) {
    const invoice = {
      vendor: findValue(row, ["vendor", "fournisseur", "supplier"]),
      date: findValue(row, ["date", "invoice date", "date facture"]),
      amount_ht: findValue(row, ["amount ht", "montant ht", "ht", "hors taxe"]),
      tva_rate: findValue(row, ["tva rate", "taux tva", "tva%", "rate"]),
      tva: findValue(row, ["tva", "taxe", "vat"]),
      amount_ttc: findValue(row, ["amount ttc", "montant ttc", "ttc", "total"]),
      invoice_number: findValue(row, ["invoice number", "numero facture", "facture", "number"])
    };

    const parsed = extractedInvoiceSchema.safeParse(invoice);

    if (parsed.success && validateInvoiceMath(parsed.data)) {
      return parsed.data;
    }
  }

  return null;
}

export async function ingestImage(buffer: Buffer, filename: string): Promise<IngestorResult> {
  const hash = documentHash(buffer);
  const cached = await getCachedResult(hash);

  if (cached) {
    return cached;
  }

  const ocr = await recognize(buffer, "fra+eng").catch(() => null);
  const confidence = (ocr?.data.confidence ?? 0) / 100;
  const rawText = ocr?.data.text.trim() ?? "";

  if (confidence < 0.6 || !rawText) {
    const result: IngestorFailure = {
      status: "non_traite",
      hash,
      reason: "image_quality_low",
      rawText
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

export async function ingestExcel(buffer: Buffer, filename: string): Promise<IngestorResult> {
  const hash = documentHash(buffer);
  const cached = await getCachedResult(hash);

  if (cached) {
    return cached;
  }

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  const firstSheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;
  const rows = firstSheet
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" })
    : [];
  const rawText = stringifyExcelRows(rows);
  const invoice = extractInvoiceFromExcelRows(rows);

  if (!invoice) {
    const result: IngestorFailure = {
      status: "non_traite",
      hash,
      reason: "excel_unreadable",
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

export async function ingestDocument(
  buffer: Buffer,
  filename: string,
  mimeType?: string
): Promise<IngestorResult> {
  if (isPdf(filename, mimeType)) {
    return ingestCleanPdf(buffer, filename);
  }

  if (isImage(filename, mimeType)) {
    return ingestImage(buffer, filename);
  }

  if (isExcel(filename, mimeType)) {
    return ingestExcel(buffer, filename);
  }

  return {
    status: "non_traite",
    hash: documentHash(buffer),
    reason: "unsupported_file_type"
  };
}
