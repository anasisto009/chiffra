import type { AgentDefinition } from "@chiffra/shared";
import { toDecimal } from "@chiffra/shared";

export const auditorAgent: AgentDefinition = {
  id: "auditor",
  label: "Auditor",
  responsibility: "Applique les regles fiscales TVA/IS et detecte les anomalies."
};

const ALLOWED_TVA_RATES = ["0", "7", "10", "14", "20"];
const TVA_TOLERANCE_MAD = "1";

export type VendorCategory =
  | "default"
  | "transport"
  | "hotels_restaurants"
  | "banking"
  | "water_electricity"
  | "medicine"
  | "exports"
  | "basic_food";

export type VendorReference = {
  vendor: string;
  category: VendorCategory;
};

export type AuditInvoice = {
  id: string;
  vendor: string;
  date: string;
  amount_ht: string;
  tva: string;
  tva_rate: string;
  amount_ttc: string;
  invoice_number?: string | null;
  period: string;
};

export type AuditAnomaly = {
  invoice_id: string;
  type:
    | "tva_rate_invalid"
    | "tva_calculation_error"
    | "tva_rate_mismatch"
    | "invoice_out_of_period"
    | "unknown_vendor"
    | "amount_aberrant"
    | "duplicate_probable";
  description: string;
  exposure_mad: string;
  severity: "low" | "medium" | "high";
};

export type AuditOptions = {
  fiscalPeriod: string;
  vendorReferential: VendorReference[];
  historicalInvoices?: AuditInvoice[];
  rejectedTypeCounts?: Record<string, number>;
};

const expectedRateByCategory: Record<VendorCategory, string> = {
  default: "20",
  transport: "14",
  hotels_restaurants: "10",
  banking: "10",
  water_electricity: "7",
  medicine: "7",
  exports: "0",
  basic_food: "0"
};

function normalizeVendor(vendor: string): string {
  return vendor.trim().toLowerCase();
}

function money(value: string): string {
  return toDecimal(value).toFixed(2);
}

function severityForExposure(exposureMad: string): AuditAnomaly["severity"] {
  const exposure = toDecimal(exposureMad).abs();

  if (exposure.greaterThanOrEqualTo("10000")) {
    return "high";
  }

  if (exposure.greaterThanOrEqualTo("1000")) {
    return "medium";
  }

  return "low";
}

function lowerSeverity(severity: AuditAnomaly["severity"]): AuditAnomaly["severity"] {
  if (severity === "high") {
    return "medium";
  }

  if (severity === "medium") {
    return "low";
  }

  return "low";
}

function applyFeedbackPriority(
  anomaly: AuditAnomaly,
  rejectedTypeCounts: Record<string, number> = {}
): AuditAnomaly {
  const rejectedCount = rejectedTypeCounts[anomaly.type] ?? 0;

  if (rejectedCount < 2) {
    return anomaly;
  }

  return {
    ...anomaly,
    severity: lowerSeverity(anomaly.severity),
    description: `${anomaly.description} Priorite reduite: ce type a deja ete rejete ${rejectedCount} fois.`
  };
}

function vendorLookup(vendors: VendorReference[]): Map<string, VendorReference> {
  return new Map(vendors.map((vendor) => [normalizeVendor(vendor.vendor), vendor]));
}

function expectedTva(invoice: AuditInvoice): string {
  return toDecimal(invoice.amount_ht).mul(invoice.tva_rate).div(100).toFixed(2);
}

function daysBetween(a: string, b: string): number {
  const left = new Date(`${a}T00:00:00.000Z`).getTime();
  const right = new Date(`${b}T00:00:00.000Z`).getTime();
  return Math.abs(left - right) / (24 * 60 * 60 * 1000);
}

function vendorAverage(invoice: AuditInvoice, invoices: AuditInvoice[]): string | null {
  const sameVendor = invoices.filter(
    (candidate) =>
      candidate.id !== invoice.id && normalizeVendor(candidate.vendor) === normalizeVendor(invoice.vendor)
  );

  if (sameVendor.length === 0) {
    return null;
  }

  const total = sameVendor.reduce(
    (sum, candidate) => sum.plus(candidate.amount_ttc),
    toDecimal(0)
  );
  return total.div(sameVendor.length).toFixed(2);
}

