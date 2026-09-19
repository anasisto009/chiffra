import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { randomUUID } from "node:crypto";
import type { AgentDefinition } from "@chiffra/shared";
import { auditInvoices, type AuditAnomaly, type AuditInvoice, type VendorReference } from "./auditor.js";
import { explainAnomaly, type AnomalyExplanation } from "./explainer.js";
import { ingestDocument, type IngestorResult } from "./ingestor.js";
import {
  reconcileBankLines,
  type ReconciliationBankLine,
  type ReconciliationResult
} from "./reconciler.js";
import { pool } from "../db/client.js";

// ==========================================
// 1. DÉFINITION DES 5 AGENTS OBLIGATOIRES
// ==========================================
export const orchestratorAgent: AgentDefinition = {
  id: "orchestrator",
  label: "Orchestrator",
  responsibility: "Supervise le pipeline, isole les échecs, coordonne les agents et escalade sans inventer."
};

// ==========================================
// 2. ÉTAT ET ANNOTATIONS LANGGRAPH
// ==========================================
export type GraphDocument = {
  id: string;
  filename: string;
  type: string;
  contentBase64: string;
};

export type GraphInvoice = AuditInvoice & {
  document_id: string;
};

export type GraphAnomaly = AuditAnomaly & {
  explanation?: AnomalyExplanation;
};

export type ChiffraGraphState = {
  runId: string;
  documents: GraphDocument[];
  invoices: GraphInvoice[];
  bankLines: ReconciliationBankLine[];
  anomalies: GraphAnomaly[];
  reconciliation?: ReconciliationResult;
  errors: Array<{ document_id?: string; node: string; message: string }>;
  status: "pending" | "ingesting" | "auditing" | "reconciling" | "explaining" | "orchestrated" | "done" | "partial";
  fiscalPeriod: string;
  vendorReferential: VendorReference[];
  orchestrationSummary?: {
    totalDocuments: number;
    processedInvoices: number;
    bankLinesCount: number;
    anomaliesCount: number;
    matchRate: string;
    unresolvedCount: number;
    escalations: string[];
  };
};

export const ChiffraGraphAnnotation = Annotation.Root({
  runId: Annotation<string>(),
  documents: Annotation<GraphDocument[]>(),
  invoices: Annotation<GraphInvoice[]>(),
  bankLines: Annotation<ReconciliationBankLine[]>(),
  anomalies: Annotation<GraphAnomaly[]>(),
  reconciliation: Annotation<ReconciliationResult | undefined>(),
  errors: Annotation<Array<{ document_id?: string; node: string; message: string }>>(),
  status: Annotation<ChiffraGraphState["status"]>(),
  fiscalPeriod: Annotation<string>(),
  vendorReferential: Annotation<VendorReference[]>(),
  orchestrationSummary: Annotation<ChiffraGraphState["orchestrationSummary"] | undefined>()
});

