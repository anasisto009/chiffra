import { FileCheck2, FileWarning, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { API_URL, apiUpload } from "../../api";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { useMockDocuments } from "../mvp/useMvpData";
import type { ApiDocument } from "../mvp/useMvpData";

const ACCEPTED_EXTENSIONS = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".tiff",
  ".tif",
  ".webp",
  ".xlsx",
  ".xls",
  ".xlsm",
  ".csv",
  ".tsv",
  ".txt"
];

function formatKind(type: string, filename?: string): string {
  const lower = (filename || "").toLowerCase();
  if (lower.includes("relev") || lower.includes("bank") || lower.includes("statement") || lower.includes("extrait")) {
    return "Relevé bancaire";
  }
  if (type.includes("pdf") || lower.endsWith(".pdf")) return "PDF";
  if (type.includes("spreadsheet") || type.includes("excel") || lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "Excel";
  if (type.includes("csv") || lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) return "CSV";
  if (type.startsWith("image/") || /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(lower)) return "Photo";
  return type || "Document";
}

function isProcessingError(reason?: string | null): boolean {
  return Boolean(
    reason && [
      "pdf_unreadable",
      "excel_unreadable",
      "csv_unreadable",
      "csv_empty",
      "image_quality_low",
      "llm_json_invalid",
      "amount_validation_failed",
      "unsupported_file_type",
      "file_corrupted",
      "ingestion_error",
      "worker_interrupted"
    ].includes(reason)
  );
}

function formatReason(reason?: string | null, message?: string | null): string {
  if (message && message.trim().length > 0) {
    return message;
  }

  const labels: Record<string, string> = {
    pdf_unreadable: "PDF illisible ou texte inexploitable",
    excel_unreadable: "Fichier Excel illisible ou structure inconnue",
    csv_unreadable: "Structure CSV non reconnue ou séparateur inconnu",
    csv_empty: "Fichier CSV vide",
    image_quality_low: "Image trop floue ou texte inexploitable pour l'OCR",
    llm_json_invalid: "Extraction structurée des données impossible",
    amount_validation_failed: "Montants HT, TVA et TTC incohérents",
    unsupported_file_type: "Format de fichier non supporté",
    file_corrupted: "Fichier corrompu ou illisible",
    ingestion_error: "Erreur inattendue pendant l'ingestion",
    worker_interrupted: "Traitement interrompu avant sa finalisation"
  };

  return reason ? labels[reason] ?? reason : "Motif indisponible";
}

function statusBadge(document: ApiDocument) {
  if (document.status === "non_traite" && isProcessingError(document.reason)) {
    return <Badge variant="danger">Rejeté / Illisible</Badge>;
  }

  const status = document.status;
  if (status === "done") return <Badge variant="success">Traité</Badge>;
  if (status === "non_traite") return <Badge variant="danger">Non traité</Badge>;
  if (status === "processing") return <Badge variant="warning">En cours</Badge>;
  return <Badge variant="secondary">En file</Badge>;
}

export function UploadTracking() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: documents = [], refetch } = useMockDocuments();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const source = new EventSource(`${API_URL}/api/progress`);
    source.addEventListener("ingestion", () => void refetch());
    return () => source.close();
  }, [refetch]);

  async function upload(files: FileList | File[]): Promise<void> {
    const accepted = Array.from(files).filter((file) =>
      ACCEPTED_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))
    );
    if (accepted.length === 0) {
      setError("Aucun fichier accepté. Utilisez PDF, photo, Excel (XLSX, XLS), CSV ou relevé bancaire.");
      return;
    }

    setError(null);
    setIsUploading(true);
    const formData = new FormData();
    accepted.forEach((file) => formData.append("files", file, file.name));

    try {
      await apiUpload("/api/upload", formData);
      await refetch();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Échec de l'upload.");
    } finally {
      setIsUploading(false);
    }
  }

  const processed = documents.filter((document) => document.status === "done").length;
  const humanQueue = documents.filter((document) => document.status === "non_traite").length;

  return (
    <section className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">EX-01 · EX-08 · EX-03</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Ingestion Multi-Formats & Tracking</h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Support natif PDF, Images/Scans, Excel (XLSX/XLS), CSV multi-séparateurs et Relevés bancaires avec statut explicite.
          </p>
        </div>
        <div className="text-sm font-medium text-slate-600">
          <span className="text-emerald-700 font-semibold">{processed}</span>/{documents.length} traités ·{" "}
          <span className="text-rose-700 font-semibold">{humanQueue}</span> en anomalie / file humaine
        </div>
      </header>

      {error ? <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}

      <Card>
        <CardContent className="p-0">
          <div
            className={`m-5 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              isDragging ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50"
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              void upload(event.dataTransfer.files);
            }}
          >
            <UploadCloud className="mx-auto h-10 w-10 text-blue-600" aria-hidden="true" />
            <h2 className="mt-3 font-semibold text-slate-900">Déposer des documents comptables</h2>
            <p className="mt-1 text-sm text-slate-500">
              PDF (natif/scan), photos reçus (JPG/PNG/TIFF), Excel (XLSX/XLS), CSV (virgule, point-virgule, tab) et Relevés bancaires
            </p>
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              multiple
              accept={ACCEPTED_EXTENSIONS.join(",")}
              onChange={(event) => void upload(event.target.files ?? [])}
            />
            <Button
              className="mt-5"
              type="button"
              disabled={isUploading}
              onClick={() => inputRef.current?.click()}
            >
              {isUploading ? "Traitement en cours..." : "Choisir des fichiers"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>Suivi des documents ingérés</CardTitle>
            <Badge variant="secondary">{documents.length} document{documents.length > 1 ? "s" : ""}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {documents.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun document en base.</p>
          ) : (
            documents.map((document) => {
              const processingError = document.status === "non_traite" && isProcessingError(document.reason);
              const progress = document.status === "done" ? 100 : document.status === "processing" ? 50 : 0;
              const formattedReasonText = formatReason(document.reason, document.message);

              return (
                <article
                  key={document.id}
                  className={`rounded-lg border p-4 transition-all ${
                    processingError ? "border-red-200 bg-red-50/40" : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      {processingError ? (
                        <FileWarning className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
                      ) : (
                        <FileCheck2 className="h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{document.filename}</p>
                        <p className="text-sm text-slate-500">
                          {formatKind(document.type, document.filename)} ·{" "}
                          {new Date(document.created_at).toLocaleString("fr-MA")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {statusBadge(document)}
                      <span className="w-12 text-right text-sm font-semibold text-slate-600">
                        {processingError ? "—" : `${progress}%`}
                      </span>
                    </div>
                  </div>

                  {!processingError && (
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          document.status === "done" ? "bg-emerald-600" : "bg-blue-600"
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}

                  {document.status === "non_traite" ? (
                    <p
                      className={`mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-sm ${
                        processingError ? "bg-red-100 text-red-900" : "bg-amber-50 text-amber-900"
                      }`}
                    >
                      <FileWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        <strong className="font-semibold">Motif explicite (EX-08) :</strong> {formattedReasonText}
                        {processingError ? " · Document conservé dans la file humaine pour révision manuelle." : ""}
                      </span>
                    </p>
                  ) : null}
                </article>
              );
            })
          )}
        </CardContent>
      </Card>
    </section>
  );
}
