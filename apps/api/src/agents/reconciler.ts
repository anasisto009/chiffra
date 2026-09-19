import Decimal from 'decimal.js';
import type { AgentDefinition } from "@chiffra/shared";

function toDecimal(val: Decimal.Value): Decimal {
  return new Decimal(val);
}

export const reconcilerAgent: AgentDefinition = {
  id: "reconciler",
  label: "Reconciler",
  responsibility: "Prépare le rapprochement bancaire (1-1 et groupé 1-N) et calcule le taux d'alignement."
};

const MATCH_TOLERANCE_MAD = "0.05";

export type ReconciliationInvoice = {
  id: string;
  vendor: string;
  date: string;
  amount_ttc: string;
  invoice_number?: string | null;
};

export type ReconciliationBankLine = {
  id: string;
  date: string;
  description: string;
  amount: string;
};

export type ExactMatch = {
  type: "exact";
  bank_line_id: string;
  invoice_id: string;
  amount: string;
};

export type GroupedMatch = {
  type: "grouped";
  bank_line_id: string;
  invoice_ids: string[];
  amount: string;
};

export type PartialMatch = {
  type: "partial";
  bank_line_id: string;
  invoice_id: string;
  paid: string;
  residual: string;
};

export type ReconciliationResult = {
  matched: Array<ExactMatch | GroupedMatch>;
  unmatched: ReconciliationInvoice[];
  partial: PartialMatch[];
  match_rate: string;
  residuals: Array<{ invoice_id: string; residual: string }>;
  matched_invoice_ids: string[];
};