async function saveGraphCheckpoint(node: string, state: ChiffraGraphState): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO orchestration_checkpoints (run_id, node, state)
       VALUES ($1, $2, $3::jsonb)`,
      [state.runId, node, JSON.stringify(state)]
    );
  } catch {
    // Checkpoint logging non-bloquant
  }
}

function invoiceFromIngestion(
  document: GraphDocument,
  result: Extract<IngestorResult, { status: "done" }>
): GraphInvoice {
  return {
    id: randomUUID(),
    document_id: document.id,
    vendor: result.invoice.vendor,
    date: result.invoice.date,
    amount_ht: result.invoice.amount_ht,
    tva: result.invoice.tva,
    tva_rate: result.invoice.tva_rate,
    amount_ttc: result.invoice.amount_ttc,
    invoice_number: result.invoice.invoice_number,
    period: result.invoice.date.slice(0, 7)
  };
}

// ==========================================
// 3. NOEUDS DU LANGGRAPH STATEGRAPH
// ==========================================

// Agent 1: Ingestor Node
export async function ingestorNode(state: ChiffraGraphState): Promise<Partial<ChiffraGraphState>> {
  const invoices = [...state.invoices];
  const bankLines = [...state.bankLines];
  const errors = [...state.errors];

  for (const document of state.documents) {
    try {
      const result = await ingestDocument(
        Buffer.from(document.contentBase64, "base64"),
        document.filename,
        document.type
      );

      if (result.status === "done") {
        const extracted = result.invoices && result.invoices.length > 0 ? result.invoices : [result.invoice];
        for (const inv of extracted) {
          invoices.push(invoiceFromIngestion(document, { ...result, invoice: inv }));
        }
      } else if (result.status === "bank_lines") {
        for (const line of result.lines) {
          bankLines.push({
            id: randomUUID(),
            date: line.date,
            description: line.description,
            amount: line.amount
          });
        }
      } else {
        errors.push({
          document_id: document.id,
          node: "ingestor",
          message: result.message || result.reason
        });
      }
    } catch (error) {
      errors.push({
        document_id: document.id,
        node: "ingestor",
        message: error instanceof Error ? error.message : "ingestor_unhandled_error"
      });
    }
  }

  const nextState: ChiffraGraphState = {
    ...state,
    invoices,
    bankLines,
    errors,
    status: "ingesting"
  };
  await saveGraphCheckpoint("ingestor", nextState);
  return nextState;
}

// Agent 2: Auditor Node
export async function auditorNode(state: ChiffraGraphState): Promise<Partial<ChiffraGraphState>> {
  const anomalies = auditInvoices(state.invoices, {
    fiscalPeriod: state.fiscalPeriod,
    vendorReferential: state.vendorReferential
  });
  const nextState: ChiffraGraphState = {
    ...state,
    anomalies,
    status: "auditing"
  };
  await saveGraphCheckpoint("auditor", nextState);
  return nextState;
}

// Agent 3: Reconciler Node
export async function reconcilerNode(state: ChiffraGraphState): Promise<Partial<ChiffraGraphState>> {
  const reconciliation = reconcileBankLines(state.invoices, state.bankLines);
  const nextState: ChiffraGraphState = {
    ...state,
    reconciliation,
    status: "reconciling"
  };
  await saveGraphCheckpoint("reconciler", nextState);
  return nextState;
}

// Agent 4: Explainer Node
export async function explainerNode(state: ChiffraGraphState): Promise<Partial<ChiffraGraphState>> {
  const anomalies: GraphAnomaly[] = [];
  const errors = [...state.errors];

  for (const anomaly of state.anomalies) {
    try {
      anomalies.push({
        ...anomaly,
        explanation: await explainAnomaly({
          invoice_id: anomaly.invoice_id,
          type: anomaly.type,
          description: anomaly.description,
          exposure_mad: anomaly.exposure_mad,
          severity: anomaly.severity
        })
      });
    } catch (error) {
      errors.push({
        node: "explainer",
        message: error instanceof Error ? error.message : "explainer_unhandled_error"
      });
      anomalies.push(anomaly);
    }
  }

  const nextState: ChiffraGraphState = {
    ...state,
    anomalies,
    errors,
    status: "explaining"
  };
  await saveGraphCheckpoint("explainer", nextState);
  return nextState;
}

// Agent 5: Orchestrator Node (Superviseur & Escalade stricte)
export async function orchestratorNode(state: ChiffraGraphState): Promise<Partial<ChiffraGraphState>> {
  const escalations: string[] = [];

  // 1. Traçabilité des documents non traités
  for (const err of state.errors) {
    escalations.push(`[${err.node.toUpperCase()}] Document ${err.document_id || 'N/A'}: ${err.message}`);
  }

  // 2. Isolation des anomalies critiques pour décision humaine
  const highAnomalies = state.anomalies.filter((a) => a.severity === "high");
  for (const a of highAnomalies) {
    escalations.push(`[ANOMALIE CRITIQUE] ${a.type}: ${a.description} (Exposition: ${a.exposure_mad} MAD)`);
  }

  const summary = {
    totalDocuments: state.documents.length,
    processedInvoices: state.invoices.length,
    bankLinesCount: state.bankLines.length,
    anomaliesCount: state.anomalies.length,
    matchRate: state.reconciliation?.match_rate ?? "0.00",
    unresolvedCount: state.reconciliation?.unmatched.length ?? 0,
    escalations
  };

  const nextState: ChiffraGraphState = {
    ...state,
    orchestrationSummary: summary,
    status: state.errors.length > 0 ? "partial" : "done"
  };
  await saveGraphCheckpoint("orchestrator", nextState);
  return nextState;
}

// ==========================================
// 4. CONSTRUCTION DU STATEGRAPH LANGGRAPH
// ==========================================
export const chiffraWorkflow = new StateGraph(ChiffraGraphAnnotation)
  .addNode("ingestor", ingestorNode)
  .addNode("auditor", auditorNode)
  .addNode("reconciler", reconcilerNode)
  .addNode("explainer", explainerNode)
  .addNode("orchestrator", orchestratorNode)
  .addEdge(START, "ingestor")
  .addEdge("ingestor", "auditor")
  .addEdge("auditor", "reconciler")
  .addEdge("reconciler", "explainer")
  .addEdge("explainer", "orchestrator")
  .addEdge("orchestrator", END);

export const chiffraGraph = chiffraWorkflow.compile();

export async function runChiffraGraph(
  input: Omit<ChiffraGraphState, "runId" | "status" | "invoices" | "anomalies" | "errors">
): Promise<ChiffraGraphState> {
  const initialState: ChiffraGraphState = {
    ...input,
    runId: randomUUID(),
    invoices: [],
    anomalies: [],
    errors: [],
    status: "pending"
  };
  await saveGraphCheckpoint("start", initialState);
  return chiffraGraph.invoke(initialState) as Promise<ChiffraGraphState>;
}
