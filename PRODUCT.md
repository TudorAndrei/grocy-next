# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **The owner (human).** One self-hoster running Grocy Next for their own household. Uses the web UI on a phone in the kitchen and at the shop, and on a desktop for planning and bulk edits — both equally.
- **The owner's agent (via MCP).** An external assistant connected through FastMCP. It reads state and proposes or performs changes (nutrition, stock, shopping) under the same auth and validation as the UI. The web UI must make agent-originated changes visible and reviewable.

## Product Purpose

Grocy Next is a Grocy-compatible household management server (FastAPI + FastMCP + React/TanStack) with a nutrition extension. The web UI is meant to be a **full Grocy replacement**: every Grocy workflow should eventually be operable from it. Success: the owner never needs to open the original Grocy UI, and anything the agent did can be seen, checked, and undone.

## Positioning

Intelligence lives outside the server. There is no embedded agent, OCR, or vision model; external MCP assistants interpret inputs and call deterministic domain tools. The UI is therefore both a manual control surface and the human review layer for agent work (propose → review → commit, with revisions and undo).

## Operating Context

- Kitchen (phone, one hand, quick consume/open/purchase), shop (phone, shopping list checkoff), desk (desktop, product setup, recipes, nutrition review).
- Agent works asynchronously; the owner returns to pending proposals and booking history.
- Grocy v4.5.0 OpenAPI is the compatibility baseline (`contracts/grocy.openapi.json`).

## Capabilities and Constraints

- Current: API-key auth; products; stock purchase/consume/open/transfer/inventory/undo; quantity unit conversions; shopping lists; recipes (fulfillment, consume, missing → shopping list, nestings); chores (execute/undo), tasks (complete), batteries (charge/undo); nutrition propose → review → commit + revisions; settings for API base and key.
- Later (not built): meal plans, equipment, calendar, files, full client parity. Design must leave room for these sections.
- Stack: React 19, Vite, TypeScript, TanStack Router + Query, plain CSS (`frontend/src/styles/global.css`). No component library.
- Terminology follows Grocy: product, stock, best-before date, quantity unit, location, chore, battery, recipe.

## Brand Commitments

- Name: "Grocy Next". The current text wordmark is not binding (owner not attached to it).

## Evidence on Hand

- No real screenshots, testimonials, or marketing assets. Demo data only (demo API key `dev-key`).

## Product Principles

1. Grocy parity first: a Grocy user finds every familiar workflow.
2. Agent work is never invisible: show source, pending state, and an undo path.
3. Fast on a phone, dense on a desktop: the same task works one-handed and in bulk.
4. Deterministic and honest: show the actual stored amounts, units, and dates; no guessed values.
