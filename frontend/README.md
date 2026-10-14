# Grocy Next frontend

React + Vite + TypeScript UI for the Grocy Next nutrition extension. Uses TanStack Router and TanStack Query.

## Prerequisites

- Node.js 20+
- Backend running at `http://127.0.0.1:8000` (or configure API base in Connection)

## Setup

```bash
cd frontend
pnpm install
cp .env.example .env
```

Set `VITE_API_KEY` to match your backend API key. Leave `VITE_API_BASE` empty to use the dev proxy.

## Development

```bash
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173). Requests to `/api/*` are proxied to the backend.

## Build

```bash
pnpm build
pnpm preview
```

## Routes

| Path | Purpose |
|------|---------|
| `/products` | Product list (`GET /api/objects/products`) |
| `/products/:id` | Nutrition, proposals, revisions |
| `/reviews` | Approve pending nutrition proposals |
| `/settings` | API base URL and `GROCY-API-KEY` (localStorage overrides env) |
