import OpenAI from "openai";
import { config } from "../config.js";

export const clientGPT55 = new OpenAI({
  baseURL: config.llm.baseURL,
  apiKey: config.llm.apiKey
});

export const clientGPT41 = new OpenAI({
  baseURL: `${config.llmFast.baseURL.replace(/\/$/, "")}/openai/deployments/${config.llmFast.model}`,
  apiKey: config.llmFast.apiKey,
  defaultQuery: {
    "api-version": config.llmFast.apiVersion
  },
  defaultHeaders: {
    "api-key": config.llmFast.apiKey
  }
});

export const clientEmbeddings = new OpenAI({
  baseURL: config.llm.baseURL,
  apiKey: config.llm.apiKey
});

