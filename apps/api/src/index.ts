import cors from "@fastify/cors";
import Fastify from "fastify";
import { agents } from "./agents/index.js";
import { env } from "./config/env.js";

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true
});

app.get("/health", async () => ({
  status: "ok",
  service: "chiffra-api"
}));

app.get("/agents", async () => ({
  agents
}));

app.get("/rules", async () => ({
  calculationPolicy: "LLM orchestration only. Monetary calculations run in TypeScript with decimal.js.",
  currency: "MAD",
  databaseAmountType: "numeric"
}));

await app.listen({
  host: env.host,
  port: env.port
});

