# Product

## Platform

Python HTTP API and MCP server. Independent clients provide the user interface.

## Users

- **The owner.** A self-hoster managing household stock, shopping, recipes and recurring work through a client of their choice.
- **Client developers.** Build interfaces against the Grocy-compatible API and its documented extensions. Future cross-platform client work will use [Native Shell](https://nsh.dev/).
- **External assistants.** Connect through FastMCP to read state and propose or perform changes under the API's authentication and validation rules.

## Product Purpose

Grocy Next is a Grocy-compatible household management API built with FastAPI, SQLite and FastMCP, with a nutrition extension. API parity is the core completion target. Clients can expose the same stored state and workflows without depending on a bundled web application.

## Positioning

Intelligence lives outside the server. There is no embedded agent, OCR or vision model; external MCP assistants interpret inputs and call deterministic domain tools. The API supports proposal review, commit, revisions and undo so clients can make changes visible and reviewable.

## Operating Context

- Clients serve kitchen, shopping and desktop planning workflows using the same API.
- Assistants can work asynchronously; pending proposals and booking history remain available for review.
- Grocy v4.5.0 OpenAPI is the compatibility baseline (`contracts/grocy.openapi.json`).

## Capabilities and Constraints

- The Python API implements the pinned 86 Grocy operations and 33 listable entities, including stock, recipes, shopping, meal plans, chores, tasks, batteries, equipment, calendars, files and access management.
- Additional API and MCP capabilities support nutrition proposals, review, commit and revision history.
- The previous React/TanStack frontend and GitHub Actions CI have been removed. Python tests and local verification tools remain available.
- The finite API acceptance scope and certification results are recorded in [API parity status](docs/api-parity-status.md).
- Terminology follows Grocy: product, stock, best-before date, quantity unit, location, chore, battery, recipe.

## Brand Commitments

- Name: "Grocy Next". Client branding and visual design will be decided with the new client.

## Evidence on Hand

- Pinned Grocy 4.5.0 API contract, Python regression tests and differential comparisons against the original PHP implementation.
- Optional demo data uses the development API key `dev-key`.

## Product Principles

1. API parity first: preserve the pinned Grocy HTTP and state behavior.
2. Independent clients: keep business logic and persistent state in the API.
3. Reviewable changes: retain proposal sources, pending state, history and undo behavior.
4. Deterministic results: return actual stored amounts, units and dates.
