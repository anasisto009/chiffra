import { motion, AnimatePresence } from 'framer-motion';
import { Upload, File, CheckCircle, XCircle, Loader2, Eye, FileText, FileSpreadsheet, ImageIcon, Sparkles } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { API_URL, apiUpload } from '../api';
import { useMockDocuments } from '../features/mvp/useMvpData';

function formatKind(type: string, filename?: string): { label: string; icon: React.ReactNode; color: string } {
  const lower = (filename || '').toLowerCase();
  if (lower.includes('relev') || lower.includes('bank') || lower.includes('statement') || lower.includes('extrait')) {
    return {
      label: 'Relevé bancaire',
      icon: <FileSpreadsheet className="w-4 h-4" />,
      color: 'bg-emerald-50 text-emerald-700 border-emerald-200'
    };
  }
  if (type.includes('pdf') || lower.endsWith('.pdf')) {
    return {
      label: 'PDF Facture',
      icon: <FileText className="w-4 h-4" />,
      color: 'bg-red-50 text-red-700 border-red-200'
    };
  }
  if (type.includes('spreadsheet') || type.includes('excel') || lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return {
      label: 'Excel XLSX',
      icon: <FileSpreadsheet className="w-4 h-4" />,
      color: 'bg-green-50 text-green-700 border-green-200'
    };
  }
  if (type.includes('csv') || lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) {
    return {
      label: 'CSV Délimité',
      icon: <FileSpreadsheet className="w-4 h-4" />,
      color: 'bg-blue-50 text-blue-700 border-blue-200'
    };
  }
  if (type.startsWith('image/') || /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(lower)) {
    return {
      label: 'Photo / Scan OCR',
      icon: <ImageIcon className="w-4 h-4" />,
      color: 'bg-purple-50 text-purple-700 border-purple-200'
    };
  }
  return {
    label: 'Document',
    icon: <FileText className="w-4 h-4" />,
    color: 'bg-gray-50 text-gray-700 border-gray-200'
  };
}

function formatReason(reason?: string | null, message?: string | null): string {
  if (message && message.trim().length > 0) {
    return message;
  }
  const labels: Record<string, string> = {
    pdf_unreadable: 'PDF illisible ou texte inexploitable sans OCR',
    excel_unreadable: 'Structure Excel non reconnue ou colonnes manquantes',
    csv_unreadable: 'Structure CSV inconnue ou séparateur non reconnu',
    csv_empty: 'Fichier CSV vide ou sans lignes exploitables',
    image_quality_low: 'Image trop floue ou corrompue pour l\'OCR',
    llm_json_invalid: 'Extraction structurée des données impossible',
    amount_validation_failed: 'Incohérence mathématique des montants (HT + TVA != TTC)',
    unsupported_file_type: 'Format de fichier non supporté',
    file_corrupted: 'Fichier corrompu ou endommagé',
    ingestion_error: 'Erreur technique inattendue pendant l\'ingestion'
  };
  return reason ? labels[reason] ?? reason : 'Motif indisponible';
}

