import type { AgentDefinition } from "@chiffra/shared";
import { toDecimal } from "@chiffra/shared";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import Redis from "ioredis";
import pdfParse from "pdf-parse";
import { createWorker } from "tesseract.js";
import * as XLSX from "xlsx";
import { z } from "zod";
import { config, env } from "../config.js";
import { clientGPT41 } from "../llm/clients.js";

export const ingestorAgent: AgentDefinition = {
  id: "ingestor",
  label: "Ingestor",
  responsibility: "Normalise les données issues de PDF, photos, Excel, CSV et relevés bancaires."
};

const redis = new Redis(env.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 2
});

const OCR_CACHE_TTL_SECONDS = 24 * 60 * 60;

export const extractedInvoiceSchema = z.object({
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
  invoices?: ExtractedInvoice[];
};

export type IngestorFailure = {
  status: "non_traite";
  hash: string;
  reason:
    | "pdf_unreadable"
    | "image_quality_low"
    | "excel_unreadable"
    | "csv_unreadable"
    | "csv_empty"
    | "unsupported_file_type"
    | "amount_validation_failed"
    | "llm_json_invalid"
    | "file_corrupted"
    | "ingestion_error";
  message?: string;
  rawText?: string;
};

export type IngestorBankLine = {
  date: string;
  description: string;
  amount: string;
};

export type IngestorBankResult = {
  status: "bank_lines";
  hash: string;
  rawText: string;
  lines: IngestorBankLine[];
};

export type IngestorResult = IngestorSuccess | IngestorFailure | IngestorBankResult;

function documentHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function getCachedResult(hash: string): Promise<IngestorResult | null> {
  try {
    if (redis.status === "wait") {
      await redis.connect().catch(() => undefined);
    }
    const cached = await redis.get(`ingestor:${hash}`);
    return cached ? (JSON.parse(cached) as IngestorResult) : null;
  } catch {
    return null;
  }
}

async function setCachedResult(hash: string, result: IngestorResult): Promise<void> {
  try {
    if (redis.status === "wait") {
      await redis.connect().catch(() => undefined);
    }
    await redis.set(`ingestor:${hash}`, JSON.stringify(result), "EX", OCR_CACHE_TTL_SECONDS);
  } catch {
    // Ignore cache error
  }
}

function parseJsonObject(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced?.[1] ?? content;
  return JSON.parse(jsonText);
}

export function cleanNumberString(value: unknown): string {
  if (value === null || value === undefined) return "0";
  let cleaned = String(value).replace(/\s*(MAD|DH|dirhams?|EUR|USD|€|\$)\s*/gi, "").trim();
  cleaned = cleaned.replace(/%$/, "").trim();
  cleaned = cleaned.replace(/\s/g, "");
  if (cleaned.includes(",") && cleaned.includes(".")) {
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (cleaned.includes(",")) {
    cleaned = cleaned.replace(",", ".");
  }
  return cleaned;
}

export function cleanExtractedInvoice(invoice: ExtractedInvoice): ExtractedInvoice {
  return {
    ...invoice,
    amount_ht: cleanNumberString(invoice.amount_ht),
    tva: cleanNumberString(invoice.tva),
    tva_rate: cleanNumberString(invoice.tva_rate),
    amount_ttc: cleanNumberString(invoice.amount_ttc)
  };
}

export function validateInvoiceMath(invoice: ExtractedInvoice): boolean {
  try {
    const ht = toDecimal(invoice.amount_ht);
    const tva = toDecimal(invoice.tva);
    const ttc = toDecimal(invoice.amount_ttc);
    const expectedTtc = ht.plus(tva);
    return expectedTtc.minus(ttc).abs().lessThanOrEqualTo("1.5");
  } catch {
    return false;
  }
}

export function normalizeDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const num = Number(str);
  if (!Number.isNaN(num) && num > 30000 && num < 70000) {
    const utcDays = Math.floor(num - 25569);
    const d = new Date(utcDays * 86400 * 1000);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }

  const dmy = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    const year = dmy[3];
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() >= 2000) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

function decodeAscii85(data: Buffer): Buffer {
  const str = data.toString("latin1").replace(/[\s]/g, "").replace(/<~|~>/g, "");
  const out: number[] = [];
  for (let i = 0; i < str.length; i += 5) {
    let chunk = str.slice(i, i + 5);
    if (chunk === "z") {
      out.push(0, 0, 0, 0);
      i -= 4;
      continue;
    }
    const pad = 5 - chunk.length;
    while (chunk.length < 5) chunk += "u";
    let val = 0;
    for (let j = 0; j < 5; j++) val = val * 85 + (chunk.charCodeAt(j) - 33);
    const b = [(val >> 24) & 255, (val >> 16) & 255, (val >> 8) & 255, val & 255];
    out.push(...b.slice(0, 4 - pad));
  }
  return Buffer.from(out);
}

function extractTextFromPdfStreams(buffer: Buffer): string {
  const allText: string[] = [];
  let pos = 0;
  while (pos < buffer.length) {
    const sIdx = buffer.indexOf("stream", pos);
    if (sIdx === -1) break;
    const eIdx = buffer.indexOf("endstream", sIdx + 6);
    if (eIdx === -1) break;

    let streamData = buffer.subarray(sIdx + 6, eIdx);
    while (streamData.length > 0 && (streamData[0] === 10 || streamData[0] === 13)) streamData = streamData.subarray(1);
    while (streamData.length > 0 && (streamData[streamData.length - 1] === 10 || streamData[streamData.length - 1] === 13)) streamData = streamData.subarray(0, -1);

    let decompressed: string;
    const isAscii85 = streamData.includes(Buffer.from("~>"));
    try {
      decompressed = (isAscii85
        ? inflateSync(decodeAscii85(streamData))
        : inflateSync(streamData)
      ).toString("latin1");
    } catch {
      decompressed = streamData.toString("latin1");
    }

    const parts: string[] = [];
    const tjRegex = /\((.*?)\)\s*Tj/g;
    let m: RegExpExecArray | null;
    while ((m = tjRegex.exec(decompressed)) !== null) {
      let s = m[1];
      s = s.replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(Number.parseInt(oct, 8)));
      s = s.replace(/\\([nrtbf\\()])/g, (_, c) => {
        if (c === "n") return "\n";
        if (c === "r") return "\r";
        if (c === "t") return "\t";
        return c;
      });
      parts.push(s);
    }

    const txt = parts.join(" ").trim();
    if (txt) allText.push(txt);
    pos = eIdx + 9;
  }
  return allText.join("\n");
}

