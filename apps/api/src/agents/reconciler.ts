import type { AgentDefinition } from "@chiffra/shared";
import { toDecimal } from "@chiffra/shared";

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
};

export function isNonInvoiceBankLine(description: string, amount: string): boolean {
  try {
    const num = Number.parseFloat(amount);
    // Les encaissements / règlements clients (crédits positifs) ne sont pas des achats
    if (num < 0) return true;
  } catch {
    // continue
  }

  const desc = (description || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

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
  // Filter candidates within 60 days
  const validCandidates = candidates.filter((c) => {
    const days = getDaysBetween(c.date, bankLineDate);
    return days >= -5 && days <= 65 && toDecimal(c.amount_ttc).lessThanOrEqualTo(target);
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

  // 1. Passe 1 : Rapprochement 1-à-1 exact avec vérification du délai <= 60 jours
  for (const bankLine of relevantBankLines) {
    const bankAmount = toDecimal(bankLine.amount).abs().toFixed(2);

    // Chercher une facture candidate dans la fenêtre des 60 jours
    const invoice = invoices.find((candidate) => {
      if (matchedInvoiceIds.has(candidate.id)) return false;
      if (!equalsMoney(bankAmount, candidate.amount_ttc)) return false;
      const days = getDaysBetween(candidate.date, bankLine.date);
      return days >= -5 && days <= 65; // ~60 jours max
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

  // 2. Passe 2 : Rapprochement 1-à-1 exact sans contrainte stricte de date si non appariée
  for (const bankLine of relevantBankLines) {
    if (matchedBankLineIds.has(bankLine.id)) continue;
    const bankAmount = toDecimal(bankLine.amount).abs().toFixed(2);

    const invoice = invoices.find(
      (candidate) =>
        !matchedInvoiceIds.has(candidate.id) &&
        equalsMoney(bankAmount, candidate.amount_ttc)
    );

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

  // 3. Passe 3 : Paiement Groupé (1-à-N factures)
  for (const bankLine of relevantBankLines) {
    if (matchedBankLineIds.has(bankLine.id)) continue;
    const bankAmount = toDecimal(bankLine.amount).abs().toFixed(2);

    const candidates = invoices.filter((invoice) => !matchedInvoiceIds.has(invoice.id));
    const group = findGroupedInvoices(bankAmount, candidates, bankLine.date);

    if (group && group.length > 1) {
      matched.push({
        type: "grouped",
        bank_line_id: bankLine.id,
        invoice_ids: group.map((invoice) => invoice.id),
        amount: sumInvoices(group)
      });

      for (const inv of group) {
        matchedInvoiceIds.add(inv.id);
      }
      matchedBankLineIds.add(bankLine.id);
    }
  }

  // 4. Passe 4 : Paiement Partiel (optionnel)
  for (const bankLine of relevantBankLines) {
    if (matchedBankLineIds.has(bankLine.id)) continue;
    const bankAmount = toDecimal(bankLine.amount).abs();

    const invoice = invoices.find(
      (candidate) =>
        !matchedInvoiceIds.has(candidate.id) &&
        bankAmount.greaterThan(0) &&
        bankAmount.lessThan(candidate.amount_ttc) &&
        getDaysBetween(candidate.date, bankLine.date) >= -5 &&
        getDaysBetween(candidate.date, bankLine.date) <= 60
    );

    if (invoice) {
      const residual = toDecimal(invoice.amount_ttc).minus(bankAmount).toFixed(2);
      partial.push({
        type: "partial",
        bank_line_id: bankLine.id,
        invoice_id: invoice.id,
        paid: bankAmount.toFixed(2),
        residual
      });
      residuals.push({
        invoice_id: invoice.id,
        residual
      });
      matchedInvoiceIds.add(invoice.id);
      matchedBankLineIds.add(bankLine.id);
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
    residuals
  };
}

