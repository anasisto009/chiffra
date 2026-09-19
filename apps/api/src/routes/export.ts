import type { FastifyInstance } from "fastify";
import { buildTvaExport, tvaExportToCsv } from "../services/tvaExport.js";

export async function registerExportRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { format?: "json" | "csv" } }>("/api/export/tva", async (request, reply) => {
    const exportData = await buildTvaExport();

    if (request.query.format === "csv") {
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", "attachment; filename=\"chiffra-tva-export.csv\"")
        .send(tvaExportToCsv(exportData));
    }

    return exportData;
  });
}

