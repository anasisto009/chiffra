CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS unaccent;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_status') THEN
    CREATE TYPE document_status AS ENUM ('pending', 'processing', 'done', 'non_traite');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'anomaly_severity') THEN
    CREATE TYPE anomaly_severity AS ENUM ('low', 'medium', 'high');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'anomaly_status') THEN
    CREATE TYPE anomaly_status AS ENUM ('pending', 'validated', 'rejected');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS fournisseurs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom text UNIQUE NOT NULL,
  ice text,
  categorie text NOT NULL DEFAULT 'general',
  taux_tva_habituel numeric(5, 2) NOT NULL DEFAULT 20.0,
  compte_comptable text,
  recurrent boolean DEFAULT false,
  montant_moyen_ttc_mad numeric(18, 2) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  type text NOT NULL,
  storage_path text,
  status document_status NOT NULL DEFAULT 'pending',
  raw_text text,
  ocr_cache jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS storage_path text;

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  vendor text NOT NULL,
  date date NOT NULL,
  amount_ht numeric(18, 2) NOT NULL,
  tva numeric(18, 2) NOT NULL,
  tva_rate numeric(5, 2) NOT NULL,
  amount_ttc numeric(18, 2) NOT NULL,
  invoice_number text,
  period text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bank_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  date date NOT NULL,
  description text NOT NULL,
  amount numeric(18, 2) NOT NULL,
  matched_invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES invoices(id) ON DELETE CASCADE,
  type text NOT NULL,
  description text NOT NULL,
  exposure_mad numeric(18, 2) NOT NULL,
  severity anomaly_severity NOT NULL,
  status anomaly_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS human_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anomaly_id uuid REFERENCES anomalies(id) ON DELETE CASCADE,
  decision anomaly_status NOT NULL,
  reviewer_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT human_reviews_decision_check CHECK (decision IN ('validated', 'rejected'))
);

CREATE TABLE IF NOT EXISTS orchestration_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL,
  node text NOT NULL,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_embeddings (
  document_id uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  embedding vector(512) NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_invoices_document_id ON invoices(document_id);
CREATE INDEX IF NOT EXISTS idx_invoices_vendor_date ON invoices(vendor, date);
CREATE INDEX IF NOT EXISTS idx_bank_lines_document_id ON bank_lines(document_id);
CREATE INDEX IF NOT EXISTS idx_bank_lines_matched_invoice_id ON bank_lines(matched_invoice_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_invoice_id ON anomalies(invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_anomalies_unique_invoice_type ON anomalies(invoice_id, type);
CREATE INDEX IF NOT EXISTS idx_anomalies_exposure_mad ON anomalies(exposure_mad DESC);
CREATE INDEX IF NOT EXISTS idx_fournisseurs_nom ON fournisseurs(nom);
CREATE INDEX IF NOT EXISTS idx_orchestration_checkpoints_run_id ON orchestration_checkpoints(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_document_embeddings_vector ON document_embeddings USING ivfflat (embedding vector_cosine_ops);
