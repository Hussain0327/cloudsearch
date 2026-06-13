/**
 * API DTOs for the CloudSearch Go backend (port 8080).
 *
 * These mirror the Go structs in api/internal/models/api.go EXACTLY,
 * including snake_case JSON keys. The browser never calls the Go server
 * directly; requests are proxied through Next.js Route Handlers
 * (app/api/search, app/api/stats) to avoid CORS.
 */

/** Input DTO for POST /api/v1/search. */
export interface SearchRequest {
  /** The natural-language query. Required, non-empty. */
  query: string;
  /** Number of chunks to retrieve. 1-20, defaults to 10 server-side. */
  top_k?: number;
  /** Optional service-id filter (e.g. ["s3", "lambda"]). */
  services?: string[];
  /** When true, the response is Server-Sent Events; defaults to false. */
  stream?: boolean;
}

/** A source chunk referenced in the answer via a 1-indexed [N] marker. */
export interface Citation {
  chunk_id: number;
  document_url: string;
  title: string;
  service_name: string;
  /** Hierarchy path, e.g. "S3 > Bucket Policies > Examples". */
  section_path: string;
  text: string;
  /** Fusion score (RRF). Heat-scaled in the UI. */
  score: number;
}

/** Timing and retrieval telemetry shown in the MetaStrip. */
export interface ResponseMetadata {
  query_time_ms: number;
  chunks_found: number;
  cache_hit: boolean;
  model: string;
}

/** Output DTO for the non-streaming POST /api/v1/search response. */
export interface SearchResponse {
  answer: string;
  citations: Citation[];
  metadata: ResponseMetadata;
}

/** Per-service document/chunk counts for GET /api/v1/stats. */
export interface ServiceStats {
  service_name: string;
  documents: number;
  chunks: number;
}

/** Output DTO for GET /api/v1/stats. */
export interface StatsResponse {
  total_documents: number;
  total_chunks: number;
  services: ServiceStats[];
  /** ISO 8601 timestamp of the last index build. */
  indexed_at: string;
}

/**
 * Discriminated union of parsed SSE events from the streaming search path.
 * Wire format per event: "event: <name>\n", optional "data: <payload>\n",
 * then a blank line "\n". The "done" event carries no data.
 */
export type SearchStreamEvent =
  | { type: "chunk"; data: string }
  | { type: "citations"; data: Citation[] }
  | { type: "metadata"; data: ResponseMetadata }
  | { type: "error"; data: string }
  | { type: "done" };

/** Shape returned by the proxy route handlers when upstream is unreachable. */
export interface ProxyError {
  error: string;
}