export function auditInvoices(invoices: AuditInvoice[], options: AuditOptions): AuditAnomaly[] {
  const anomalies: AuditAnomaly[] = [];
  const vendors = vendorLookup(options.vendorReferential);
  const history = [...(options.historicalInvoices ?? []), ...invoices];

  for (const invoice of invoices) {
    const rate = toDecimal(invoice.tva_rate);
    const actualTva = toDecimal(invoice.tva);
    const expected = toDecimal(expectedTva(invoice));
    const vendorReference = vendors.get(normalizeVendor(invoice.vendor));

    if (!ALLOWED_TVA_RATES.some((allowedRate) => rate.equals(allowedRate))) {
      anomalies.push(applyFeedbackPriority({
        invoice_id: invoice.id,
        type: "tva_rate_invalid",
        description: `Taux TVA ${invoice.tva_rate}% non autorise.`,
        exposure_mad: money(invoice.tva),
        severity: severityForExposure(invoice.tva)
      }, options.rejectedTypeCounts));
    }

    const tvaDelta = expected.minus(actualTva).abs();

    if (tvaDelta.greaterThan(TVA_TOLERANCE_MAD)) {
      anomalies.push(applyFeedbackPriority({
        invoice_id: invoice.id,
        type: "tva_calculation_error",
        description: `TVA attendue ${expected.toFixed(2)} MAD, TVA facturee ${actualTva.toFixed(2)} MAD.`,
        exposure_mad: tvaDelta.toFixed(2),
        severity: severityForExposure(tvaDelta.toFixed(2))
      }, options.rejectedTypeCounts));
    }

    if (!vendorReference) {
      anomalies.push(applyFeedbackPriority({
        invoice_id: invoice.id,
        type: "unknown_vendor",
        description: `Fournisseur inconnu du referentiel: ${invoice.vendor}.`,
        exposure_mad: money(invoice.amount_ttc),
        severity: severityForExposure(invoice.amount_ttc)
      }, options.rejectedTypeCounts));
    } else {
      const expectedRate = expectedRateByCategory[vendorReference.category];

      if (!rate.equals(expectedRate)) {
        const exposure = toDecimal(invoice.amount_ht)
          .mul(rate.minus(expectedRate).abs())
          .div(100)
          .toFixed(2);
        anomalies.push(applyFeedbackPriority({
          invoice_id: invoice.id,
          type: "tva_rate_mismatch",
          description: `Taux TVA ${invoice.tva_rate}% incoherent avec la categorie ${vendorReference.category}; attendu ${expectedRate}%.`,
          exposure_mad: exposure,
          severity: severityForExposure(exposure)
        }, options.rejectedTypeCounts));
      }
    }

    if (invoice.period !== options.fiscalPeriod) {
      anomalies.push(applyFeedbackPriority({
        invoice_id: invoice.id,
        type: "invoice_out_of_period",
        description: `Facture rattachee a ${invoice.period}, hors periode fiscale ${options.fiscalPeriod}.`,
        exposure_mad: money(invoice.amount_ttc),
        severity: "medium"
      }, options.rejectedTypeCounts));
    }

    const average = vendorAverage(invoice, history);

    if (average && toDecimal(invoice.amount_ttc).greaterThan(toDecimal(average).mul(3))) {
      const exposure = toDecimal(invoice.amount_ttc).minus(average).toFixed(2);
      anomalies.push(applyFeedbackPriority({
        invoice_id: invoice.id,
        type: "amount_aberrant",
        description: `Montant ${invoice.amount_ttc} MAD superieur a 3x la moyenne fournisseur (${average} MAD).`,
        exposure_mad: exposure,
        severity: severityForExposure(exposure)
      }, options.rejectedTypeCounts));
    }

    const duplicate = history.find(
      (candidate) =>
        candidate.id !== invoice.id &&
        normalizeVendor(candidate.vendor) === normalizeVendor(invoice.vendor) &&
        toDecimal(candidate.amount_ttc).equals(invoice.amount_ttc) &&
        daysBetween(candidate.date, invoice.date) <= 3
    );

    if (duplicate) {
      anomalies.push(applyFeedbackPriority({
        invoice_id: invoice.id,
        type: "duplicate_probable",
        description: `Doublon probable avec la facture ${duplicate.invoice_number ?? duplicate.id}.`,
        exposure_mad: money(invoice.amount_ttc),
        severity: severityForExposure(invoice.amount_ttc)
      }, options.rejectedTypeCounts));
    }
  }

  return anomalies;
}
