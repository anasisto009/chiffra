import { auditorAgent } from "./auditor.js";
import { explainerAgent } from "./explainer.js";
import { ingestorAgent } from "./ingestor.js";
import { reconcilerAgent } from "./reconciler.js";

export const agents = [
  ingestorAgent,
  reconcilerAgent,
  auditorAgent,
  explainerAgent
] as const;