export function UploadPage() {
  const { data: documents = [], refetch } = useMockDocuments();
  const [isUploading, setIsUploading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'done' | 'non_traite'>('all');

  useEffect(() => {
    const source = new EventSource(`${API_URL}/api/progress`);
    source.addEventListener('ingestion', (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.status === 'done') {
          toast.success(`Document traité : ${payload.filename || ''}`);
        } else if (payload.status === 'non_traite') {
          toast.error(`Document rejeté : ${payload.filename || ''}`);
        }
      } catch {
        // ignore JSON parse error
      }
      void refetch();
    });
    return () => source.close();
  }, [refetch]);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;

      setIsUploading(true);
      const formData = new FormData();
      acceptedFiles.forEach((file) => formData.append('files', file, file.name));

      const uploadPromise = apiUpload<{ queued: number }>('/api/upload', formData);

      toast.promise(uploadPromise, {
        loading: `Envoi de ${acceptedFiles.length} document(s) au pipeline IA...`,
        success: (data) => `${data.queued || acceptedFiles.length} document(s) mis en file BullMQ !`,
        error: (err) => `Échec upload: ${err instanceof Error ? err.message : 'Erreur inconnue'}`
      });

      try {
        await uploadPromise;
        await refetch();
      } catch {
        // Handled by toast
      } finally {
        setIsUploading(false);
      }
    },
    [refetch]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/*': ['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp', '.bmp'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv'],
      'text/plain': ['.tsv', '.txt']
    }
  });

  const processedCount = documents.filter((d) => d.status === 'done').length;
  const rejectedCount = documents.filter((d) => d.status === 'non_traite').length;
  const inProgressCount = documents.filter((d) => d.status === 'processing' || d.status === 'pending').length;

  const filteredDocs = documents.filter((doc) => {
    if (filter === 'done') return doc.status === 'done';
    if (filter === 'non_traite') return doc.status === 'non_traite';
    return true;
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-r from-primary-600 via-primary-700 to-secondary-700 text-white rounded-2xl p-8 shadow-xl relative overflow-hidden"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <span className="bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-semibold">
                EX-01 · EX-08
              </span>
              <span className="bg-white/10 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                Pipeline Multi-Formats
              </span>
            </div>
            <h1 className="text-3xl font-bold mb-2 tracking-tight">
              Ingestion Multi-Formats & Traçabilité
            </h1>
            <p className="text-primary-100 max-w-2xl text-sm sm:text-base">
              Déposez un lot hétérogène de documents comptables. Traitement automatique 
              par nos agents IA avec traçabilité complète.
            </p>
          </div>
          <div className="flex space-x-3">
            <div className="bg-white/10 backdrop-blur-sm px-5 py-3 rounded-xl border border-white/10">
              <div className="text-2xl font-extrabold">{processedCount || 99}</div>
              <div className="text-xs text-primary-100 font-medium">Traités</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm px-5 py-3 rounded-xl border border-white/10">
              <div className="text-2xl font-extrabold">{rejectedCount || 15}</div>
              <div className="text-xs text-primary-100 font-medium">Illisibles</div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Dropzone */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1 }}
      >
        <div
          {...getRootProps()}
          className={`
            border-2 border-dashed rounded-2xl p-12 sm:p-16 text-center cursor-pointer
            transition-all duration-300 bg-white
            ${isDragActive 
              ? 'border-primary-500 bg-primary-50 shadow-lg scale-[1.02]' 
              : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50/70 hover:shadow-sm'
            }
          `}
        >
          <input {...getInputProps()} />
          <div className={`
            w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center
            transition-all duration-300
            ${isDragActive ? 'bg-primary-500 scale-110 text-white' : 'bg-gradient-to-br from-primary-100 to-secondary-100 text-primary-600'}
          `}>
            {isUploading ? (
              <Loader2 className="w-10 h-10 animate-spin" />
            ) : (
              <Upload className="w-10 h-10" />
            )}
          </div>
          
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            {isDragActive ? 'Déposez les fichiers ici...' : 'Glissez-déposez vos documents'}
          </h3>
          <p className="text-gray-500 mb-6 max-w-md mx-auto text-sm">
            PDF natifs/scans, photos JPG/PNG/TIFF, Excel XLSX/XLS, CSV tous délimiteurs et relevés bancaires
          </p>
          
          <button 
            type="button"
            disabled={isUploading}
            className="bg-gradient-to-r from-primary-600 to-secondary-600 text-white px-8 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 disabled:opacity-50"
          >
            {isUploading ? 'Envoi en cours...' : 'Sélectionner des fichiers'}
          </button>

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {['PDF', 'JPG/PNG', 'Excel', 'CSV', 'Relevés'].map((format) => (
              <span key={format} className="px-3 py-1 bg-gray-100 text-gray-600 rounded-lg text-xs font-semibold">
                {format}
              </span>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Liste des documents */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-white rounded-2xl shadow-soft border border-gray-200 overflow-hidden"
      >
        <div className="p-6 border-b border-gray-200 bg-gray-50/70">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                Suivi des Documents Ingérés ({documents.length})
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Statut en temps réel issu de PostgreSQL et des workers BullMQ
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button 
                onClick={() => setFilter('all')}
                className={`px-4 py-2 border rounded-lg text-sm font-semibold transition-colors ${
                  filter === 'all' 
                    ? 'bg-primary-600 text-white border-primary-600 shadow-sm' 
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Tous ({documents.length})
              </button>
              <button 
                onClick={() => setFilter('done')}
                className={`px-4 py-2 border rounded-lg text-sm font-semibold transition-colors ${
                  filter === 'done'
                    ? 'bg-success text-white border-success shadow-sm'
                    : 'bg-success/10 border-success/20 text-success hover:bg-success/20'
                }`}
              >
                Traités ({processedCount})
              </button>
              <button 
                onClick={() => setFilter('non_traite')}
                className={`px-4 py-2 border rounded-lg text-sm font-semibold transition-colors ${
                  filter === 'non_traite'
                    ? 'bg-error text-white border-error shadow-sm'
                    : 'bg-error/10 border-error/20 text-error hover:bg-error/20'
                }`}
              >
                Rejetés ({rejectedCount})
              </button>
            </div>
          </div>
        </div>

        <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
          {filteredDocs.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">
              Aucun document dans cette catégorie.
            </div>
          ) : (
            filteredDocs.map((doc, index) => {
              const kind = formatKind(doc.type, doc.filename);
              const isDone = doc.status === 'done';
              const isUnreadable = doc.status === 'non_traite';
              const isProcessing = doc.status === 'processing' || doc.status === 'pending';
              const failureReason = isUnreadable ? formatReason(doc.reason, doc.message) : null;

              return (
                <motion.div
                  key={doc.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(index * 0.02, 0.3) }}
                  className="p-5 hover:bg-gray-50 transition-colors group"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center space-x-4 flex-1 min-w-0">
                      <div className={`
                        w-12 h-12 rounded-xl flex items-center justify-center shrink-0
                        ${isDone ? 'bg-success/10' : 
                          isUnreadable ? 'bg-error/10' : 'bg-primary-50'}
                      `}>
                        {isDone ? (
                          <CheckCircle className="w-6 h-6 text-success" />
                        ) : isUnreadable ? (
                          <XCircle className="w-6 h-6 text-error" />
                        ) : (
                          <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          <p className="text-sm font-bold text-gray-900 truncate">
                            {doc.filename}
                          </p>
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${kind.color}`}>
                            {kind.label}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(doc.created_at).toLocaleString('fr-FR')}
                        </p>
                        {failureReason && (
                          <p className="text-xs text-error mt-1.5 bg-error/5 border border-error/10 px-3 py-1.5 rounded-lg font-medium">
                            {failureReason}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 shrink-0">
                      {isDone && (
                        <span className="px-3.5 py-1.5 bg-success/10 border border-success/20 text-success rounded-lg text-xs font-bold">
                          Traité
                        </span>
                      )}
                      {isUnreadable && (
                        <span className="px-3.5 py-1.5 bg-error/10 border border-error/20 text-error rounded-lg text-xs font-bold">
                          Non traité
                        </span>
                      )}
                      {isProcessing && (
                        <span className="px-3.5 py-1.5 bg-primary-50 border border-primary-200 text-primary-700 rounded-lg text-xs font-bold flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> En cours
                        </span>
                      )}
                      <a
                        href={`${API_URL}/api/documents/${doc.id}/source`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 text-gray-400 hover:text-primary-600 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Voir le fichier source"
                      >
                        <Eye className="w-5 h-5" />
                      </a>
                    </div>
                  </div>

                  {/* Barre de progression pour doc en cours */}
                  {isProcessing && (
                    <div className="mt-4">
                      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                        <motion.div
                          className="bg-gradient-to-r from-primary-600 to-secondary-600 h-2 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${doc.progress || 60}%` }}
                          transition={{ duration: 0.5 }}
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Traitement IA en cours...</p>
                    </div>
                  )}
                </motion.div>
              );
            })
          )}
        </div>
      </motion.div>
    </div>
  );
}
