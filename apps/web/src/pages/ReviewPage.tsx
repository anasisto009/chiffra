import { motion, AnimatePresence } from 'framer-motion';
import { 
  Eye, Check, X, AlertTriangle, Filter, 
  SortDesc, ChevronDown, ExternalLink, ShieldCheck, MessageSquare 
} from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { API_URL } from '../api';
import { useMockAnomalies, useReviewAnomaly } from '../features/mvp/useMvpData';
import type { ApiAnomaly } from '../features/mvp/useMvpData';

const familyLabels: Record<string, string> = {
  unknown_vendor: 'Fournisseur Inconnu',
  tva_rate_invalid: 'Taux TVA Invalide',
  tva_calculation_error: 'Erreur Calcul TVA',
  tva_rate_mismatch: 'Taux Incohérent',
  invoice_out_of_period: 'Hors Période',
  amount_aberrant: 'Montant Aberrant',
  duplicate_probable: 'Doublon Probable'
};

export function ReviewPage() {
  const { data: anomalies = [], refetch } = useMockAnomalies();
  const reviewMutation = useReviewAnomaly();

  const [filter, setFilter] = useState<'pending' | 'all' | 'validated' | 'rejected'>('pending');
  const [sortBy, setSortBy] = useState<'exposure' | 'date' | 'severity'>('exposure');
  const [rejectingAnomaly, setRejectingAnomaly] = useState<ApiAnomaly | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const pendingList = anomalies.filter((a) => a.status === 'pending');
  const validatedList = anomalies.filter((a) => a.status === 'validated');
  const rejectedList = anomalies.filter((a) => a.status === 'rejected');

  const filtered = anomalies.filter((a) => {
    if (filter === 'pending') return a.status === 'pending';
    if (filter === 'validated') return a.status === 'validated';
    if (filter === 'rejected') return a.status === 'rejected';
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'exposure') {
      const expA = Number.parseFloat(a.exposure_mad || '0') || 0;
      const expB = Number.parseFloat(b.exposure_mad || '0') || 0;
      return expB - expA;
    }
    if (sortBy === 'date') {
      return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
    }
    if (sortBy === 'severity') {
      const score = (sev: string) => (sev === 'high' ? 3 : sev === 'medium' ? 2 : 1);
      return score(b.severity) - score(a.severity);
    }
    return 0;
  });

  const handleValidate = async (anomaly: ApiAnomaly) => {
    try {
      await reviewMutation.mutateAsync({
        anomalyId: anomaly.id,
        decision: 'validated',
        note: "Validé et conforme aux règles de déductibilité CGI Maroc"
      });
      toast.success(`Anomalie validée pour ${anomaly.vendor || 'le dossier'}`);
    } catch {
      toast.error("Échec de la validation de l'anomalie");
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectingAnomaly) return;
    try {
      await reviewMutation.mutateAsync({
        anomalyId: rejectingAnomaly.id,
        decision: 'rejected',
        note: rejectReason.trim() || "Anomalie confirmée : rejetée pour régularisation fiscale"
      });
      toast.success(`Anomalie rejetée : motif consigné au journal d'audit`);
      setRejectingAnomaly(null);
      setRejectReason('');
    } catch {
      toast.error("Échec de l'enregistrement du rejet");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-soft border border-gray-200 p-8"
      >
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <span className="bg-warning/20 text-warning px-3 py-1 rounded-full text-xs font-semibold">
                EX-05 · Priorisation par Exposition Financière
              </span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2 tracking-tight">
              Revue & Arbitrage Humain
            </h1>
            <p className="text-gray-600 max-w-3xl text-sm sm:text-base">
              Validez ou rejetez les anomalies fiscales détectées par l'agent Auditor 
              avec piste d'audit certifiée.
            </p>
          </div>
          <div className="bg-warning/10 border border-warning/20 px-6 py-3 rounded-xl shrink-0">
            <div className="flex items-center space-x-3">
              <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
              <div>
                <div className="text-xl font-bold text-warning">
                  {pendingList.length}
                </div>
                <div className="text-xs text-gray-600 font-medium">
                  anomalies en attente d'arbitrage
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Filtres & Tri */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-gray-200 gap-4"
      >
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilter('pending')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              filter === 'pending'
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            À traiter ({pendingList.length})
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              filter === 'all'
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Toutes ({anomalies.length})
          </button>
          <button
            onClick={() => setFilter('validated')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              filter === 'validated'
                ? 'bg-success text-white shadow-sm'
                : 'bg-success/10 text-success hover:bg-success/20'
            }`}
          >
            Validées ({validatedList.length})
          </button>
          <button
            onClick={() => setFilter('rejected')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              filter === 'rejected'
                ? 'bg-error text-white shadow-sm'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Rejetées ({rejectedList.length})
          </button>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 text-sm text-gray-600 font-medium">
            <SortDesc className="w-4 h-4 text-gray-400" />
            <span className="hidden sm:inline">Trier par :</span>
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            aria-label="Trier les anomalies"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white text-gray-800"
          >
            <option value="exposure">Exposition financière décroissante</option>
            <option value="date">Date chronologique</option>
            <option value="severity">Gravité / Confiance IA</option>
          </select>
        </div>
      </motion.div>

      {/* Liste des anomalies */}
      <div className="space-y-4">
        {sorted.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-soft border border-gray-200 p-12 text-center text-gray-500">
            <ShieldCheck className="w-12 h-12 text-success mx-auto mb-3" />
            <h3 className="text-base font-bold text-gray-900">Aucune anomalie à traiter</h3>
            <p className="text-xs text-gray-500 mt-1">Tous les dossiers de cette catégorie ont été arbitrés.</p>
          </div>
        ) : (
          sorted.map((anomaly, index) => {
            const exp = Number.parseFloat(anomaly.exposure_mad || '0') || 0;
            const familyTitle = familyLabels[anomaly.type] || anomaly.type;
            const isHigh = anomaly.severity === 'high';
            const isPending = anomaly.status === 'pending';
            const isValidated = anomaly.status === 'validated';
            const isRejected = anomaly.status === 'rejected';

            return (
              <motion.div
                key={anomaly.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.04, 0.3) }}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                  <div className="flex items-start space-x-4 flex-1">
                    <div className="w-12 h-12 bg-error/10 rounded-xl flex items-center justify-center shrink-0">
                      <AlertTriangle className="w-6 h-6 text-error" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <h3 className="text-lg font-bold text-gray-900">
                          {anomaly.vendor || 'Document non typé'}
                        </h3>
                        <span className="px-3 py-1 bg-primary/10 text-primary rounded-full text-xs font-semibold">
                          {familyTitle}
                        </span>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          isHigh 
                            ? 'bg-error/10 text-error border border-error/20' 
                            : 'bg-warning/10 text-warning border border-warning/20'
                        }`}>
                          {isHigh ? 'Risque Élevé' : 'Risque Moyen'}
                        </span>
                        {isValidated && (
                          <span className="px-2.5 py-0.5 bg-success text-white rounded-full text-xs font-bold">
                            Validé
                          </span>
                        )}
                        {isRejected && (
                          <span className="px-2.5 py-0.5 bg-error text-white rounded-full text-xs font-bold">
                            Rejeté
                          </span>
                        )}
                      </div>

                      <p className="text-gray-600 mb-3 text-sm leading-relaxed">
                        {anomaly.description || anomaly.details?.reason || 'Anomalie comptable détectée nécessitant vérification fiscale.'}
                      </p>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                        {anomaly.invoice_id && (
                          <span className="font-mono bg-gray-100 px-2 py-1 rounded border border-gray-200">
                            Facture N°: {anomaly.invoice_id}
                          </span>
                        )}
                        <span>•</span>
                        <span>Date: {anomaly.date ? new Date(anomaly.date).toLocaleDateString('fr-FR') : 'Date non spécifiée'}</span>
                        {anomaly.document_id && (
                          <>
                            <span>•</span>
                            <span className="font-mono text-gray-400">Doc ID: {anomaly.document_id.slice(0, 8)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row items-end sm:items-center gap-4 shrink-0 w-full sm:w-auto justify-between">
                    <div className="text-left sm:text-right">
                      <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Exposition Fiscale</p>
                      <p className="text-2xl font-extrabold text-error">
                        {exp.toLocaleString('fr-FR')} MAD
                      </p>
                    </div>

                    <div className="flex items-center space-x-2">
                      {anomaly.document_id && (
                        <a
                          href={`${API_URL}/api/documents/${anomaly.document_id}/source`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-gray-600"
                          title="Visualiser la pièce justificative"
                        >
                          <Eye className="w-5 h-5" />
                        </a>
                      )}
                      
                      {isPending ? (
                        <>
                          <button
                            onClick={() => handleValidate(anomaly)}
                            className="px-4 py-2 bg-success text-white rounded-lg font-semibold hover:bg-success/90 transition-all flex items-center space-x-2 text-sm shadow-sm hover:scale-105 active:scale-95"
                          >
                            <Check className="w-4 h-4" />
                            <span>Valider</span>
                          </button>
                          <button
                            onClick={() => {
                              setRejectingAnomaly(anomaly);
                              setRejectReason('');
                            }}
                            className="px-4 py-2 bg-error/10 text-error rounded-lg font-semibold hover:bg-error/20 transition-all flex items-center space-x-2 text-sm border border-error/20 hover:scale-105 active:scale-95"
                          >
                            <X className="w-4 h-4" />
                            <span>Rejeter</span>
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400 italic">
                          Arbitrage consigné
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Modal Motif de rejet */}
      <AnimatePresence>
        {rejectingAnomaly && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-200"
            >
              <div className="flex items-center space-x-3 mb-4 text-error">
                <div className="p-2 bg-error/10 rounded-xl">
                  <AlertTriangle className="w-6 h-6 text-error" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Motif de Rejet & Audit</h3>
                  <p className="text-xs text-gray-500">Ce motif sera certifié dans la piste d'audit légale</p>
                </div>
              </div>

              <p className="text-sm text-gray-600 mb-4">
                Dossier : <strong>{rejectingAnomaly.vendor || 'Facture'}</strong> (Exposition :{' '}
                <span className="text-error font-bold">
                  {Number.parseFloat(rejectingAnomaly.exposure_mad || '0').toLocaleString('fr-FR')} MAD
                </span>)
              </p>

              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Exemple : Facture non conforme aux dispositions CGI (ICE manquant ou taux TVA inapplicable)..."
                rows={4}
                className="w-full border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />

              <div className="flex justify-end gap-3 mt-5">
                <button
                  type="button"
                  onClick={() => setRejectingAnomaly(null)}
                  className="px-4 py-2 border border-gray-300 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleRejectSubmit}
                  className="px-5 py-2 bg-error text-white rounded-xl text-sm font-semibold hover:bg-error/90 shadow-md"
                >
                  Confirmer le rejet
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
