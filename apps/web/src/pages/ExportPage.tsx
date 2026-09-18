import { motion } from 'framer-motion';
import { CheckCircle2, Download, FileSpreadsheet, FileText, Sparkles } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { API_URL, apiGet } from '../api';

export function ExportPage() {
  const { data: exportData, isLoading } = useQuery({
    queryKey: ['tva-export'],
    queryFn: () => apiGet<any>('/api/export/tva')
  });

  const handleDownloadCsv = () => {
    window.open(`${API_URL}/api/export/tva?format=csv`, '_blank');
  };

  const rows = exportData?.rows || [];
  const totals = exportData?.totals || {
    invoice_count: 0,
    total_ht: '0.00',
    total_tva: '0.00',
    total_ttc: '0.00'
  };

  const rateLabels: Record<string, string> = {
    '0': 'Taux 0% (Exportations, exonérations)',
    '7': 'Taux 7% (Eau, denrées de 1ère nécessité)',
    '10': 'Taux 10% (Restauration, opérations bancaires)',
    '14': 'Taux 14% (Transport, énergie)',
    '20': 'Taux normal 20% (Biens et services standard)'
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-r from-secondary-900 via-primary-900 to-secondary-900 text-white rounded-2xl p-8 shadow-2xl relative overflow-hidden"
      >
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <span className="bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-semibold">
                EX-06 · Export Déclaration TVA Conforme DGI
              </span>
              <span className="bg-success/20 text-success border border-success/30 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                SIMPL-TVA Ready
              </span>
            </div>
            <h1 className="text-3xl font-bold mb-2 tracking-tight">
              Export Fiscal & Déclaration TVA
            </h1>
            <p className="text-primary-200 max-w-2xl text-sm sm:text-base">
              {totals.invoice_count} factures ventilées •{' '}
              <span className="font-bold text-success">
                {Number.parseFloat(totals.total_tva || '0').toLocaleString('fr-FR')} MAD
              </span>{' '}
              de TVA déductible certifiée •{' '}
              <span className="font-bold text-white">
                {Number.parseFloat(totals.total_ttc || '0').toLocaleString('fr-FR')} MAD
              </span>{' '}
              TTC.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={handleDownloadCsv}
              className="bg-gradient-to-r from-primary-600 to-secondary-600 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 flex items-center space-x-2 text-sm"
            >
              <Download className="w-4 h-4" />
              <span>Télécharger CSV (DGI)</span>
            </button>
          </div>
        </div>
      </motion.div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl shadow-soft border border-gray-200 p-6 hover:shadow-lg transition-shadow"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Base Hors Taxe</span>
            <div className="rounded-xl bg-gray-100 p-2.5 text-gray-700">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 text-2xl sm:text-3xl font-extrabold text-gray-900">
            {Number.parseFloat(totals.total_ht || '0').toLocaleString('fr-FR')} <span className="text-sm font-bold text-gray-500">MAD</span>
          </div>
          <p className="mt-1 text-xs text-gray-400">Assiette taxable déductible</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-2xl shadow-soft border border-gray-200 p-6 hover:shadow-lg transition-shadow"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">TVA Déductible</span>
            <div className="rounded-xl bg-success/10 p-2.5 text-success">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 text-2xl sm:text-3xl font-extrabold text-success">
            {Number.parseFloat(totals.total_tva || '0').toLocaleString('fr-FR')} <span className="text-sm font-bold text-gray-500">MAD</span>
          </div>
          <p className="mt-1 text-xs text-success font-medium">Montant certifié déductible</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-2xl shadow-soft border border-gray-200 p-6 hover:shadow-lg transition-shadow"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Total TTC</span>
            <div className="rounded-xl bg-primary-50 p-2.5 text-primary-600">
              <FileText className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 text-2xl sm:text-3xl font-extrabold text-gray-900">
            {Number.parseFloat(totals.total_ttc || '0').toLocaleString('fr-FR')} <span className="text-sm font-bold text-gray-500">MAD</span>
          </div>
          <p className="mt-1 text-xs text-gray-400">Paiements totaux engagés</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-white rounded-2xl shadow-soft border border-gray-200 p-6 hover:shadow-lg transition-shadow"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Factures Déclarées</span>
            <div className="rounded-xl bg-secondary-50 p-2.5 text-secondary-600">
              <Sparkles className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 text-2xl sm:text-3xl font-extrabold text-gray-900">
            {totals.invoice_count}
          </div>
          <p className="mt-1 text-xs text-success font-semibold">100% conforme SIMPL-TVA</p>
        </motion.div>
      </div>

      {/* Export Table Preview */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="bg-white rounded-2xl shadow-soft border border-gray-200 overflow-hidden"
      >
        <div className="border-b border-gray-200 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-gray-50/70">
          <div>
            <h2 className="text-base font-bold text-gray-900">Ventilation Fiscale par Taux de TVA (DGI Maroc)</h2>
            <p className="text-xs text-gray-500 mt-0.5">Tableau récapitulatif officiel conforme aux exigences du portail SIMPL-TVA</p>
          </div>
          <span className="rounded-full bg-success/10 border border-success/20 px-3 py-1 text-xs font-bold text-success">
            Modèle Légal Conforme
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-gray-200 bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-6 py-3.5">Taux TVA Légal</th>
                <th className="px-6 py-3.5">Champ d'Application</th>
                <th className="px-6 py-3.5 text-center">Nombre de Pièces</th>
                <th className="px-6 py-3.5 text-right">Base HT</th>
                <th className="px-6 py-3.5 text-right">TVA Déductible</th>
                <th className="px-6 py-3.5 text-right">Total TTC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500">
                    Chargement des données fiscales...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500">
                    Aucune facture prête pour l'export pour le moment.
                  </td>
                </tr>
              ) : (
                rows.map((row: any, idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4 font-extrabold text-primary-600 text-sm">{row.tva_rate}%</td>
                    <td className="px-6 py-4 font-medium text-gray-800">{rateLabels[row.tva_rate] || `Taux ${row.tva_rate}%`}</td>
                    <td className="px-6 py-4 text-center font-bold text-gray-700">{row.invoice_count}</td>
                    <td className="px-6 py-4 text-right font-mono font-semibold text-gray-900">
                      {Number.parseFloat(row.total_ht).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} MAD
                    </td>
                    <td className="px-6 py-4 text-right font-mono font-bold text-success">
                      {Number.parseFloat(row.total_tva).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} MAD
                    </td>
                    <td className="px-6 py-4 text-right font-mono font-extrabold text-gray-900">
                      {Number.parseFloat(row.total_ttc).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} MAD
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t-2 border-gray-300 bg-gray-50/80 font-bold text-gray-900">
                <tr>
                  <td className="px-6 py-4 text-sm" colSpan={2}>Total Général Déclaration</td>
                  <td className="px-6 py-4 text-center text-sm font-extrabold">{totals.invoice_count}</td>
                  <td className="px-6 py-4 text-right font-mono text-sm">
                    {Number.parseFloat(totals.total_ht || '0').toLocaleString('fr-FR', { minimumFractionDigits: 2 })} MAD
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-sm text-success font-extrabold">
                    {Number.parseFloat(totals.total_tva || '0').toLocaleString('fr-FR', { minimumFractionDigits: 2 })} MAD
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-sm font-extrabold">
                    {Number.parseFloat(totals.total_ttc || '0').toLocaleString('fr-FR', { minimumFractionDigits: 2 })} MAD
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </motion.div>
    </div>
  );
}