async function extractInvoiceJson(rawText: string): Promise<ExtractedInvoice | null> {
  try {
    const completion = await clientGPT41.chat.completions.create({
      model: config.llmFast.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Extract invoice fields from Moroccan accounting text. Return only JSON with keys vendor, date (YYYY-MM-DD), amount_ht, tva_rate, tva, amount_ttc, invoice_number. Monetary values must be numbers/strings in MAD. Never calculate or invent missing values."
        },
        {
          role: "user",
          content: rawText
        }
      ]
    });

    const content = completion.choices[0]?.message.content;
    if (!content) return null;

    const parsed = extractedInvoiceSchema.safeParse(parseJsonObject(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return extractInvoiceRegex(rawText);
  }
}

function extractInvoiceRegex(text: string): ExtractedInvoice | null {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  let vendor: string | null = null;
  let date: string | null = null;
  let amount_ht: string | null = null;
  let tva: string | null = null;
  let tva_rate: string = "20";
  let amount_ttc: string | null = null;
  let invoice_number: string | null = null;

  for (const line of lines) {
    if (!vendor && /^(fournisseur|soci[eé]t[eé]|vendor|supplier|tiers)\s*[:=]\s*(.+)/i.test(line)) {
      vendor = line.replace(/^(fournisseur|soci[eé]t[eé]|vendor|supplier|tiers)\s*[:=]\s*/i, "").trim();
    }
    if (!date && /(?:date|le)\s*[:=]?\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})/i.test(line)) {
      const match = line.match(/(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})/);
      if (match) date = normalizeDate(match[1]);
    }
    if (!invoice_number && /(?:facture|n[°o]|inv|ref)\s*[:=]?\s*([A-Za-z0-9_-]{3,})/i.test(line)) {
      const match = line.match(/(?:facture|n[°o]|inv|ref)\s*[:=]?\s*([A-Za-z0-9_-]+)/i);
      if (match) invoice_number = match[1];
    }
    if (!amount_ht && /(?:total\s+ht|montant\s+ht|ht)\s*[:=]?\s*([\d\s,.]+)/i.test(line)) {
      const match = line.match(/(?:total\s+ht|montant\s+ht|ht)\s*[:=]?\s*([\d\s,.]+)/i);
      if (match) amount_ht = cleanNumberString(match[1]);
    }
    if (!tva && /(?:total\s+tva|montant\s+tva|tva)\s*[:=]?\s*([\d\s,.]+)/i.test(line)) {
      const match = line.match(/(?:total\s+tva|montant\s+tva|tva)\s*[:=]?\s*([\d\s,.]+)/i);
      if (match) tva = cleanNumberString(match[1]);
    }
    if (!amount_ttc && /(?:total\s+ttc|montant\s+ttc|ttc|net\s+[aà]\s+payer)\s*[:=]?\s*([\d\s,.]+)/i.test(line)) {
      const match = line.match(/(?:total\s+ttc|montant\s+ttc|ttc|net\s+[aà]\s+payer)\s*[:=]?\s*([\d\s,.]+)/i);
      if (match) amount_ttc = cleanNumberString(match[1]);
    }
  }

  if (vendor && date && amount_ht && amount_ttc) {
    if (!tva) {
      tva = toDecimal(amount_ttc).minus(amount_ht).toFixed(2);
    }
    return {
      vendor,
      date,
      amount_ht,
      tva_rate,
      tva,
      amount_ttc,
      invoice_number
    };
  }

  return null;
}

