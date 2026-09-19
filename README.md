# Chiffra

Agent comptable marocain multi-agents pour ingestion de documents, audit TVA, rapprochement bancaire et explication des anomalies.

## 1. Problem

Les comptables marocains traitent des factures, releves et justificatifs heterogenes sous forte contrainte de temps.
Les erreurs de TVA, doublons, fournisseurs inconnus et paiements non rapproches creent un risque financier direct.
Chiffra automatise le tri, detecte les anomalies deterministes et explique les actions a prendre sans laisser le LLM calculer.

## 2. Architecture

```text
                 ┌──────────────────────┐
                 │ React Frontend :3000 │
                 │ upload / dashboard   │
                 └──────────┬───────────┘
                            │ REST + SSE
                            ▼
┌──────────────────────────────────────────────────────────┐
│ Fastify API :4000                                       │
│ /api/upload /api/progress /api/anomalies /api/stats     │
│ /api/export/tva /api/ask                                │
└──────────┬───────────────────────────────┬───────────────┘
           │                               │
           ▼                               ▼
┌──────────────────────┐          ┌──────────────────────┐
│ Redis 7 + BullMQ     │          │ PostgreSQL 16        │
│ ingestion queue      │          │ numeric + pgvector   │
└──────────┬───────────┘          └──────────▲───────────┘
           │                                 │
           ▼                                 │
┌──────────────────────────────────────────────────────────┐
│ Worker BullMQ, concurrency 5                            │
│                                                          │
│ Ingestor ──► Auditor ──► Reconciler ──► Explainer       │
│ PDF/OCR/XLSX   TVA rules   bank match     FR actions    │
│ GPT-4.1 JSON   decimal.js  decimal.js     GPT-5.5/4.1   │
└──────────────────────────────────────────────────────────┘
```

## 3. Quick Start

```bash
git clone https://github.com/anasisto009/chiffra.git
cd chiffra
cp .env.example .env
docker compose up --build
```

Open:

```text
Frontend: http://localhost:3000
API health: http://localhost:4000/health
```

Stop:

```bash
docker compose down
```

Reset database volumes:

```bash
docker compose down -v
```

## 4. Agent Responsibilities

| Agent | Role | LLM usage | Calculations |
| --- | --- | --- | --- |
| Ingestor | Normalise PDF, image OCR and Excel into invoice JSON | GPT-4.1 extracts JSON only | Validates HT + TVA = TTC with `decimal.js` |
| Auditor | Applies Moroccan TVA rules and anomaly checks | No LLM | All exposure and TVA deltas in `decimal.js` |
| Reconciler | Matches invoices to bank lines, grouped and partial | No LLM | All sums, residuals and match rates in `decimal.js` |
| Explainer | Explains anomalies in French with concrete actions | GPT-5.5 for complex, GPT-4.1 for simple | Never recalculates exposure |

Rule: the LLM orchestrates and explains. It never calculates totals, TVA, residuals or exposure.

## 5. Fiscal Rules Implemented

TVA rates:

| Rate | Category |
| --- | --- |
| 20% | Default goods and services |
| 14% | Transport, hot water, residential electricity |
| 10% | Hotels, restaurants, banking |
| 7% | Drinking water, electricity under 500kWh, essential medicine |
| 0% | Exports, basic food |

Implemented checks:

- Invalid TVA rate outside `0, 7, 10, 14, 20`.
- TVA amount mismatch with tolerance `1 MAD`.
- TVA rate mismatch by vendor category.
- Invoice outside fiscal period.
- Unknown vendor.
- Amount above `3x` vendor average.
- Probable duplicate: same vendor, same amount, date within 3 days.

IS is prepared as audit scope in the architecture, while the current deterministic implementation focuses on TVA and invoice/bank anomalies for the demo dataset.

## 6. Example Anomalies Detected

- `tva_rate_invalid`: invoice uses 18% TVA.
- `tva_calculation_error`: HT x rate does not equal TVA.
- `tva_rate_mismatch`: restaurant invoice with 20% instead of 10%.
- `invoice_out_of_period`: invoice period differs from selected fiscal period.
- `unknown_vendor`: supplier missing from referential.
- `amount_aberrant`: invoice exceeds 3x vendor average.
- `duplicate_probable`: same vendor and amount within 3 days.
- Unmatched invoices after bank reconciliation.
- Partial payment with residual MAD amount.
- Non-readable file marked `non_traite` with reason.

## 7. Manual Test Scenarios

Create or use a `data/test/` folder:

```text
data/test/
  facture-normale.pdf
  facture-tva-invalide.pdf
  facture-doublon-1.pdf
  facture-doublon-2.pdf
  photo-floue.jpg
  releve-bancaire.csv
  export.xlsx
```

Try:

1. Upload a clean PDF invoice and verify status moves `queued -> processing -> done`.
2. Upload a blank or corrupted PDF and verify `non_traite` with a reason.
3. Upload a blurry image and verify `image_quality_low`.
4. Upload an Excel export and verify invoice extraction.
5. Open Anomalies and confirm highest MAD exposure appears first.
6. Validate an anomaly and verify status becomes `validated`.
7. Reject an anomaly and verify review note is stored.
8. Download TVA CSV from the dashboard.
9. Ask a natural-language question in the semantic search box.
10. Stop and restart with Docker Compose; PostgreSQL data persists.

## Useful Commands

```bash
npm install
npm run typecheck
npm run build
docker compose config --quiet
docker compose up --build
```

## Environment

`.env.example` documents every required variable:

- `DATABASE_URL`
- `REDIS_URL`
- `LLM_URL`, `LLM_API_KEY`, `LLM_MODEL`
- `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT_NAME`
- `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`

Never commit `.env`.

