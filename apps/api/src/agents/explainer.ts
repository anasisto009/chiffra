import type { AgentDefinition } from "@chiffra/shared";
import { z } from "zod";
import { config } from "../config.js";
import { clientGPT41, clientGPT55 } from "../llm/clients.js";

export const explainerAgent: AgentDefinition = {
  id: "explainer",
  label: "Explainer",
  responsibility: "Transforme une anomalie en exposition MAD, justification et action recommandee."
};

export type ExplainableAnomaly = {
  id?: string;
  invoice_id: string;
  type: string;
  description: string;
  exposure_mad: string;
  severity: "low" | "medium" | "high";
  status?: "pending" | "validated" | "rejected";
};

export type AnomalyExplanation = {
  explanation_fr: string;
  action: string;
  priority: number;
};

const explanationSchema = z.object({
  explanation_fr: z.string().min(1),
  action: z.string().min(1),
  priority: z.number().int().min(1).max(5)
});

function needsComplexReasoning(anomaly: ExplainableAnomaly): boolean {
  return anomaly.severity === "high" || anomaly.type.includes("mismatch") || anomaly.type.includes("aberrant");
}

function parseJsonObject(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced?.[1] ?? content;
  return JSON.parse(jsonText);
}

function fallbackPriority(severity: ExplainableAnomaly["severity"]): number {
  if (severity === "high") {
    return 5;
  }

  if (severity === "medium") {
    return 3;
  }

  return 1;
}

export async function explainAnomaly(anomaly: ExplainableAnomaly): Promise<AnomalyExplanation> {
  const client = needsComplexReasoning(anomaly) ? clientGPT55 : clientGPT41;
  const model = needsComplexReasoning(anomaly) ? config.llm.model : config.llmFast.model;

  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Tu es l'agent Explainer de Chiffra. Explique en francais pourquoi l'anomalie est risquee et propose une action concrete. Ne recalcule jamais exposure_mad: traite ce montant comme un fait fourni par le systeme. Retourne seulement JSON: explanation_fr, action, priority."
      },
      {
        role: "user",
        content: JSON.stringify({
          anomaly,
          invariant: "exposure_mad is precomputed by TypeScript decimal.js and must not be recalculated"
        })
      }
    ]
  });

  const content = completion.choices[0]?.message.content;

  if (!content) {
    return {
      explanation_fr: anomaly.description,
      action: "Verifier la piece source et valider ou rejeter l'anomalie.",
      priority: fallbackPriority(anomaly.severity)
    };
  }

  const parsed = explanationSchema.safeParse(parseJsonObject(content));

  if (!parsed.success) {
    return {
      explanation_fr: anomaly.description,
      action: "Verifier la piece source et valider ou rejeter l'anomalie.",
      priority: fallbackPriority(anomaly.severity)
    };
  }

  return parsed.data;
}