export function isPdf(filename: string, mimeType?: string): boolean {
  return Boolean(mimeType === "application/pdf" || /\.pdf$/i.test(filename));
}

export function isImage(filename: string, mimeType?: string): boolean {
  return Boolean(
    mimeType?.startsWith("image/") || /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(filename)
  );
}

export function isCsv(filename: string, mimeType?: string): boolean {
  return Boolean(
    mimeType === "text/csv" ||
    mimeType === "text/plain" ||
    mimeType === "application/csv" ||
    /\.(csv|tsv|txt)$/i.test(filename)
  );
}

export function isExcel(filename: string, mimeType?: string): boolean {
  return Boolean(
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel" ||
    mimeType?.includes("spreadsheet") ||
    /\.(xlsx?|xlsm|xlsb)$/i.test(filename)
  );
}

export function isBankStatementFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.includes("relev") || lower.includes("bank") || lower.includes("statement") || lower.includes("extrait");
}

function findValue(row: Record<string, unknown>, aliases: string[]): string | null {
  const entries = Object.entries(row).map(([key, value]) => ({
    rawKey: key,
    normKey: key.toLowerCase().replace(/[^a-z0-9]/g, ""),
    val: value
  }));

  // 1. Exact match first
  for (const alias of aliases) {
    const wanted = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
    const match = entries.find((e) => e.normKey === wanted);
    if (match && match.val !== null && match.val !== undefined && String(match.val).trim() !== "") {
      return String(match.val).trim();
    }
  }

  // 2. Starts with or includes (only if alias is at least 3 chars)
  for (const alias of aliases) {
    const wanted = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (wanted.length < 3) continue;
    const match = entries.find((e) => e.normKey.includes(wanted));
    if (match && match.val !== null && match.val !== undefined && String(match.val).trim() !== "") {
      return String(match.val).trim();
    }
  }

  return null;
}

