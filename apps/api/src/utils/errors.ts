import type { FastifyInstance } from "fastify";

export type ApiErrorShape = {
  error: string;
  document_id?: string;
  reason: string;
};

export function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : "unknown_error";
}

export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    app.log.error({ error }, "request_failed");
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const payload: ApiErrorShape = {
      error: statusCode >= 500 ? "internal_error" : "request_error",
      reason: error.message
    };
    reply.code(statusCode).send(payload);
  });
}

