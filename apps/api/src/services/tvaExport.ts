import { toDecimal } from "@chiffra/shared";
import { pool } from "../db/client.js";

export type TvaExportRow = {
  tva_rate: string;
  invoice_count: number;
  total_ht: string;
  total_tva: string;
  total_ttc: string;
};

export type TvaExport = {
  currency: "MAD";
  generated_at: string;
  rows: TvaExportRow[];
  totals: {
    invoice_count: number;
    total_ht: string;
    total_tva: string;
    total_ttc: string;
  };
};

const TVA_RATES = ["0", "7", "10", "14", "20"];

export async function buildTvaExport(): Promise<TvaExport> {
  const invoices = await pool.query<{
    tva_rate: string;
    amount_ht: string;
    tva: string;
    amount_ttc: string;
  }>(
    `SELECT tva_rate::text, amount_ht::text, tva::text, amount_ttc::text
     FROM invoices`
  );

  const rows = TVA_RATES.map((rate) => {
    const matching = invoices.rows.filter((invoice) => toDecimal(invoice.tva_rate).equals(rate));
    const totalHt = matching.reduce((sum, invoice) => sum.plus(invoice.amount_ht), toDecimal(0));
    const totalTva = matching.reduce((sum, invoice) => sum.plus(invoice.tva), toDecimal(0));
    const totalTtc = matching.reduce((sum, invoice) => sum.plus(invoice.amount_ttc), toDecimal(0));

    return {
      tva_rate: rate,
      invoice_count: matching.length,
      total_ht: totalHt.toFixed(2),
      total_tva: totalTva.toFixed(2),
      total_ttc: totalTtc.toFixed(2)
    };
  });

  const totals = rows.reduce(
    (acc, row) => ({
      invoice_count: acc.invoice_count + row.invoice_count,
      total_ht: acc.total_ht.plus(row.total_ht),
      total_tva: acc.total_tva.plus(row.total_tva),
      total_ttc: acc.total_ttc.plus(row.total_ttc)
    }),
    {
      invoice_count: 0,
      total_ht: toDecimal(0),
      total_tva: toDecimal(0),
      total_ttc: toDecimal(0)
    }
  );

  return {
    currency: "MAD",
    generated_at: new Date().toISOString(),
    rows,
    totals: {
      invoice_count: totals.invoice_count,
      total_ht: totals.total_ht.toFixed(2),
      total_tva: totals.total_tva.toFixed(2),
      total_ttc: totals.total_ttc.toFixed(2)
    }
  };
}

export function tvaExportToCsv(exportData: TvaExport): string {
  const header = ["tva_rate", "invoice_count", "total_ht_mad", "total_tva_mad", "total_ttc_mad"];
  const rows = exportData.rows.map((row) => [
    row.tva_rate,
    String(row.invoice_count),
    row.total_ht,
    row.total_tva,
    row.total_ttc
  ]);
  rows.push([
    "TOTAL",
    String(exportData.totals.invoice_count),
    exportData.totals.total_ht,
    exportData.totals.total_tva,
    exportData.totals.total_ttc
  ]);

  return [header, ...rows].map((row) => row.join(",")).join("\n");
}

