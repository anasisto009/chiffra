import pg from "pg";
import { toDecimal } from "@chiffra/shared";
import { pool } from "../db/client.js";
import {
  findMatchingVendor,
  normalizeVendorName,
  type AuditAnomaly,
  type VendorReference
} from "../agents/auditor.js";

export class AuditorService {
  constructor(private pgPool: pg.Pool = pool) {}

  public async checkTiersInconnu(doc: {
    id: string;
    vendor?: string;
    fournisseur_nom?: string;
    amount_ttc?: string | number;
    montant_ttc?: string | number;
  }): Promise<AuditAnomaly | null> {
    const vendorName = doc.vendor || doc.fournisseur_nom;
    if (!vendorName) return null;

    const normalizedNom = normalizeVendorName(vendorName);

    // 1. Recherche insensible à la casse et aux accents dans la base
    const fournisseur = await this.pgPool.query(
      `SELECT * FROM fournisseurs 
       WHERE nom ILIKE $1 
       OR nom ILIKE $2
       OR $3 ILIKE '%' || nom || '%'`,
      [`%${vendorName}%`, vendorName, vendorName]
    );

    // 2. Recherche avec normalisation et liste des tiers marocains légitimes
    if (fournisseur.rows.length === 0) {
      const match = findMatchingVendor(vendorName, []);
      if (match) {
        return null; // Reconnu légitime (ex: TotalEnergies, Maroc Telecom, Lydec)
      }

      const rawAmount = doc.amount_ttc ?? doc.montant_ttc ?? 0;
      const exposure = toDecimal(rawAmount).mul(0.15).toFixed(2);

      return {
        invoice_id: doc.id,
        type: "unknown_vendor",
        description: `Fournisseur "${vendorName}" absent du référentiel. Risque de rejet de déductibilité.`,
        exposure_mad: exposure,
        severity: "medium"
      };
    }

    return null;
  }

  public async detectAllAnomalies(): Promise<AuditAnomaly[]> {
    const invoicesResult = await this.pgPool.query(
      `SELECT id, vendor, date::text, amount_ht::text, tva::text, tva_rate::text, amount_ttc::text, invoice_number, period
       FROM invoices
       ORDER BY date ASC`
    );

    const vendorsResult = await this.pgPool.query(
      `SELECT nom, categorie, taux_tva_habituel::text, montant_moyen_ttc_mad::text
       FROM fournisseurs`
    );

    const vendors: VendorReference[] = vendorsResult.rows.map((v) => ({
      vendor: v.nom,
      category: v.categorie,
      expectedTvaRate: Number.parseFloat(v.taux_tva_habituel || "20"),
      averageAmountTtc: Number.parseFloat(v.montant_moyen_ttc_mad || "0")
    }));

    const anomalies: AuditAnomaly[] = [];

    for (const doc of invoicesResult.rows) {
      const tiersAnomaly = await this.checkTiersInconnu({
        id: doc.id,
        vendor: doc.vendor,
        amount_ttc: doc.amount_ttc
      });

      if (tiersAnomaly) {
        anomalies.push(tiersAnomaly);
      }
    }

    return anomalies;
  }
}

export const auditorService = new AuditorService();
