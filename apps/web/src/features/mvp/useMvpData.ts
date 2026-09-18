import { useQuery } from "@tanstack/react-query";
import { mockAnomalies, mockDocuments, mockMetrics } from "./mockData";

const mockRequest = <T,>(value: T): Promise<T> => Promise.resolve(value);

export function useMockDocuments() {
  return useQuery({
    queryKey: ["mvp", "documents"],
    queryFn: () => mockRequest(mockDocuments),
    staleTime: Infinity
  });
}

export function useMockMetrics() {
  return useQuery({
    queryKey: ["mvp", "metrics"],
    queryFn: () => mockRequest(mockMetrics),
    staleTime: Infinity
  });
}

export function useMockAnomalies() {
  return useQuery({
    queryKey: ["mvp", "anomalies"],
    queryFn: () => mockRequest(mockAnomalies),
    staleTime: Infinity
  });
}
