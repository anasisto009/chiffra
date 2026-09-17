import { EventEmitter } from "node:events";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../config.js";

export type IngestionJobData = {
  documentId: string;
  filename: string;
  mimeType?: string;
  contentBase64: string;
};

export type IngestionProgressEvent = {
  documentId: string;
  filename: string;
  status: "queued" | "processing" | "done" | "non_traite";
  reason?: string;
};

export const ingestionEvents = new EventEmitter();

export const ingestionRedisConnection = new IORedis(env.redisUrl, {
  maxRetriesPerRequest: null
});

export const ingestionQueue = new Queue<IngestionJobData>("document-ingestion", {
  connection: ingestionRedisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 1000
    },
    removeOnComplete: 1000,
    removeOnFail: 1000
  }
});

export function publishIngestionProgress(event: IngestionProgressEvent): void {
  ingestionEvents.emit("progress", event);
}

