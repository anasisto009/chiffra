import type { AgentDefinition } from "@chiffra/shared";
import { toDecimal } from "@chiffra/shared";

export const reconcilerAgent: AgentDefinition = {
  id: "reconciler",
  label: "Reconciler",
  responsibility: "Prepare le rapprochement bancaire et signale les ecarts."
};

const MATCH_TOLERANCE_MAD = "0.01";

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

function equalsMoney(left: string, right: string): boolean {
  return toDecimal(left).minus(right).abs().lessThanOrEqualTo(MATCH_TOLERANCE_MAD);
}

function sumInvoices(invoices: ReconciliationInvoice[]): string {
  return invoices.reduce((sum, invoice) => sum.plus(invoice.amount_ttc), toDecimal(0)).toFixed(2);
}

function findGroupedInvoices(
  bankAmount: string,
  invoices: ReconciliationInvoice[],
  maxGroupSize = 8
): ReconciliationInvoice[] | null {
  const target = toDecimal(bankAmount);
  const candidates = invoices.filter((invoice) => toDecimal(invoice.amount_ttc).lessThanOrEqualTo(target));

  function search(start: number, selected: ReconciliationInvoice[], total: string): ReconciliationInvoice[] | null {
    if (selected.length > 1 && equalsMoney(total, bankAmount)) {
      return selected;
    }

    if (selected.length >= maxGroupSize || toDecimal(total).greaterThan(target)) {
      return null;
    }

    for (let index = start; index < candidates.length; index += 1) {
      const next = candidates[index];
      const result = search(index + 1, [...selected, next], toDecimal(total).plus(next.amount_ttc).toFixed(2));

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

  for (const bankLine of bankLines) {
    const invoice = invoices.find(
      (candidate) =>
        !matchedInvoiceIds.has(candidate.id) &&
        equalsMoney(bankLine.amount, candidate.amount_ttc)
    );

    if (!invoice) {
      continue;
    }

    matched.push({
      type: "exact",
      bank_line_id: bankLine.id,
      invoice_id: invoice.id,
      amount: toDecimal(bankLine.amount).toFixed(2)
    });
    matchedInvoiceIds.add(invoice.id);
    matchedBankLineIds.add(bankLine.id);
  }

  for (const bankLine of bankLines) {
    if (matchedBankLineIds.has(bankLine.id)) {
      continue;
    }

    const candidates = invoices.filter((invoice) => !matchedInvoiceIds.has(invoice.id));
    const group = findGroupedInvoices(bankLine.amount, candidates);

    if (!group) {
      continue;
    }

    matched.push({
      type: "grouped",
      bank_line_id: bankLine.id,
      invoice_ids: group.map((invoice) => invoice.id),
      amount: sumInvoices(group)
    });

    for (const invoice of group) {
      matchedInvoiceIds.add(invoice.id);
    }
    matchedBankLineIds.add(bankLine.id);
  }

  for (const bankLine of bankLines) {
    if (matchedBankLineIds.has(bankLine.id)) {
      continue;
    }

    const invoice = invoices.find(
      (candidate) =>
        !matchedInvoiceIds.has(candidate.id) &&
        toDecimal(bankLine.amount).greaterThan(0) &&
        toDecimal(bankLine.amount).lessThan(candidate.amount_ttc)
    );

    if (!invoice) {
      continue;
    }

    const residual = toDecimal(invoice.amount_ttc).minus(bankLine.amount).toFixed(2);
    partial.push({
      type: "partial",
      bank_line_id: bankLine.id,
      invoice_id: invoice.id,
      paid: toDecimal(bankLine.amount).toFixed(2),
      residual
    });
    residuals.push({
      invoice_id: invoice.id,
      residual
    });
    matchedInvoiceIds.add(invoice.id);
    matchedBankLineIds.add(bankLine.id);
  }

  const unmatched = invoices.filter((invoice) => !matchedInvoiceIds.has(invoice.id));
  const matchedCount = invoices.length - unmatched.length;
  const matchRate = invoices.length === 0
    ? "0.00"
    : toDecimal(matchedCount).div(invoices.length).mul(100).toFixed(2);

  return {
    matched,
    unmatched,
    partial,
    match_rate: matchRate,
    residuals
  };
}
