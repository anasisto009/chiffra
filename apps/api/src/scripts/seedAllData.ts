import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { toDecimal } from "@chiffra/shared";
import { env } from "../config.js";
import { ingestDocument } from "../agents/ingestor.js";
import { auditInvoices, type AuditInvoice, type VendorReference } from "../agents/auditor.js";
import { reconcileBankLines, type ReconciliationBankLine, type ReconciliationInvoice } from "../agents/reconciler.js";

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const pool = new Pool({
  connectionString: env.databaseUrl
});

function getMimeType(ext: string): string {
  const e = ext.toLowerCase();
  if (e === ".pdf") return "application/pdf";
  if (e === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (e === ".xls") return "application/vnd.ms-excel";
  if (e === ".csv") return "text/csv";
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".tiff" || e === ".tif") return "image/tiff";
  return "application/octet-stream";
}

async function loadReferentielFournisseurs(pgPool: pg.Pool, dataDir: string): Promise<VendorReference[]> {
  console.log("📋 1. Chargement du référentiel fournisseurs...");

  const csvPath = join(dataDir, "referentiel-fournisseurs.csv");
  if (!existsSync(csvPath)) {
    console.warn(`⚠️  Fichier ${csvPath} non trouvé`);
    return [];
  }

  const content = readFileSync(csvPath, "utf-8");
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  if (lines.length < 2) {
    console.warn("⚠️  Fichier referentiel-fournisseurs.csv vide");
    return [];
  }

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idxNom = headers.findIndex((h) => h.includes("nom") || h.includes("fournisseur"));
  const idxIce = headers.findIndex((h) => h.includes("ice"));
  const idxCategorie = headers.findIndex((h) => h.includes("catégorie") || h.includes("categorie"));
  const idxTauxTva = headers.findIndex((h) => h.includes("taux") || h.includes("tva"));
  const idxCompte = headers.findIndex((h) => h.includes("compte"));
  const idxRecurrent = headers.findIndex((h) => h.includes("recurrent"));
  const idxMoyenne = headers.findIndex((h) => h.includes("moyenne") || h.includes("montant_moyen"));

  const vendors: VendorReference[] = [];
  let count = 0;

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    if (values.length < 2) continue;

    const nom = (idxNom >= 0 ? values[idxNom] : values[0]) || "";
    const ice = idxIce >= 0 ? values[idxIce] : null;
    const categorie = (idxCategorie >= 0 ? values[idxCategorie] : "general") || "general";
    const tauxTva = idxTauxTva >= 0 && values[idxTauxTva] ? Number.parseFloat(values[idxTauxTva]) : 20.0;
    const compte = idxCompte >= 0 ? values[idxCompte] : null;
    const recurrent = idxRecurrent >= 0 ? values[idxRecurrent].toLowerCase() === "oui" : false;
    const moyenne = idxMoyenne >= 0 && values[idxMoyenne] ? Number.parseFloat(values[idxMoyenne]) : 0;

    if (!nom) continue;

    try {
      await pgPool.query(
        `INSERT INTO fournisseurs (nom, ice, categorie, taux_tva_habituel, compte_comptable, recurrent, montant_moyen_ttc_mad)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (nom) DO UPDATE SET
           ice = EXCLUDED.ice,
           categorie = EXCLUDED.categorie,
           taux_tva_habituel = EXCLUDED.taux_tva_habituel,
           compte_comptable = EXCLUDED.compte_comptable,
           recurrent = EXCLUDED.recurrent,
           montant_moyen_ttc_mad = EXCLUDED.montant_moyen_ttc_mad`,
        [nom, ice, categorie, tauxTva, compte, recurrent, moyenne]
      );
      count++;
      vendors.push({
        vendor: nom,
        category: categorie,
        expectedTvaRate: tauxTva,
        averageAmountTtc: moyenne
      });
    } catch (err) {
      console.error(`Erreur insertion fournisseur ${nom}:`, err);
    }
  }

  // Also seed known Moroccan default suppliers
  const defaultSuppliers = [
    { nom: "MAROC TELECOM ENTREPRISE", ice: "009012345000052", categorie: "télécommunications", taux: 20, compte: "6145", moy: 4920 },
    { nom: "TOTALENERGIES MAROC", ice: "001889922000014", categorie: "énergie", taux: 14, compte: "6135", moy: 5000 },
    { nom: "LYDEC CASABLANCA", ice: "001778833000089", categorie: "eau_electricite", taux: 7, compte: "6125", moy: 4000 },
    { nom: "ONCF", ice: "001445566000031", categorie: "transport", taux: 14, compte: "6142", moy: 20000 }
  ];

  for (const sup of defaultSuppliers) {
    await pgPool.query(
      `INSERT INTO fournisseurs (nom, ice, categorie, taux_tva_habituel, compte_comptable, montant_moyen_ttc_mad)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (nom) DO UPDATE SET
         categorie = EXCLUDED.categorie,
         taux_tva_habituel = EXCLUDED.taux_tva_habituel`,
      [sup.nom, sup.ice, sup.categorie, sup.taux, sup.compte, sup.moy]
    );
  }

  console.log(`✅ ${count + defaultSuppliers.length} fournisseurs configurés en base de données.`);
  return vendors;
}

