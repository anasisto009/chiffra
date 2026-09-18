import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { randomUUID } from "node:crypto";
import { auditInvoices, type AuditAnomaly, type AuditInvoice, type VendorReference } from "./auditor.js";
import { explainAnomaly, type AnomalyExplanation } from "./explainer.js";
import { ingestDocument, type IngestorResult } from "./ingestor.js";
import {
  reconcileBankLines,
  type ReconciliationBankLine,
  type ReconciliationResult
} from "./reconciler.js";
import { config } from "../config.js";
import { pool } from "../db/client.js";

export type OrchestratorDocument = {
  id: string;
  filename: string;
  type: string;
  contentBase64: string;
};

export type OrchestratorInvoice = AuditInvoice & {
  document_id: string;
};

export type OrchestratorAnomaly = AuditAnomaly & {
  explanation?: AnomalyExplanation;
};

export type OrchestratorState = {
  runId: string;
  documents: OrchestratorDocument[];
  invoices: OrchestratorInvoice[];
  bankLines: ReconciliationBankLine[];
  anomalies: OrchestratorAnomaly[];
  reconciliation?: ReconciliationResult;
  errors: Array<{ document_id?: string; node: string; message: string }>;
  status: "pending" | "ingesting" | "auditing" | "reconciling" | "explaining" | "done" | "partial";
  fiscalPeriod: string;
  vendorReferential: VendorReference[];
};

const OrchestratorAnnotation = Annotation.Root({
  runId: Annotation<string>(),
  documents: Annotation<OrchestratorDocument[]>(),
  invoices: Annotation<OrchestratorInvoice[]>(),
  bankLines: Annotation<ReconciliationBankLine[]>(),
  anomalies: Annotation<OrchestratorAnomaly[]>(),
  reconciliation: Annotation<ReconciliationResult | undefined>(),
  errors: Annotation<Array<{ document_id?: string; node: string; message: string }>>(),
  status: Annotation<OrchestratorState["status"]>(),
  fiscalPeriod: Annotation<string>(),
  vendorReferential: Annotation<VendorReference[]>()
});

export const orchestrationModel = config.llm.model;

async function saveCheckpoint(node: string, state: OrchestratorState): Promise<void> {
  await pool.query(
    `INSERT INTO orchestration_checkpoints (run_id, node, state)
     VALUES ($1, $2, $3::jsonb)`,
    [state.runId, node, JSON.stringify(state)]
  );
}

function invoiceFromIngestion(
  document: OrchestratorDocument,
  result: Extract<IngestorResult, { status: "done" }>
): OrchestratorInvoice {
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

async function ingestorNode(state: OrchestratorState): Promise<Partial<OrchestratorState>> {
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

  const nextState: OrchestratorState = {
    ...state,
    invoices,
    bankLines,
    errors,
    status: "ingesting"
  };
  await saveCheckpoint("ingestor", nextState);
  return nextState;
}

async function auditorNode(state: OrchestratorState): Promise<Partial<OrchestratorState>> {
  const anomalies = auditInvoices(state.invoices, {
    fiscalPeriod: state.fiscalPeriod,
    vendorReferential: state.vendorReferential
  });
  const nextState: OrchestratorState = {
    ...state,
    anomalies,
    status: "auditing"
  };
  await saveCheckpoint("auditor", nextState);
  return nextState;
}

async function reconcilerNode(state: OrchestratorState): Promise<Partial<OrchestratorState>> {
  const reconciliation = reconcileBankLines(state.invoices, state.bankLines);
  const nextState: OrchestratorState = {
    ...state,
    reconciliation,
    status: "reconciling"
  };
  await saveCheckpoint("reconciler", nextState);
  return nextState;
}

async function explainerNode(state: OrchestratorState): Promise<Partial<OrchestratorState>> {
  const anomalies: OrchestratorAnomaly[] = [];
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

  const nextState: OrchestratorState = {
    ...state,
    anomalies,
    errors,
    status: errors.length > 0 ? "partial" : "done"
  };
  await saveCheckpoint("explainer", nextState);
  return nextState;
}

export const orchestratorGraph = new StateGraph(OrchestratorAnnotation)
  .addNode("ingestor", ingestorNode)
  .addNode("auditor", auditorNode)
  .addNode("reconciler", reconcilerNode)
  .addNode("explainer", explainerNode)
  .addEdge(START, "ingestor")
  .addEdge("ingestor", "auditor")
  .addEdge("auditor", "reconciler")
  .addEdge("reconciler", "explainer")
  .addEdge("explainer", END)
  .compile();

export async function runOrchestration(
  input: Omit<OrchestratorState, "runId" | "status" | "invoices" | "anomalies" | "errors">
): Promise<OrchestratorState> {
  const initialState: OrchestratorState = {
    ...input,
    runId: randomUUID(),
    invoices: [],
    anomalies: [],
    errors: [],
    status: "pending"
  };
  await saveCheckpoint("start", initialState);
  return orchestratorGraph.invoke(initialState) as Promise<OrchestratorState>;
}
