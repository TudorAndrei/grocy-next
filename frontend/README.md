# Grocy Next frontend

React + Vite + TypeScript UI for Grocy Next household management. Uses TanStack Router and TanStack Query.

## Prerequisites

- Node.js 20+
- Backend running at `http://127.0.0.1:8000` (or configure API base in Connection)

## Setup

```bash
cd frontend
npm ci
cp .env.example .env
```

Set `VITE_API_KEY` to match your backend API key. Leave `VITE_API_BASE` empty to use the dev proxy.

To deploy under a path such as `/grocy/`, set `VITE_BASE_PATH=/grocy/` when you build or start Vite. Set `GROCY_BASE_PATH=/grocy` on the Python API. Page links, static files, API requests, and document downloads use this prefix. A saved connection URL or an explicit `VITE_API_BASE` has priority over the default API prefix.

For Docker Compose, set `GROCY_BASE_PATH=/grocy` and rebuild both services. Compose passes the path to the web build and the Python API. Open `/grocy/` on the web service.

## Development

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Requests to `/api/*` are proxied to the backend.

## Checks

```bash
npm run check
npm run lint:fix
npm run format
```

`check` runs Oxlint, Oxfmt, and TypeScript. Oxlint uses all generic rules from
[anti-slop](https://github.com/dmmulroy/anti-slop). The copied source, licenses,
and upstream revision are in `tools/oxlint/anti-slop`.
Generated routes and the copied plugin are excluded from lint and format checks.
Keep `oxlint` and `@oxlint/plugins` at the same exact version.

## Build

```bash
npm run build
npm run preview
```

## Routes

| Path            | Purpose                                                       |
| --------------- | ------------------------------------------------------------- |
| `/products`     | Product list (`GET /api/objects/products`)                    |
| `/products/:id` | Nutrition, proposals, revisions                               |
| `/reviews`      | Approve pending nutrition proposals                           |
| `/settings`     | API base URL and `GROCY-API-KEY` (localStorage overrides env) |

The web application also has Today, Shopping, Meals, Recipes, Household, Equipment, Calendar, and Manage screens. Manage includes locations, stores, units, conversions, groups, custom records, users, and API keys. Equipment supports manual uploads and downloads. Nutrition proposals have numeric inputs and optional label photos.
