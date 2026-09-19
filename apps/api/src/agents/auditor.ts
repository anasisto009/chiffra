import Decimal from 'decimal.js';
import type { AgentDefinition } from "@chiffra/shared";

export function toDecimal(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

export type AnomalyFamily =
  | "DOUBLON"
  | "TVA_INCORRECTE"
  | "HORS_PERIODE"
  | "TIERS_INCONNU"
  | "MONTANT_ABERRANT";

export function getAnomalyFamily(type: string): AnomalyFamily {
  switch (type) {
    case "duplicate_probable":
      return "DOUBLON";
    case "tva_rate_mismatch":
    case "tva_rate_invalid":
    case "tva_calculation_error":
      return "TVA_INCORRECTE";
    case "invoice_out_of_period":
      return "HORS_PERIODE";
    case "unknown_vendor":
      return "TIERS_INCONNU";
    case "amount_aberrant":
      return "MONTANT_ABERRANT";
    default:
      return "TVA_INCORRECTE";
  }
}

export const auditorAgent: AgentDefinition = {
  id: "auditor",
  label: "Auditor",
  responsibility: "Applique les règles fiscales marocaines TVA/IS et détecte les anomalies."
};

const ALLOWED_TVA_RATES = ["0", "7", "10", "14", "20"];
const TVA_TOLERANCE_MAD = "1.00";

export type VendorCategory =
  | "default"
  | "transport"
  | "hotels_restaurants"
  | "banking"
  | "water_electricity"
  | "medicine"
  | "exports"
  | "basic_food"
  | "energy"
  | "services"
  | "telecom";

export type VendorReference = {
  vendor: string;
  category: string;
  expectedTvaRate?: number;
  averageAmountTtc?: number;
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
  famille?: AnomalyFamily;
};

export type AuditOptions = {
  fiscalPeriod?: string;
  vendorReferential: VendorReference[];
  historicalInvoices?: AuditInvoice[];
  rejectedTypeCounts?: Record<string, number>;
};

// Known Moroccan default vendors to prevent false positives
const KNOWN_MOROCCAN_VENDORS: VendorReference[] = [
  { vendor: "MAROC TELECOM ENTREPRISE", category: "télécommunications", expectedTvaRate: 20, averageAmountTtc: 4920 },
  { vendor: "MAROC TELECOM", category: "télécommunications", expectedTvaRate: 20, averageAmountTtc: 4920 },
  { vendor: "IAM", category: "télécommunications", expectedTvaRate: 20, averageAmountTtc: 4920 },
  { vendor: "TOTALENERGIES MAROC", category: "énergie", expectedTvaRate: 14, averageAmountTtc: 5000 },
  { vendor: "TOTAL ENERGIES", category: "énergie", expectedTvaRate: 14, averageAmountTtc: 5000 },
  { vendor: "TOTAL", category: "énergie", expectedTvaRate: 14, averageAmountTtc: 5000 },
  { vendor: "LYDEC CASABLANCA", category: "eau_electricite", expectedTvaRate: 7, averageAmountTtc: 4000 },
  { vendor: "LYDEC", category: "eau_electricite", expectedTvaRate: 7, averageAmountTtc: 4000 },
  { vendor: "REDAL", category: "eau_electricite", expectedTvaRate: 7, averageAmountTtc: 4000 },
  { vendor: "AMENDIS", category: "eau_electricite", expectedTvaRate: 7, averageAmountTtc: 4000 },
  { vendor: "ONEE", category: "eau_electricite", expectedTvaRate: 7, averageAmountTtc: 4000 },
  { vendor: "ONCF", category: "transport", expectedTvaRate: 14, averageAmountTtc: 20000 },
  { vendor: "ROYAL AIR MAROC", category: "transport", expectedTvaRate: 14, averageAmountTtc: 25000 },
  { vendor: "ORANGE MAROC", category: "télécommunications", expectedTvaRate: 20, averageAmountTtc: 5000 },
  { vendor: "INWI", category: "télécommunications", expectedTvaRate: 20, averageAmountTtc: 5000 },
  { vendor: "AFRIQUIA", category: "énergie", expectedTvaRate: 14, averageAmountTtc: 6000 },
  { vendor: "SHELL MAROC", category: "énergie", expectedTvaRate: 14, averageAmountTtc: 6000 }
];

export function normalizeVendorName(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Supprime accents
    .replace(/[^a-z0-9]/g, " ") // Caractères spéciaux en espaces
    .replace(/\b(sarl|sa|sas|sasu|snc|ste|societe|entreprise|maroc|casablanca|rabat|tanger|agadir|distribution)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getExpectedRateForCategory(category: string, defaultRate = 20): string {
  const norm = category.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (norm.includes("transport")) return "14";
  if (norm.includes("energie") || norm.includes("carburant") || norm.includes("electricite")) return "14";
  if (norm.includes("restauration") || norm.includes("hotel") || norm.includes("banque")) return "10";
  if (norm.includes("denree") || norm.includes("eau") || norm.includes("scolaire") || norm.includes("alimentaire")) return "7";
  if (norm.includes("export")) return "0";
  return String(defaultRate || 20);
}

export function findMatchingVendor(
  invoiceVendor: string,
  referential: VendorReference[]
): VendorReference | undefined {
  if (!invoiceVendor) return undefined;
  const fullList = [...referential, ...KNOWN_MOROCCAN_VENDORS];
  const normInvoice = normalizeVendorName(invoiceVendor);
  const rawInvoice = invoiceVendor.trim().toLowerCase();

  // 1. Direct raw equality
  for (const ref of fullList) {
    if (ref.vendor.trim().toLowerCase() === rawInvoice) return ref;
  }

  if (!normInvoice || normInvoice.length < 2) return undefined;

  // 2. Normalized equality
  for (const ref of fullList) {
    const normRef = normalizeVendorName(ref.vendor);
    if (normRef === normInvoice) return ref;
  }

  // 3. Substring containment
  for (const ref of fullList) {
    const normRef = normalizeVendorName(ref.vendor);
    if (normRef.length >= 3 && normInvoice.length >= 3) {
      if (normRef.includes(normInvoice) || normInvoice.includes(normRef)) {
        return ref;
      }
    }
  }

  // 4. Token overlap (significant words >= 3 chars)
  const invoiceTokens = normInvoice.split(" ").filter((t) => t.length >= 3);
  for (const ref of fullList) {
    const refTokens = normalizeVendorName(ref.vendor).split(" ").filter((t) => t.length >= 3);
    for (const it of invoiceTokens) {
      if (refTokens.some((rt) => rt.includes(it) || it.includes(rt))) {
        return ref;
      }
    }
  }

  return undefined;
}

function money(value: string | number): string {
  return toDecimal(value).toFixed(2);
}

function severityForExposure(exposureMad: string): AuditAnomaly["severity"] {
  const exposure = toDecimal(exposureMad).abs();
  if (exposure.greaterThanOrEqualTo("10000")) return "high";
  if (exposure.greaterThanOrEqualTo("1000")) return "medium";
  return "low";
}

function lowerSeverity(severity: AuditAnomaly["severity"]): AuditAnomaly["severity"] {
  if (severity === "high") return "medium";
  return "low";
}

function applyFeedbackPriority(
  anomaly: AuditAnomaly,
  rejectedTypeCounts: Record<string, number> = {}
): AuditAnomaly {
  const rejectedCount = rejectedTypeCounts[anomaly.type] ?? 0;
  const famille = anomaly.famille ?? getAnomalyFamily(anomaly.type);
  if (rejectedCount < 2) return { ...anomaly, famille };
  return {
    ...anomaly,
    famille,
    severity: lowerSeverity(anomaly.severity),
    description: `${anomaly.description} (Priorité réduite par arbitrage précédent)`
  };
}

function daysBetween(a: string, b: string): number {
  const left = new Date(a).getTime();
  const right = new Date(b).getTime();
  if (Number.isNaN(left) || Number.isNaN(right)) return 999;
  return Math.abs(left - right) / (24 * 60 * 60 * 1000);
}

export function auditInvoices(invoices: AuditInvoice[], options: AuditOptions): AuditAnomaly[] {
  const anomalies: AuditAnomaly[] = [];
  const history = [...(options.historicalInvoices ?? []), ...invoices];

  for (const invoice of invoices) {
    const rate = toDecimal(invoice.tva_rate || "20");
    const actualTva = toDecimal(invoice.tva || "0");
    const amountHt = toDecimal(invoice.amount_ht || "0");
    const amountTtc = toDecimal(invoice.amount_ttc || "0");
    const expected = amountHt.mul(rate).div(100);

    const vendorMatch = findMatchingVendor(invoice.vendor, options.vendorReferential);

    // 1. Taux TVA non autorisé (légalement au Maroc: 0, 7, 10, 14, 20%)
    if (!ALLOWED_TVA_RATES.some((allowedRate) => rate.equals(allowedRate))) {
      anomalies.push(
        applyFeedbackPriority(
          {
            invoice_id: invoice.id,
            type: "tva_rate_invalid",
            description: `Taux TVA ${invoice.tva_rate}% non autorisé par le Code Général des Impôts (taux admis: 0%, 7%, 10%, 14%, 20%).`,
            exposure_mad: money(invoice.tva),
            severity: severityForExposure(invoice.tva)
          },
          options.rejectedTypeCounts
        )
      );
    }

    // 2. Erreur arithmétique de calcul TVA (HT * Taux != TVA)
    const tvaDelta = expected.minus(actualTva).abs();
    if (tvaDelta.greaterThan(TVA_TOLERANCE_MAD)) {
      anomalies.push(
        applyFeedbackPriority(
          {
            invoice_id: invoice.id,
            type: "tva_calculation_error",
            description: `Erreur calcul TVA: attendu ${expected.toFixed(2)} MAD (HT ${amountHt.toFixed(2)} * ${rate}%), facturé ${actualTva.toFixed(2)} MAD (écart ${tvaDelta.toFixed(2)} MAD).`,
            exposure_mad: tvaDelta.toFixed(2),
            severity: severityForExposure(tvaDelta.toFixed(2))
          },
          options.rejectedTypeCounts
        )
      );
    }

    // 3. Fournisseur inconnu du référentiel
    if (!vendorMatch) {
      // Risque fiscal de non-déductibilité (15% ou montant total)
      const exposure = amountTtc.mul(0.15).toFixed(2);
      anomalies.push(
        applyFeedbackPriority(
          {
            invoice_id: invoice.id,
            type: "unknown_vendor",
            description: `Fournisseur "${invoice.vendor}" absent du référentiel agréé. Risque de rejet de déductibilité.`,
            exposure_mad: exposure,
            severity: severityForExposure(exposure)
          },
          options.rejectedTypeCounts
        )
      );
    } else {
      // 4. Incohérence de taux de TVA par rapport à la catégorie fournisseur
      const expectedCategoryRate = vendorMatch.expectedTvaRate
        ? String(vendorMatch.expectedTvaRate)
        : getExpectedRateForCategory(vendorMatch.category);

      if (!rate.equals(expectedCategoryRate)) {
        const expectedTvaForCategory = amountHt.mul(expectedCategoryRate).div(100);
        const exposure = expectedTvaForCategory.minus(actualTva).abs().toFixed(2);

        anomalies.push(
          applyFeedbackPriority(
            {
              invoice_id: invoice.id,
              type: "tva_rate_mismatch",
              description: `Taux TVA ${invoice.tva_rate}% incohérent avec la catégorie "${vendorMatch.category}" (${expectedCategoryRate}% attendu).`,
              exposure_mad: exposure,
              severity: severityForExposure(exposure)
            },
            options.rejectedTypeCounts
          )
        );
      }
    }

    // 5. Facture hors période fiscale (Exercice 1er janv au 30 juin 2026)
    if (invoice.date) {
      const isOutOfPeriod = invoice.date < "2026-01-01" || invoice.date > "2026-06-30";
      if (isOutOfPeriod) {
        anomalies.push(
          applyFeedbackPriority(
            {
              invoice_id: invoice.id,
              type: "invoice_out_of_period",
              description: `Facture datée du ${invoice.date}, hors période fiscale de l'exercice (01/01/2026 au 30/06/2026).`,
              exposure_mad: money(invoice.amount_ttc),
              severity: "medium"
            },
            options.rejectedTypeCounts
          )
        );
      }
    }

    // 6. Montant aberrant (> 5x la moyenne historique fournisseur per regles-fiscales.md)
    const avgRef = vendorMatch?.averageAmountTtc;
    if (avgRef && avgRef > 0 && amountTtc.greaterThan(toDecimal(avgRef).mul(5))) {
      const exposure = amountTtc.minus(avgRef).toFixed(2);
      anomalies.push(
        applyFeedbackPriority(
          {
            invoice_id: invoice.id,
            type: "amount_aberrant",
            description: `Montant ${amountTtc.toFixed(2)} MAD supérieur à la normale historique du fournisseur (${avgRef.toFixed(2)} MAD).`,
            exposure_mad: exposure,
            severity: severityForExposure(exposure),
            famille: "MONTANT_ABERRANT"
          },
          options.rejectedTypeCounts
        )
      );
    }

    // 7. Doublon probable (même fournisseur, même montant TTC, espacés de <= 7 jours)
    const duplicate = history.find(
      (candidate) =>
        candidate.id !== invoice.id &&
        candidate.id < invoice.id && // Ne signale que la deuxième pièce (le doublon réel), pas les deux
        normalizeVendorName(candidate.vendor) === normalizeVendorName(invoice.vendor) &&
        toDecimal(candidate.amount_ttc).equals(amountTtc) &&
        daysBetween(candidate.date, invoice.date) <= 7
    );

    if (duplicate) {
      anomalies.push(
        applyFeedbackPriority(
          {
            invoice_id: invoice.id,
            type: "duplicate_probable",
            description: `Doublon probable avec la facture ${duplicate.invoice_number ?? duplicate.id} du ${duplicate.date} (${amountTtc.toFixed(2)} MAD).`,
            exposure_mad: money(invoice.amount_ttc),
            severity: severityForExposure(invoice.amount_ttc)
          },
          options.rejectedTypeCounts
        )
      );
    }
  }

  return anomalies;
}

