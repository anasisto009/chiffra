function readInt(name: string, fallback: string): number {
  const parsed = Number.parseInt(process.env[name] ?? fallback, 10);

  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer env var: ${name}`);
  }

  return parsed;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  host: process.env.API_HOST ?? "0.0.0.0",
  port: readInt("API_PORT", "4000"),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://chiffra:chiffra@localhost:5432/chiffra",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379"
};

export const config = {
  runtime: env,
  llm: {
    baseURL: process.env.LLM_URL ?? "https://api.openai.com/v1",
    apiKey: process.env.LLM_API_KEY ?? "replace-me",
    model: process.env.LLM_MODEL ?? "gpt-5.5"
  },
  llmFast: {
    baseURL: process.env.AZURE_OPENAI_ENDPOINT ?? "https://example.cognitiveservices.azure.com/",
    apiKey: process.env.AZURE_OPENAI_API_KEY ?? "replace-me",
    model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME ?? "gpt-4.1",
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? "2024-12-01-preview",
    maxTokens: readInt("AZURE_OPENAI_MAX_TOKENS", "16384")
  },
  embedding: {
    model: process.env.EMBEDDING_MODEL ?? "embedder-small-3",
    dimensions: readInt("EMBEDDING_DIMENSIONS", "512")
  }
};
