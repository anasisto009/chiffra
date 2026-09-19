import type { ApiErrorBody } from "../types/api";

export const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(message: string, status: number, body: ApiErrorBody | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    const message = body?.message ?? body?.error ?? `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, body);
  }

  return response.json() as Promise<T>;
}

export function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, { ...init, method: "GET" });
}

export function apiPost<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  return request<T>(path, {
    ...init,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    },
    body: JSON.stringify(body)
  });
}

export function apiUpload<T>(path: string, formData: FormData, init?: RequestInit): Promise<T> {
  return request<T>(path, { ...init, method: "POST", body: formData });
}