export async function seedAllData() {
  console.log("🚀 ========================================================");
  console.log("🚀 CHIFFRA - INGESTION COMPLÈTE DU JEU DE DONNÉES SUJET-03");
  console.log("🚀 ========================================================\n");

  const candidates = [
    resolve(__dirname, "../../../sujet-03-chiffra"),
    resolve(__dirname, "../../sujet-03-chiffra"),
    resolve(process.cwd(), "sujet-03-chiffra"),
    resolve(process.cwd(), "../sujet-03-chiffra"),
    resolve(process.cwd(), "../../sujet-03-chiffra"),
    "/app/sujet-03-chiffra",
    "C:\\Users\\MY PC\\Desktop\\sujet-03-chiffra",
    "C:\\Users\\MY PC\\Desktop\\chiffra\\sujet-03-chiffra"
  ];

  let dataDir = candidates.find((dir) => existsSync(dir));
  if (!dataDir) {
    console.error("❌ Dossier de données sujet-03-chiffra introuvable!");
    console.error("Chemins cherchés:", candidates);
    process.exit(1);
  }
  console.log(`📁 Dossier source détecté: ${dataDir}\n`);

  // 1. Initialiser le schéma et nettoyer les anciennes données
  console.log("🧹 Nettoyage des anciennes données pour un état propre...");
  await pool.query("TRUNCATE human_reviews, anomalies, bank_lines, invoices, documents, fournisseurs CASCADE;");

  // 2. Charger le référentiel fournisseurs
  const vendorReferential = await loadReferentielFournisseurs(pool, dataDir);

  // 3. Ingestion des 6 relevés bancaires
  console.log("\n🏦 2. Ingestion des relevés bancaires...");
  const relevesDir = join(dataDir, "releves");
  let bankLinesCount = 0;

  if (existsSync(relevesDir)) {
    const relevesFiles = readdirSync(relevesDir).filter((f) => f.endsWith(".csv"));
    console.log(`   ${relevesFiles.length} fichiers de relevés trouvés.`);

    for (const filename of relevesFiles) {
      const filePath = join(relevesDir, filename);
      const buffer = readFileSync(filePath);

      const docRes = await pool.query(
        `INSERT INTO documents (filename, type, status, created_at)
         VALUES ($1, 'text/csv', 'processing', NOW())
         RETURNING id`,
        [filename]
      );
      const docId = docRes.rows[0].id;

      const ingestRes = await ingestDocument(buffer, filename, "text/csv");
      if (ingestRes.status === "bank_lines") {
        await pool.query(
          `UPDATE documents SET status = 'done', raw_text = $2, ocr_cache = $3::jsonb WHERE id = $1`,
          [docId, ingestRes.rawText, JSON.stringify(ingestRes)]
        );

        for (const line of ingestRes.lines) {
          await pool.query(
            `INSERT INTO bank_lines (document_id, date, description, amount)
             VALUES ($1, $2, $3, $4)`,
            [docId, line.date, line.description, toDecimal(line.amount).toFixed(2)]
          );
          bankLinesCount++;
        }
      }
    }
    console.log(`✅ ${relevesFiles.length} relevés ingérés (${bankLinesCount} lignes bancaires enregistrées).`);
  }

  // 4. Ingestion des factures
  console.log("\n📄 3. Ingestion des pièces comptables et factures...");
  const facturesDir = join(dataDir, "factures");
  let processedInvoices = 0;
  let rejectedDocs = 0;

  if (existsSync(facturesDir)) {
    const facturesFiles = readdirSync(facturesDir).filter((f) => !f.startsWith("."));
    console.log(`   ${facturesFiles.length} pièces trouvées dans ${facturesDir}`);

    for (let i = 0; i < facturesFiles.length; i++) {
      const filename = facturesFiles[i];
      const filePath = join(facturesDir, filename);
      const ext = extname(filename).toLowerCase();
      const mimeType = getMimeType(ext);
      const buffer = readFileSync(filePath);

      const docRes = await pool.query(
        `INSERT INTO documents (filename, type, status, created_at)
         VALUES ($1, $2, 'processing', NOW())
         RETURNING id`,
        [filename, mimeType]
      );
      const docId = docRes.rows[0].id;

      try {
        const result = await ingestDocument(buffer, filename, mimeType);

        if (result.status === "non_traite") {
          await pool.query(
            `UPDATE documents
             SET status = 'non_traite',
                 raw_text = $2,
                 ocr_cache = $3::jsonb
             WHERE id = $1`,
            [
              docId,
              result.rawText || null,
              JSON.stringify({ reason: result.reason, message: result.message || null })
            ]
          );
          rejectedDocs++;
        } else if (result.status === "done") {
          const invoicesToInsert = result.invoices && result.invoices.length > 0 ? result.invoices : [result.invoice];

          await pool.query(
            `UPDATE documents SET status = 'done', raw_text = $2, ocr_cache = $3::jsonb WHERE id = $1`,
            [docId, result.rawText, JSON.stringify(result)]
          );

          for (const inv of invoicesToInsert) {
            await pool.query(
              `INSERT INTO invoices (document_id, vendor, date, amount_ht, tva, tva_rate, amount_ttc, invoice_number, period)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                docId,
                inv.vendor,
                inv.date,
                toDecimal(inv.amount_ht).toFixed(2),
                toDecimal(inv.tva).toFixed(2),
                toDecimal(inv.tva_rate).toFixed(2),
                toDecimal(inv.amount_ttc).toFixed(2),
                inv.invoice_number || null,
                inv.date.slice(0, 7)
              ]
            );
            processedInvoices++;
          }
        }
      } catch (err) {
        await pool.query(
          `UPDATE documents SET status = 'non_traite', ocr_cache = $2::jsonb WHERE id = $1`,
          [docId, JSON.stringify({ reason: "ingestion_error", message: String(err) })]
        );
        rejectedDocs++;
      }

      if ((i + 1) % 20 === 0 || i + 1 === facturesFiles.length) {
        console.log(`   Progression: ${i + 1}/${facturesFiles.length} pièces analysées.`);
      }
    }
  }

  // 5. Exécution de l'Audit Fiscal
  console.log("\n🔍 4. Exécution de l'Audit Fiscal et Détection des Anomalies...");
  const invoicesRes = await pool.query<AuditInvoice & { id: string }>(
    `SELECT id, vendor, date::text, amount_ht::text, tva::text, tva_rate::text, amount_ttc::text, invoice_number, period
     FROM invoices
     ORDER BY date ASC`
  );
  const allInvoices = invoicesRes.rows;

  const anomalies = auditInvoices(allInvoices, {
    fiscalPeriod: "2026-H1",
    vendorReferential,
    historicalInvoices: allInvoices
  });

  for (const anomaly of anomalies) {
    await pool.query(
      `INSERT INTO anomalies (invoice_id, type, description, exposure_mad, severity, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       ON CONFLICT (invoice_id, type) DO UPDATE SET
         description = EXCLUDED.description,
         exposure_mad = EXCLUDED.exposure_mad,
         severity = EXCLUDED.severity`,
      [
        anomaly.invoice_id,
        anomaly.type,
        anomaly.description,
        anomaly.exposure_mad,
        anomaly.severity
      ]
    );
  }
  console.log(`✅ ${anomalies.length} anomalies détectées et enregistrées sans doublon.`);

  // 6. Exécution du Rapprochement Bancaire
  console.log("\n🔄 5. Exécution du Rapprochement Bancaire (1-1 & Groupé 1-N)...");
  const bankLinesRes = await pool.query<{ id: string; date: string; description: string; amount: string }>(
    `SELECT id, date::text, description, amount::text
     FROM bank_lines
     ORDER BY date ASC`
  );
  const allBankLines = bankLinesRes.rows;

  const reconInvoices: ReconciliationInvoice[] = allInvoices.map((inv) => ({
    id: inv.id,
    vendor: inv.vendor,
    date: inv.date,
    amount_ttc: inv.amount_ttc,
    invoice_number: inv.invoice_number
  }));

  const reconBankLines: ReconciliationBankLine[] = allBankLines.map((bl) => ({
    id: bl.id,
    date: bl.date,
    description: bl.description,
    amount: bl.amount
  }));

  const reconResult = reconcileBankLines(reconInvoices, reconBankLines);

  await pool.query("UPDATE bank_lines SET matched_invoice_id = NULL");
  for (const match of reconResult.matched) {
    if (match.type === "exact") {
      await pool.query("UPDATE bank_lines SET matched_invoice_id = $1 WHERE id = $2", [
        match.invoice_id,
        match.bank_line_id
      ]);
    } else if (match.type === "grouped") {
      for (const invId of match.invoice_ids) {
        await pool.query("UPDATE bank_lines SET matched_invoice_id = $1 WHERE id = $2", [
          invId,
          match.bank_line_id
        ]);
      }
    }
  }

  // 7. Rapport de synthèse
  console.log("\n" + "=".repeat(65));
  console.log("📊 RAPPORT D'INGESTION ET AUDIT FINAL CHIFFRA");
  console.log("=".repeat(65));

  const finalStats = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM documents) as total_docs,
      (SELECT COUNT(*) FROM documents WHERE status = 'done') as docs_done,
      (SELECT COUNT(*) FROM documents WHERE status = 'non_traite') as docs_non_traite,
      (SELECT COUNT(*) FROM invoices) as total_invoices,
      (SELECT COUNT(*) FROM bank_lines) as total_bank_lines,
      (SELECT COUNT(DISTINCT matched_invoice_id) FROM bank_lines WHERE matched_invoice_id IS NOT NULL) as matched_invoices,
      (SELECT COUNT(*) FROM anomalies) as total_anomalies,
      (SELECT COALESCE(SUM(exposure_mad), 0) FROM anomalies) as total_exposure_mad
  `);

  const s = finalStats.rows[0];
  const rate = Number(s.total_invoices) > 0
    ? ((Number(s.matched_invoices) / Number(s.total_invoices)) * 100).toFixed(2)
    : "0.00";

  console.log(`Documents ingérés       : ${s.total_docs} (${s.docs_done} traités, ${s.docs_non_traite} en file humaine)`);
  console.log(`Factures extraites      : ${s.total_invoices}`);
  console.log(`Lignes bancaires        : ${s.total_bank_lines}`);
  console.log(`Factures rapprochées    : ${s.matched_invoices} / ${s.total_invoices} (${rate}%)`);
  console.log(`Anomalies détectées     : ${s.total_anomalies}`);
  console.log(`Exposition financière   : ${Number(s.total_exposure_mad).toLocaleString("fr-MA")} MAD`);
  console.log("=".repeat(65));
  console.log("\n✨ Base de données complètement chargée et prête pour la démonstration !");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedAllData()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("❌ Échec critique du seed:", err);
      await pool.end();
      process.exit(1);
    });
}
