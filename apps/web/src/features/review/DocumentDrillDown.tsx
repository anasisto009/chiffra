import { Check, FileText, Image, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import type { MockAnomaly } from "../mvp/mockData";
import { formatMad } from "../../lib/formatters";

type DocumentDrillDownProps = {
  anomaly: MockAnomaly | null;
  onClose: () => void;
  onDecision: (status: "validated" | "rejected", reason?: string) => void;
};

export function DocumentDrillDown({ anomaly, onClose, onDecision }: DocumentDrillDownProps) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  function close() {
    setRejecting(false);
    setReason("");
    onClose();
  }

  function reject() {
    if (!reason.trim()) return;
    onDecision("rejected", reason.trim());
    close();
  }

  return (
    <Dialog open={Boolean(anomaly)} onOpenChange={(open) => !open && close()}>
      <DialogContent className="grid gap-0 p-0 lg:grid-cols-[1.05fr_0.95fr]">
        {anomaly ? <>
          <div className="min-h-[28rem] bg-slate-900 p-6 text-white">
            <div className="flex items-center justify-between"><p className="text-sm font-semibold uppercase tracking-wide text-slate-300">Document source</p><Badge variant="secondary">{anomaly.sourceKind.toUpperCase()}</Badge></div>
            <div className="mt-6 flex min-h-[21rem] items-center justify-center rounded-md border border-slate-700 bg-slate-800">
              {anomaly.sourceKind === "image" ? <Image className="h-16 w-16 text-slate-500" aria-hidden="true" /> : <FileText className="h-16 w-16 text-slate-500" aria-hidden="true" />}
              <span className="sr-only">Aperçu simulé du document {anomaly.source}</span>
            </div>
            <p className="mt-4 truncate text-sm text-slate-300">{anomaly.source}</p>
          </div>
          <div className="p-6">
            <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Revue humaine</p><DialogTitle className="mt-2">{anomaly.type}</DialogTitle><DialogDescription className="mt-1">{anomaly.invoiceNumber} · {anomaly.vendor}</DialogDescription></div><button type="button" onClick={close} className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Fermer"><X className="h-5 w-5" /></button></div>
            <dl className="mt-6 grid grid-cols-2 gap-3 text-sm"><div className="rounded-md bg-slate-50 p-3"><dt className="text-slate-500">Date</dt><dd className="mt-1 font-semibold text-slate-900">{anomaly.date}</dd></div><div className="rounded-md bg-slate-50 p-3"><dt className="text-slate-500">Exposition</dt><dd className="mt-1 font-semibold text-slate-900">{formatMad(anomaly.exposureMad)}</dd></div><div className="rounded-md bg-slate-50 p-3"><dt className="text-slate-500">Confiance IA</dt><dd className="mt-1 font-semibold text-slate-900">{Math.round(anomaly.confidence * 100)}%</dd></div><div className="rounded-md bg-slate-50 p-3"><dt className="text-slate-500">État</dt><dd className="mt-1"><Badge variant="warning">À vérifier</Badge></dd></div></dl>
            <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><strong>Pourquoi l'agent signale ce cas ?</strong><p className="mt-1">{anomaly.description}</p></div>
            {rejecting ? <div className="mt-5"><label className="text-sm font-semibold text-slate-800" htmlFor="reject-reason">Motif du rejet <span className="text-red-600">*</span></label><textarea id="reject-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex: C'est une facture d'acompte, pas un doublon." className="mt-2 min-h-24 w-full rounded-md border border-slate-200 p-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /><Button className="mt-3" variant="destructive" disabled={!reason.trim()} onClick={reject}>Confirmer le rejet</Button></div> : <div className="mt-6 flex flex-wrap gap-3"><Button onClick={() => { onDecision("validated"); close(); }}><Check className="h-4 w-4" />Valider</Button><Button variant="outline" onClick={() => setRejecting(true)}>Rejeter</Button></div>}
          </div>
        </> : null}
      </DialogContent>
    </Dialog>
  );
}
