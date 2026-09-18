export type UploadStatus = "queued" | "processing" | "done" | "non_traite";

export type MockDocument = {
  id: string;
  filename: string;
  kind: "PDF" | "Photo" | "Excel";
  size: string;
  progress: number;
  status: UploadStatus;
  reason?: string;
};

export type AnomalyFamily =
  | "Doublon"
  | "TVA erronée"
  | "Hors période"
  | "Tiers inconnu"
  | "Montant aberrant";

export type MockAnomaly = {
  id: string;
  date: string;
  vendor: string;
  type: AnomalyFamily;
  exposureMad: number;
  confidence: number;
  invoiceNumber: string;
  description: string;
  source: string;
  sourceKind: "pdf" | "image";
  status: "pending" | "validated" | "rejected";
};

export const mockDocuments: MockDocument[] = [
  {
    id: "doc-001",
    filename: "facture-atlas-042.pdf",
    kind: "PDF",
    size: "842 KB",
    progress: 100,
    status: "done"
  },
  {
    id: "doc-002",
    filename: "photo-facture-froissee.jpg",
    kind: "Photo",
    size: "3.2 MB",
    progress: 100,
    status: "non_traite",
    reason: "Erreur OCR : image inexploitable"
  },
  {
    id: "doc-003",
    filename: "releve-banque-fevrier.xlsx",
    kind: "Excel",
    size: "126 KB",
    progress: 72,
    status: "processing"
  },
  {
    id: "doc-004",
    filename: "factures-fournisseurs-lot-02.pdf",
    kind: "PDF",
    size: "1.8 MB",
    progress: 0,
    status: "queued"
  },
  {
    id: "doc-005",
    filename: "acompte-chantier-vision.png",
    kind: "Photo",
    size: "2.1 MB",
    progress: 100,
    status: "done"
  }
];

export const mockAnomalies: MockAnomaly[] = [
  {
    id: "anom-001",
    date: "2026-02-14",
    vendor: "Atlas Distribution",
    type: "Doublon",
    exposureMad: 18400,
    confidence: 0.98,
    invoiceNumber: "FAC-2026-042",
    description: "Même tiers, même montant et date décalée de 3 jours.",
    source: "facture-atlas-042.pdf",
    sourceKind: "pdf",
    status: "pending"
  },
  {
    id: "anom-002",
    date: "2026-02-09",
    vendor: "Pharmacie Al Amal",
    type: "TVA erronée",
    exposureMad: 12600,
    confidence: 0.94,
    invoiceNumber: "PA-8891",
    description: "TVA à 7% détectée sur une catégorie normalement taxée à 20%.",
    source: "facture-pharmacie-al-amal.pdf",
    sourceKind: "pdf",
    status: "pending"
  },
  {
    id: "anom-003",
    date: "2026-01-31",
    vendor: "Transport El Mansour",
    type: "Hors période",
    exposureMad: 9300,
    confidence: 0.91,
    invoiceNumber: "TEM-0118",
    description: "Date de facture antérieure à la période comptable sélectionnée.",
    source: "facture-transport-el-mansour.pdf",
    sourceKind: "pdf",
    status: "pending"
  },
  {
    id: "anom-004",
    date: "2026-02-18",
    vendor: "Fournisseur non référencé",
    type: "Tiers inconnu",
    exposureMad: 7200,
    confidence: 0.87,
    invoiceNumber: "INV-551",
    description: "Le tiers n'existe pas dans le référentiel fournisseurs chargé.",
    source: "photo-fournisseur-inconnu.jpg",
    sourceKind: "image",
    status: "pending"
  },
  {
    id: "anom-005",
    date: "2026-02-12",
    vendor: "Bati Services",
    type: "Montant aberrant",
    exposureMad: 5600,
    confidence: 0.83,
    invoiceNumber: "BS-2044",
    description: "Montant supérieur à trois fois la moyenne historique du tiers.",
    source: "facture-bati-services.pdf",
    sourceKind: "pdf",
    status: "pending"
  },
  {
    id: "anom-006",
    date: "2026-02-05",
    vendor: "Vision Informatique",
    type: "Doublon",
    exposureMad: 2400,
    confidence: 0.79,
    invoiceNumber: "VI-2026-19",
    description: "Doublon probable, à confirmer car les numéros de facture diffèrent.",
    source: "acompte-chantier-vision.png",
    sourceKind: "image",
    status: "pending"
  }
];

export const mockMetrics = {
  totalDocuments: 42,
  matchedDocuments: 36,
  humanQueue: 5,
  totalExposureMad: 55500,
  anomalyFamilies: [
    { label: "Doublon", count: 18 },
    { label: "TVA erronée", count: 11 },
    { label: "Hors période", count: 7 },
    { label: "Tiers inconnu", count: 4 },
    { label: "Montant aberrant", count: 2 }
  ]
};
