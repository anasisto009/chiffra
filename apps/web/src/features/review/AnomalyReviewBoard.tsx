import { ArrowDownWideNarrow, Eye } from "lucide-react";
import { useMemo, useState } from "react";
import { apiPost } from "../../api";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { formatMad } from "../../lib/formatters";
import { DocumentDrillDown } from "./DocumentDrillDown";
import { useMockAnomalies } from "../mvp/useMvpData";
import type { MockAnomaly } from "../mvp/mockData";

function confidenceVariant(confidence: number | null) {
  if (confidence === null) return "secondary" as const;
  if (confidence >= 0.9) return "danger" as const;
  if (confidence >= 0.8) return "warning" as const;
  return "secondary" as const;
}

export function AnomalyReviewBoard() {
  const { data: sourceAnomalies = [] } = useMockAnomalies();
  const [anomalies, setAnomalies] = useState<MockAnomaly[]>([]);
  const [selected, setSelected] = useState<MockAnomaly | null>(null);

  const rows = useMemo(() => {
    const mapped = sourceAnomalies.map((anomaly) => ({
      id: anomaly.id,
      documentId: anomaly.document_id,
      date: anomaly.date ?? "-",
      vendor: anomaly.vendor ?? "Tiers inconnu",
      type: anomaly.type as MockAnomaly["type"],
      exposureMad: Number(anomaly.exposure_mad),
      confidence: null,
      invoiceNumber: anomaly.invoice_number ?? "-",
      description: anomaly.description,
      source: anomaly.filename ?? "Document source indisponible",
      sourceKind: "pdf" as const,
      status: anomaly.status
    } satisfies MockAnomaly));
    const current = anomalies.length > 0 ? anomalies : mapped;
    return [...current].sort((left, right) => right.exposureMad - left.exposureMad);
  }, [anomalies, sourceAnomalies]);

  async function decide(id: string, status: "validated" | "rejected", note = "") {
    await apiPost(`/api/anomalies/${id}/review`, { decision: status, note });
    setAnomalies((current) => {
      const base = current.length > 0 ? current : rows;
      return base.map((anomaly) => anomaly.id === id ? { ...anomaly, status } : anomaly);
    });
  }

  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-semibold uppercase tracking-wide text-slate-500">EX-05 · EX-06</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Revue humaine</h1><p className="mt-2 max-w-2xl text-slate-600">Les anomalies sont triées par exposition financière décroissante. Chaque décision reste traçable.</p></div><Badge variant="warning">{rows.filter((anomaly) => anomaly.status === "pending").length} à traiter</Badge></header>
      <Card>
        <CardHeader><div className="flex items-center justify-between gap-4"><CardTitle>Anomalies détectées</CardTitle><span className="inline-flex items-center gap-2 text-sm text-slate-500"><ArrowDownWideNarrow className="h-4 w-4" />Exposition décroissante</span></div></CardHeader>
        <CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Tiers</TableHead><TableHead>Type d'anomalie</TableHead><TableHead>Exposition</TableHead><TableHead>Confiance IA</TableHead><TableHead>État</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{rows.map((anomaly) => <TableRow key={anomaly.id}><TableCell className="whitespace-nowrap">{anomaly.date}</TableCell><TableCell className="font-medium text-slate-900">{anomaly.vendor}</TableCell><TableCell><Badge variant={anomaly.type === "TVA erronée" ? "danger" : "secondary"}>{anomaly.type}</Badge></TableCell><TableCell className="whitespace-nowrap font-semibold text-slate-900">{formatMad(anomaly.exposureMad)}</TableCell><TableCell><Badge variant={confidenceVariant(anomaly.confidence)}>{anomaly.confidence === null ? "Non fournie" : `${Math.round(anomaly.confidence * 100)}%`}</Badge></TableCell><TableCell>{anomaly.status === "pending" ? <Badge variant="warning">À traiter</Badge> : anomaly.status === "validated" ? <Badge variant="success">Validée</Badge> : <Badge variant="secondary">Rejetée</Badge>}</TableCell><TableCell><Button variant="outline" className="whitespace-nowrap" onClick={() => setSelected(anomaly)}><Eye className="h-4 w-4" />Voir la source</Button></TableCell></TableRow>)}</TableBody></Table></div></CardContent>
      </Card>
      <DocumentDrillDown anomaly={selected} onClose={() => setSelected(null)} onDecision={(status, note) => { if (selected) void decide(selected.id, status, note); }} />
    </section>
  );
}
