# CloudSearch — Web

The frontend for **CloudSearch — "The Console"**: a precise, dense, keyboard-first
AWS documentation search terminal. Dark-first developer tool styled like an IDE
command palette fused with an observability dashboard.

Built with **Next.js 16 (App Router, Turbopack) + React 19 + TypeScript +
Tailwind CSS v4**, package manager **pnpm**.

## Quick start

```bash
# 1. Start the CloudSearch Go API first — it must be reachable on :8080.
#    From the repo root: see ../README.MD (e.g. `docker compose up` or `go run ...`).

# 2. Install deps and run the web app (from this web/ directory):
pnpm install
pnpm dev            # Next.js dev server on http://localhost:3000
```

Then open <http://localhost:3000>. The app proxies to the Go API at
`BACKEND_URL` (default `http://localhost:8080`) — **the Go API must be running**
or search/stats requests return a clean `502 { error }` with a Retry affordance.

## Prerequisites

- **Node.js** 18.18+ (tested on v25)
- **pnpm** 9+ (`corepack enable` or `brew install pnpm`)
- The **CloudSearch Go API** running on **`http://localhost:8080`**
  (exposes `POST /api/v1/search` and `GET /api/v1/stats`)

## Setup

```bash
pnpm install
# Optional: only needed if the Go API is NOT on the default :8080.
cp .env.local.example .env.local   # then edit BACKEND_URL
```

`BACKEND_URL` defaults to `http://localhost:8080`, so no `.env.local` is
required when the API runs on the default port.

## Scripts

```bash
pnpm dev      # dev server on http://localhost:3000
pnpm build    # production build (next build, Turbopack)
pnpm start    # serve the production build on :3000
pnpm lint     # eslint
```

Type-check without emitting: `pnpm exec tsc --noEmit`.

## Architecture

The browser **never** calls the Go API directly (avoids CORS). All traffic is
proxied through Next.js **Route Handlers** running on the Node.js runtime:

| Browser request   | Proxy handler           | Upstream (Go API)        |
| ----------------- | ----------------------- | ------------------------ |
| `POST /api/search`| `app/api/search/route.ts` | `POST /api/v1/search`  |
| `GET /api/stats`  | `app/api/stats/route.ts`  | `GET /api/v1/stats`    |

- **Streaming search** (`stream: true`): the upstream **SSE** body is piped
  through unchanged with `Content-Type: text/event-stream`, `Cache-Control:
  no-cache`, and `X-Accel-Buffering: no` so tokens flush live. The client uses
  `fetch` + a `ReadableStream` reader with a hand-written SSE parser (not
  `EventSource`, which cannot POST).
- **Non-stream search** (`stream: false`): JSON is passed through verbatim.
- If the upstream is unreachable the proxy returns a clean `502 { error }`.

The backend base URL comes from `process.env.BACKEND_URL` (default
`http://localhost:8080`) — see `lib/config.ts`.

## Project layout

```
app/
  layout.tsx            App shell: fonts (next/font), TopBar, footer, theme bootstrap
  globals.css           Design system — color tokens, type scale, animations (Tailwind v4 @theme)
  page.tsx              Search experience (/) — wrapped in <Suspense> for useSearchParams
  stats/page.tsx        Index statistics page (/stats)
  api/
    search/route.ts     POST proxy (SSE pass-through + non-stream JSON)
    stats/route.ts      GET proxy (briefly revalidated)
components/
  TopBar.tsx            Fixed 56px top bar: wordmark, nav, ⌘K hint, theme toggle
  ThemeToggle.tsx       Dark/light toggle (dark default, persisted to localStorage)
  ui/                   Reusable primitives: Button, Card, Badge, Spinner, Kbd
  search/               SearchBar, AnswerView, Citation chip/card/list, ResultMeta,
                        ServiceFilterChips, TopKStepper, StreamToggle, states, …
  stats/                StatsDashboard, ServiceTable (sortable), StatCard
lib/
  types.ts              API DTOs mirroring the Go contract (snake_case keys)
  config.ts             BACKEND_URL + API prefix (server-only)
  utils.ts              cn(), serviceColor(), scoreHeatColor(), formatScore(), relativeTime()
  services.ts           The 20 seeded AWS service ids (filter chips)
  useSearchStream.ts    Client hook: POST /api/search + incremental SSE parsing
```

Navigation: the **Stats** per-service table deep-links into the search page via
`/?services=<id>`, which `app/page.tsx` reads with `useSearchParams` (inside a
`<Suspense>` boundary, as Next.js 16 requires for statically prerendered routes)
to prefill the service filter.

## Design system

Tokens live as CSS variables in `app/globals.css` and are bridged to Tailwind
utilities via `@theme inline` (e.g. `bg-app`, `bg-panel`, `text-muted`,
`border-hairline`, `text-accent`, `text-cyan`). Dark is default; the light theme
is an inversion mapped through identical token names via `[data-theme="light"]`.

- **Fonts** (loaded via `next/font`, self-hosted): **Hanken Grotesk** (UI/prose),
  **JetBrains Mono** (query input, ids, scores, metadata, `[N]` citation markers).
  The display/wordmark face is Hanken Grotesk at 700 — the spec-sanctioned
  fallback for Clash Grotesk. To use Clash Grotesk, drop its `woff2` into
  `app/fonts/` and replace the `--font-display` instance in `app/layout.tsx`
  with a `next/font/local` definition.

## Environment variables

| Variable               | Default                  | Notes                                  |
| ---------------------- | ------------------------ | -------------------------------------- |
| `BACKEND_URL`          | `http://localhost:8080`  | Go API base URL (server-side only)     |
| `NEXT_PUBLIC_BUILD_TAG`| `v0.1.0`                 | Build tag shown in the top bar/footer  |
