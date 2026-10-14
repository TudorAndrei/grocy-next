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

## Development

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Requests to `/api/*` are proxied to the backend.

## Build

```bash
npm run build
npm run preview
```

## Routes

| Path | Purpose |
|------|---------|
| `/products` | Product list (`GET /api/objects/products`) |
| `/products/:id` | Nutrition, proposals, revisions |
| `/reviews` | Approve pending nutrition proposals |
| `/settings` | API base URL and `GROCY-API-KEY` (localStorage overrides env) |

The web application also has Today, Shopping, Meals, Recipes, Household, Equipment, Calendar, and Manage screens. Manage includes locations, stores, units, conversions, groups, custom records, users, and API keys. Equipment supports manual uploads and downloads. Nutrition proposals have numeric inputs and optional label photos.
