/**
 * Server-side configuration. Only read inside Route Handlers (Node runtime);
 * never import into client components.
 */

/** Base URL of the Go API. The browser must NOT use this directly. */
export const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

/** Upstream API path prefix on the Go server. */
export const API_PREFIX = "/api/v1";