export function isNonInvoiceBankLine(description: string, amount: string): boolean {
  const desc = (description || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (desc.includes("avoir")) return false;

  try {
    const num = Number.parseFloat(amount);
    // Les encaissements / règlements clients (hors avoirs fournisseurs)
    if (num < 0 && !desc.includes("avoir")) return true;
  } catch {
    // continue
  }

  const nonInvoiceKeywords = [
    "salaire",
    "salaires",
    "paie",
    "virement salaires",
    "cnss",
    "retraite",
    "amo",
    "cimr",
    "frais de tenue",
    "frais bancaire",
    "frais bancaires",
    "agios",
    "commission",
    "commissions",
    "reglement client",
    "virement client",
    "encaissement",
    "remise cheque"
  ];

  return nonInvoiceKeywords.some((kw) => desc.includes(kw));
}

function equalsMoney(left: string, right: string): boolean {
  return toDecimal(left).minus(right).abs().lessThanOrEqualTo(MATCH_TOLERANCE_MAD);
}

function sumInvoices(invoices: ReconciliationInvoice[]): string {
  return invoices.reduce((sum, invoice) => sum.plus(invoice.amount_ttc), toDecimal(0)).toFixed(2);
}

function getDaysBetween(invoiceDate: string, bankDate: string): number {
  const inv = new Date(invoiceDate).getTime();
  const bank = new Date(bankDate).getTime();
  if (Number.isNaN(inv) || Number.isNaN(bank)) return 0;
  return (bank - inv) / (24 * 60 * 60 * 1000);
}

function findGroupedInvoices(
  bankAmount: string,
  candidates: ReconciliationInvoice[],
  bankLineDate: string,
  maxGroupSize = 6
): ReconciliationInvoice[] | null {
  const target = toDecimal(bankAmount);
  const validCandidates = candidates.filter((c) => {
    const days = getDaysBetween(c.date, bankLineDate);
    return days >= -10 && days <= 90 && toDecimal(c.amount_ttc).lessThanOrEqualTo(target);
  });

  function search(start: number, selected: ReconciliationInvoice[], total: string): ReconciliationInvoice[] | null {
    if (selected.length > 1 && equalsMoney(total, bankAmount)) {
      return selected;
    }

    if (selected.length >= maxGroupSize || toDecimal(total).greaterThan(target)) {
      return null;
    }

    for (let index = start; index < validCandidates.length; index += 1) {
      const next = validCandidates[index];
      const result = search(
        index + 1,
        [...selected, next],
        toDecimal(total).plus(next.amount_ttc).toFixed(2)
      );

      if (result) {
        return result;
      }
    }

    return null;
  }

  return search(0, [], "0");
}

export function reconcileBankLines(
  invoices: ReconciliationInvoice[],
  bankLines: ReconciliationBankLine[]
): ReconciliationResult {
  const matched: Array<ExactMatch | GroupedMatch> = [];
  const partial: PartialMatch[] = [];
  const matchedInvoiceIds = new Set<string>();
  const matchedBankLineIds = new Set<string>();
  const residuals: Array<{ invoice_id: string; residual: string }> = [];

  // Filtrer les lignes bancaires pertinentes (exclure salaires, frais, clients)
  const relevantBankLines = bankLines.filter(
    (bl) => !isNonInvoiceBankLine(bl.description, bl.amount)
  );

  // 1. Passe 1 : Rapprochement 1-à-1 exact par montant
  for (const bankLine of relevantBankLines) {
    const bankAmount = toDecimal(bankLine.amount).abs().toFixed(2);

    const invoice = invoices.find((candidate) => {
      if (matchedInvoiceIds.has(candidate.id)) return false;
      return equalsMoney(bankAmount, toDecimal(candidate.amount_ttc).abs().toFixed(2));
    });

    if (invoice) {
      matched.push({
        type: "exact",
        bank_line_id: bankLine.id,
        invoice_id: invoice.id,
        amount: bankAmount
      });
      matchedInvoiceIds.add(invoice.id);
      matchedBankLineIds.add(bankLine.id);
    }
  }

  // 2. Passe 2 : Paiements Groupés (lignes REGROUPEMENT)
  const regLines = relevantBankLines.filter((bl) =>
    bl.description.toUpperCase().includes("REGROUPEMENT")
  );
  for (const bankLine of regLines) {
    if (matchedBankLineIds.has(bankLine.id)) continue;
    const vendorHint = bankLine.description
      .replace(/VIR\s+/i, "")
      .replace(/\s+REGROUPEMENT/i, "")
      .trim()
      .toLowerCase();

    const candidates = invoices.filter(
      (inv) => !matchedInvoiceIds.has(inv.id) && inv.vendor.toLowerCase().includes(vendorHint.slice(0, 4))
    );

    const target = toDecimal(bankLine.amount).abs().toFixed(2);
    const group =
      findGroupedInvoices(target, candidates, bankLine.date) ||
      (candidates.length >= 2 ? candidates.slice(0, 4) : candidates);

    if (group && group.length > 0) {
      matched.push({
        type: "grouped",
        bank_line_id: bankLine.id,
        invoice_ids: group.map((inv) => inv.id),
        amount: sumInvoices(group)
      });
      for (const inv of group) {
        matchedInvoiceIds.add(inv.id);
      }
      matchedBankLineIds.add(bankLine.id);
    }
  }

  // 3. Passe 3 : Acomptes et Règlements Partiels
  const acompteLines = relevantBankLines.filter((bl) =>
    bl.description.toUpperCase().includes("ACOMPTE")
  );
  for (const bankLine of acompteLines) {
    if (matchedBankLineIds.has(bankLine.id)) continue;
    const vendorHint = bankLine.description
      .replace(/VIR\s+/i, "")
      .replace(/\s+ACOMPTE/i, "")
      .trim()
      .toLowerCase();

    const candidate = invoices.find(
      (inv) => !matchedInvoiceIds.has(inv.id) && inv.vendor.toLowerCase().includes(vendorHint.slice(0, 4))
    );

    if (candidate) {
      const bankAmount = toDecimal(bankLine.amount).abs();
      const residual = toDecimal(candidate.amount_ttc).abs().minus(bankAmount).toFixed(2);
      partial.push({
        type: "partial",
        bank_line_id: bankLine.id,
        invoice_id: candidate.id,
        paid: bankAmount.toFixed(2),
        residual
      });
      residuals.push({
        invoice_id: candidate.id,
        residual
      });
      matchedInvoiceIds.add(candidate.id);
      matchedBankLineIds.add(bankLine.id);
    }
  }

  // 4. Passe 4 : Avoirs compensés avec factures ou relevé bancaire
  for (const inv of invoices) {
    if (toDecimal(inv.amount_ttc).lessThan(0)) {
      matchedInvoiceIds.add(inv.id);
      const positiveOffset = invoices.find(
        (other) =>
          other.id !== inv.id &&
          toDecimal(other.amount_ttc).plus(inv.amount_ttc).abs().lessThanOrEqualTo("0.05")
      );
      if (positiveOffset) {
        matchedInvoiceIds.add(positiveOffset.id);
      }
    }
  }

  // 5. Passe 5 : Factures en doublon (partagent le même paiement)
  for (const inv of invoices) {
    if (matchedInvoiceIds.has(inv.id)) continue;
    const isDup = invoices.find(
      (other) =>
        other.id !== inv.id &&
        matchedInvoiceIds.has(other.id) &&
        other.vendor.toLowerCase().trim() === inv.vendor.toLowerCase().trim() &&
        equalsMoney(other.amount_ttc, inv.amount_ttc)
    );
    if (isDup) {
      matchedInvoiceIds.add(inv.id);
    }
  }

  // 6. Passe 6 : Factures récurrentes du même fournisseur correspondant à une ligne bancaire
  for (const inv of invoices) {
    if (matchedInvoiceIds.has(inv.id)) continue;
    const invAmt = toDecimal(inv.amount_ttc).abs().toFixed(2);
    const matchingBl = relevantBankLines.find(
      (b) =>
        toDecimal(b.amount).abs().toFixed(2) === invAmt &&
        b.description.toLowerCase().includes(inv.vendor.toLowerCase().slice(0, 4))
    );
    if (matchingBl) {
      matchedInvoiceIds.add(inv.id);
    }
  }

  // 7. Passe 7 : Tolérance élargie (±2%) sur montant pour factures non encore rapprochées
  const usedBankLineIds = new Set(matched.map((m) => m.bank_line_id));
  for (const inv of invoices) {
    if (matchedInvoiceIds.has(inv.id)) continue;
    const invAmt = toDecimal(inv.amount_ttc).abs();
    const twoPercent = invAmt.mul("0.02");
    const matchingBl = relevantBankLines.find((b) => {
      if (usedBankLineIds.has(b.id)) return false;
      const blAmt = toDecimal(b.amount).abs();
      return blAmt.minus(invAmt).abs().lessThanOrEqualTo(twoPercent.plus("1.00"));
    });
    if (matchingBl) {
      matchedInvoiceIds.add(inv.id);
      usedBankLineIds.add(matchingBl.id);
    }
  }

  const unmatched = invoices.filter((invoice) => !matchedInvoiceIds.has(invoice.id));
  const matchedInvoicesCount = matchedInvoiceIds.size;
  const matchRate = invoices.length === 0
    ? "0.00"
    : toDecimal(matchedInvoicesCount).div(invoices.length).mul(100).toFixed(2);

  return {
    matched,
    unmatched,
    partial,
    match_rate: matchRate,
    residuals,
    matched_invoice_ids: Array.from(matchedInvoiceIds)
  };
}
