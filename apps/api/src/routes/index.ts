import type { FastifyInstance } from "fastify";
import { registerAnomalyRoutes } from "./anomalies.js";
import { registerDocumentRoutes } from "./documents.js";
import { registerReviewRoutes } from "./review.js";
import { registerStatsRoutes } from "./stats.js";
import { registerUploadRoutes } from "./upload.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await registerUploadRoutes(app);
  await registerDocumentRoutes(app);
  await registerAnomalyRoutes(app);
  await registerReviewRoutes(app);
  await registerStatsRoutes(app);
}