export function isInvoiceTable(rows: Record<string, unknown>[]): boolean {
  if (rows.length === 0) return false;
  const keys = Object.keys(rows[0]).map(k => k.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const hasVendor = keys.some(k =>
    k.includes("fournisseur") ||
    k.includes("vendor") ||
    k.includes("supplier") ||
    k.includes("tiers") ||
    k.includes("societe") ||
    k.includes("client")
  );
  const hasHtOrTtc = keys.some(k =>
    k === "ht" ||
    k === "ttc" ||
    k === "tva" ||
    k.includes("montantht") ||
    k.includes("amountht") ||
    k.includes("montantttc") ||
    k.includes("amountttc") ||
    k.includes("facture") ||
    k.includes("invoice")
  );
  return hasVendor || hasHtOrTtc;
}

export function isBankStatement(rows: Record<string, unknown>[]): boolean {
  if (rows.length === 0) return false;
  const keys = Object.keys(rows[0]).map(k => k.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const hasDebitCredit = keys.some(k => k.includes("debit") || k.includes("credit"));
  const hasDate = keys.some(k => k.includes("date") || k.includes("operation"));
  const hasLibelle = keys.some(k =>
    k.includes("libelle") ||
    k.includes("wording") ||
    k.includes("label") ||
    k.includes("description")
  );

  if (hasDate && hasDebitCredit) return true;
  if (hasDate && hasLibelle && !isInvoiceTable(rows)) return true;
  return false;
}

export function extractBankLinesFromRows(rows: Record<string, unknown>[]): IngestorBankLine[] {
  const lines: IngestorBankLine[] = [];
  for (const row of rows) {
    const rawDate = findValue(row, ["date", "date_operation", "date_valeur", "date operation"]);
    const description = findValue(row, ["libelle", "description", "label", "wording", "operation", "detail", "libelle de loperation", "libelle operation"]) || "Opération bancaire";
    if (!rawDate) continue;
    const date = normalizeDate(rawDate);
    if (!date) continue;

    try {
      const debit = findValue(row, ["debit_mad", "debit", "montant_debit", "debit_amount", "debit mad", "montant debit"]);
      const credit = findValue(row, ["credit_mad", "credit", "montant_credit", "credit_amount", "credit mad", "montant credit"]);
      const montant = findValue(row, ["montant", "amount", "solde"]);

      let amount: string | null = null;
      if (debit) {
        const val = toDecimal(cleanNumberString(debit));
        if (val.greaterThan(0)) amount = val.toFixed(2);
      }
      if (!amount && credit) {
        const val = toDecimal(cleanNumberString(credit));
        if (val.greaterThan(0)) amount = val.neg().toFixed(2);
      }
      if (!amount && montant) {
        const val = toDecimal(cleanNumberString(montant));
        if (!val.isZero()) amount = val.toFixed(2);
      }

      if (!amount || toDecimal(amount).isZero()) continue;
      lines.push({ date, description, amount });
    } catch {
      continue;
    }
  }
  return lines;
}

export function extractInvoicesFromRows(rows: Record<string, unknown>[]): {
  valid: ExtractedInvoice[];
  invalidMath: boolean;
} {
  const invoices: ExtractedInvoice[] = [];
  let invalidMath = false;

  for (const row of rows) {
    const rawVendor = findValue(row, ["vendor", "fournisseur", "supplier", "tiers", "societe", "client", "raison_sociale"]);
    const rawDate = findValue(row, ["date facture", "date_facture", "invoice date", "date", "date_fact"]);
    const rawHt = findValue(row, ["amount ht", "montant ht", "ht", "hors taxe", "montant_ht", "total_ht"]);
    const rawTvaRate = findValue(row, ["taux tva", "tva rate", "taux_tva", "taux", "tva_rate", "rate"]);
    const rawTva = findValue(row, ["montant tva", "montant_tva", "tva", "taxe", "vat", "total_tva"]);
    const rawTtc = findValue(row, ["amount ttc", "montant ttc", "ttc", "total ttc", "total_ttc", "total", "montant_ttc", "net a payer"]);
    const rawNumber = findValue(row, ["numero facture", "n° facture", "num facture", "invoice number", "num_facture", "ref", "n°", "numero", "inv_number", "number"]);

    if (!rawVendor && !rawHt && !rawTtc) continue;

    const vendor = rawVendor || "Fournisseur Inconnu";
    const date = normalizeDate(rawDate) || new Date().toISOString().slice(0, 10);
    let amount_ht = rawHt ? cleanNumberString(rawHt) : null;
    let amount_ttc = rawTtc ? cleanNumberString(rawTtc) : null;
    let tva = rawTva ? cleanNumberString(rawTva) : null;
    let tva_rate = rawTvaRate ? cleanNumberString(rawTvaRate) : null;

    if (amount_ht && amount_ttc && !tva) {
      try {
        tva = toDecimal(amount_ttc).minus(amount_ht).toFixed(2);
      } catch {
        tva = "0.00";
      }
    } else if (amount_ht && tva && !amount_ttc) {
      try {
        amount_ttc = toDecimal(amount_ht).plus(tva).toFixed(2);
      } catch {
        amount_ttc = amount_ht;
      }
    } else if (amount_ttc && !amount_ht) {
      try {
        const rate = tva_rate || "20";
        const rateDec = toDecimal(rate).dividedBy(100).plus(1);
        amount_ht = toDecimal(amount_ttc).dividedBy(rateDec).toFixed(2);
        tva = toDecimal(amount_ttc).minus(amount_ht).toFixed(2);
      } catch {
        amount_ht = amount_ttc;
        tva = "0.00";
      }
    }

    if (!tva_rate) {
      if (amount_ht && tva && toDecimal(amount_ht).greaterThan(0)) {
        try {
          const calcRate = toDecimal(tva).dividedBy(amount_ht).times(100).round().toFixed(0);
          tva_rate = calcRate;
        } catch {
          tva_rate = "20";
        }
      } else {
        tva_rate = "20";
      }
    }

    if (!amount_ht || !amount_ttc) continue;

    const invoice: ExtractedInvoice = {
      vendor,
      date,
      amount_ht,
      tva_rate,
      tva: tva || "0.00",
      amount_ttc,
      invoice_number: rawNumber || null
    };

    if (validateInvoiceMath(invoice)) {
      invoices.push(invoice);
    } else {
      invalidMath = true;
    }
  }

  return { valid: invoices, invalidMath };
}

export function detectCsvSeparator(text: string): string {
  const separators = [";", ",", "\t", "|"];
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .slice(0, 10);

  if (lines.length === 0) return ",";

  let bestSep = ",";
  let maxCols = 0;

  for (const sep of separators) {
    const colCounts = lines.map(line => {
      let inQuotes = false;
      let count = 1;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') inQuotes = !inQuotes;
        else if (line[i] === sep && !inQuotes) count++;
      }
      return count;
    });

    const avgCols = colCounts.reduce((a, b) => a + b, 0) / colCounts.length;
    const minCols = Math.min(...colCounts);

    if (minCols > 1 && avgCols > maxCols) {
      maxCols = avgCols;
      bestSep = sep;
    }
  }

  return bestSep;
}

export function parseCsvRecords(text: string, separator: string): Record<string, unknown>[] {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length < 2) return [];

  function splitLine(line: string, sep: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === sep && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  const rawHeaders = splitLine(lines[0], separator);
  const headers = rawHeaders.map(h => h.replace(/^["']|["']$/g, "").trim());

  const records: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitLine(lines[i], separator).map(v => v.replace(/^["']|["']$/g, "").trim());
    if (values.every(v => v === "")) continue;

    const record: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      record[h || `col_${idx + 1}`] = values[idx] ?? "";
    });
    records.push(record);
  }

  return records;
}

export async function ingestCsv(buffer: Buffer, filename: string): Promise<IngestorResult> {
  const hash = documentHash(buffer);
  const cached = await getCachedResult(hash);
  if (cached) return cached;

  let text: string;
  try {
    text = buffer.toString("utf-8");
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
    }
  } catch {
    text = buffer.toString("latin1");
  }

  if (!text || text.trim().length === 0) {
    const result: IngestorFailure = {
      status: "non_traite",
      hash,
      reason: "csv_empty",
      message: "Fichier CSV vide ou sans lignes exploitables",
      rawText: ""
    };
    await setCachedResult(hash, result);
    return result;
  }

  const separator = detectCsvSeparator(text);
  const rows = parseCsvRecords(text, separator);

  if (rows.length === 0) {
    const result: IngestorFailure = {
      status: "non_traite",
      hash,
      reason: "csv_unreadable",
      message: "Structure CSV non reconnue ou nombre de lignes insuffisant",
      rawText: text.slice(0, 1000)
    };
    await setCachedResult(hash, result);
    return result;
  }

  const rawText = rows.map((r, i) => `row_${i + 1}: ${JSON.stringify(r)}`).join("\n");

  if (isBankStatement(rows) || isBankStatementFilename(filename)) {
    const bankLines = extractBankLinesFromRows(rows);
    if (bankLines.length > 0) {
      const result: IngestorBankResult = {
        status: "bank_lines",
        hash,
        rawText,
        lines: bankLines
      };
      await setCachedResult(hash, result);
      return result;
    }
  }

  const extraction = extractInvoicesFromRows(rows);
  if (extraction.valid.length > 0) {
    const result: IngestorSuccess = {
      status: "done",
      hash,
      rawText,
      invoice: extraction.valid[0],
      invoices: extraction.valid
    };
    await setCachedResult(hash, result);
    return result;
  }

  if (extraction.invalidMath) {
    const result: IngestorFailure = {
      status: "non_traite",
      hash,
      reason: "amount_validation_failed",
      message: "Incohérence des montants détectée dans le fichier CSV (HT + TVA != TTC)",
      rawText
    };
    await setCachedResult(hash, result);
    return result;
  }

  const detectedHeaders = Object.keys(rows[0] || {}).join(", ");
  const result: IngestorFailure = {
    status: "non_traite",
    hash,
    reason: "csv_unreadable",
    message: `Structure CSV inconnue - colonnes détectées: ${detectedHeaders || "aucune"}`,
    rawText: text.slice(0, 1000)
  };
  await setCachedResult(hash, result);
  return result;
}

export async function ingestExcel(buffer: Buffer, filename: string): Promise<IngestorResult> {
  const hash = documentHash(buffer);
  const cached = await getCachedResult(hash);
  if (cached) return cached;

  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
    const allRows: Record<string, unknown>[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const sheetRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      if (sheetRows.length > 0) {
        allRows.push(...sheetRows);
      }
    }

    if (allRows.length === 0) {
      const result: IngestorFailure = {
        status: "non_traite",
        hash,
        reason: "excel_unreadable",
        message: "Feuille Excel vide ou sans données exploitables",
        rawText: ""
      };
      await setCachedResult(hash, result);
      return result;
    }

    const rawText = allRows.map((r, i) => `row_${i + 1}: ${JSON.stringify(r)}`).join("\n");

    if (isBankStatement(allRows) || isBankStatementFilename(filename)) {
      const bankLines = extractBankLinesFromRows(allRows);
      if (bankLines.length > 0) {
        const result: IngestorBankResult = {
          status: "bank_lines",
          hash,
          rawText,
          lines: bankLines
        };
        await setCachedResult(hash, result);
        return result;
      }
    }

    const extraction = extractInvoicesFromRows(allRows);
    if (extraction.valid.length > 0) {
      const result: IngestorSuccess = {
        status: "done",
        hash,
        rawText,
        invoice: extraction.valid[0],
        invoices: extraction.valid
      };
      await setCachedResult(hash, result);
      return result;
    }

    if (extraction.invalidMath) {
      const result: IngestorFailure = {
        status: "non_traite",
        hash,
        reason: "amount_validation_failed",
        message: "Incohérence des montants détectée dans le fichier Excel (HT + TVA != TTC)",
        rawText
      };
      await setCachedResult(hash, result);
      return result;
    }

    const detectedHeaders = Object.keys(allRows[0] || {}).join(", ");
    const result: IngestorFailure = {
      status: "non_traite",
      hash,
      reason: "excel_unreadable",
      message: `Structure Excel non reconnue - colonnes détectées: ${detectedHeaders || "aucune"}`,
      rawText
    };
    await setCachedResult(hash, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur de lecture du fichier Excel";
    const result: IngestorFailure = {
      status: "non_traite",
      hash,
      reason: "excel_unreadable",
      message: `Fichier Excel corrompu ou illisible: ${message}`
    };
    await setCachedResult(hash, result);
    return result;
  }
}

export async function ingestCleanPdf(buffer: Buffer, filename: string): Promise<IngestorResult> {
  const hash = documentHash(buffer);
  const cached = await getCachedResult(hash);
  if (cached) return cached;

  let rawText = "";
  try {
    const parsedPdf = await pdfParse(buffer).catch(() => null);
    rawText = parsedPdf?.text?.trim() ?? "";

    if (!rawText) {
      rawText = extractTextFromPdfStreams(buffer);
    }
  } catch {
    rawText = "";
  }

  if (!rawText || rawText.length < 20) {
    const result: IngestorFailure = {
      status: "non_traite",
      hash,
      reason: "pdf_unreadable",
      message: "PDF scanné ou texte inexploitable sans OCR visuel"
    };
    await setCachedResult(hash, result);
    return result;
  }

  const rawInvoice = await extractInvoiceJson(rawText);
  const invoice = rawInvoice ? cleanExtractedInvoice(rawInvoice) : null;

  if (!invoice) {
    const result: IngestorFailure = {
      status: "non_traite",
      hash,
      reason: "llm_json_invalid",
      message: "Extraction structurée des informations de facture impossible",
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
      message: `Incohérence des montants: HT (${invoice.amount_ht}) + TVA (${invoice.tva}) != TTC (${invoice.amount_ttc})`,
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

export async function ingestImage(buffer: Buffer, filename: string): Promise<IngestorResult> {
  const hash = documentHash(buffer);
  const cached = await getCachedResult(hash);
  if (cached) return cached;

  if (buffer.length < 500) {
    const result: IngestorFailure = {
      status: "non_traite",
      hash,
      reason: "image_quality_low",
      message: "Image trop petite ou corrompue"
    };
    await setCachedResult(hash, result);
    return result;
  }

  const ocr = await (async () => {
    const langPath = join(process.cwd(), "apps", "api");
    const worker = await createWorker("fra+eng", 1, {
      langPath,
      gzip: false
    }).catch(() => createWorker("fra+eng").catch(() => null));

    if (!worker) return null;

    try {
      return await worker.recognize(buffer);
    } finally {
      await worker.terminate();
    }
  })().catch(() => null);

  const confidence = (ocr?.data.confidence ?? 0) / 100;
  const rawText = ocr?.data.text?.trim() ?? "";

  if (confidence < 0.35 || !rawText) {
    const result: IngestorFailure = {
      status: "non_traite",
      hash,
      reason: "image_quality_low",
      message: `Image trop floue ou texte inexploitable (confiance OCR: ${(confidence * 100).toFixed(0)}%)`,
      rawText
    };
    await setCachedResult(hash, result);
    return result;
  }

  const rawInvoice = await extractInvoiceJson(rawText);
  const invoice = rawInvoice ? cleanExtractedInvoice(rawInvoice) : null;

  if (!invoice) {
    const result: IngestorFailure = {
      status: "non_traite",
      hash,
      reason: "llm_json_invalid",
      message: "Impossible d'extraire les champs de facture de l'image",
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
      message: `Incohérence des montants: HT (${invoice.amount_ht}) + TVA (${invoice.tva}) != TTC (${invoice.amount_ttc})`,
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
  try {
    if (isCsv(filename, mimeType)) {
      return ingestCsv(buffer, filename);
    }

    if (isExcel(filename, mimeType)) {
      return ingestExcel(buffer, filename);
    }

    if (isPdf(filename, mimeType)) {
      return ingestCleanPdf(buffer, filename);
    }

    if (isImage(filename, mimeType)) {
      return ingestImage(buffer, filename);
    }

    return {
      status: "non_traite",
      hash: documentHash(buffer),
      reason: "unsupported_file_type",
      message: `Format non supporté pour le fichier ${filename}`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur technique";
    return {
      status: "non_traite",
      hash: documentHash(buffer),
      reason: "ingestion_error",
      message: `Erreur inattendue: ${message}`
    };
  }
}
