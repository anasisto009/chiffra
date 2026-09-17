import Decimal from "decimal.js";

export const CURRENCY = "MAD";

export const AGENT_IDS = [
  "ingestor",
  "reconciler",
  "auditor",
  "explainer"
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export type AgentDefinition = {
  id: AgentId;
  label: string;
  responsibility: string;
};

export function toDecimal(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

export function formatMad(value: Decimal.Value): string {
  return `${toDecimal(value).toFixed(2)} ${CURRENCY}`;
}

