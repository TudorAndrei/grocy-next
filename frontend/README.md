# Grocy Next web client

The primary web client uses [Native Shell 0.4.0](https://nsh.dev/docs/web/), TSX signals,
and the NSH DOM/Wasm renderer. It has no React, npm runtime dependencies, or Vite.
The Python API remains an independent service.

Install the [NSH 0.4.0 distribution](https://nsh.dev/docs/installation/) and put `nsh`
on your PATH. Keep the distribution's runtime directory beside its bin directory.

```sh
nsh --version
nsh check frontend
nsh test frontend
nsh run frontend --target web --port 5173
nsh package frontend --target web -o frontend/dist
```

The last command writes a static website to `frontend/dist/Grocy Next/`. Serve the
whole directory, including its Wasm and ES modules, over HTTP(S). The web server
must serve `.wasm` as `application/wasm`. No Node server is needed in production.
The dev command prints its URL. Start the API separately with `mise run dev`.

At the connection screen, enter the API origin, optionally with its base path
(e.g. `https://example.com/grocy`), and an API key. The address must omit `/api`.
Only the address is persisted using NSH Storage; the API key lives in memory until
disconnect/reload. For the seeded demo, use `http://127.0.0.1:8000` and the development key
`dev-key`. The development-key button fills only the key, preserving your server URL. Production keys come from `grocy-cli init` or
an administrator. Serve both services over HTTPS for remote use.

## Containers

`docker compose up --build` builds the client with the pinned, checksum-verified
NSH toolchain and serves it through nginx at `http://localhost:8080`. Enter that
same origin as the server URL; nginx forwards `/api` to Python. With
`GROCY_BASE_PATH=/grocy`, enter `http://localhost:8080/grocy`. Static client files
are still served at `/`. The API remains directly available at port 8000 locally.
The NSH Linux release used by this Dockerfile requires an x86_64 build machine.

## Workflows

The client follows the task-first [design review](../docs/claude-client-design-review.md)
and [design specification](DESIGN.md). Desktop has a navigation rail; phones have four
bottom destinations. Editors open in side sheets with fixed submit controls.

- **Stock:** compact rows, relative due dates, urgency grouping, all-product search
  (including out-of-stock products), one-tap use and transaction undo. Product sheets
  contain opening, counts, moves, stock entries, shopping, editing and nutrition history.
- **Add purchase:** use an existing product or create one inline with its unit and
  location. Date shortcuts and a calendar replace typed dates. Leave the date blank
  for the product default; Add another supports unpacking several purchases.
- **Shopping:** list-first checkboxes, checked items last, add-below-minimum, and one
  Put away action. Batch operations report individual failures and retain failed rows.
  Undo restores stock only; deleted shopping items are not recreated.
- **Meals:** previous/next week navigation, recipe search, meal scheduling, ingredient
  review, cooking confirmation and shopping for missing ingredients.
- **Chores:** one due-ordered list for tasks, recurring chores and batteries, with
  task creation, completion, undo, and an optional completed-task view.
- **Reviews:** pending nutrition changes appear from Stock. Compare current and
  proposed nutrients before approving; product sheets hold revision history.
- **Settings:** connection and secondary household records. Catalog creation, editing
  and confirmed deletion remain available here; freezer flags use a checkbox and
  recurring chore periods use named choices.

This is the first NSH client, not full UI parity with every Grocy API operation.
Administrative access/key management, file/photo uploads, rich-text editing,
custom fields/entities, barcode camera scanning, stock journals/reports, advanced
recurrence and printing are available through the API but have no dedicated screens
here. HTML descriptions are shown as plain text; they are never inserted as HTML.

## Verification

`nsh test frontend` covers connection errors, credential lifetime, zero-stock search,
quick-use retry/undo, inline product creation, batch purchase failure recovery,
Settings editing/deletion, meal planning/cooking and household completion/undo. Run the same tests in a
browser with `nsh test frontend --target web --browser /path/to/chromium`.

`nsh check` generates `.nsh/types` and uses NSH's pinned TypeScript checker.
Build artifacts and declarations stay ignored. The container build also runs the
checker before packaging.

## Generated API types

The client includes `generated/server.d.ts`, generated from FastAPI's OpenAPI 3.1
document with pinned `openapi-typescript@7.13.0`. The nutrition screen uses these
schemas for proposals, current records and revisions. They are type-only imports:
NSH erases them from both the web bundle and native QuickJS bytecode.

After installing the backend dependencies and Node.js 22 or newer (with npm), run:

```sh
mise run web:types
mise run web:types:check
mise run web:check
```

Generation imports the Python app to describe its routes without starting the API
or opening the database. Node and the generator are development tools; the shipped
client still has no Node runtime or npm runtime dependencies. Normal client builds
use the checked-in declarations and do not run the generator. Do not hand-edit
generated declarations.

These declarations reflect the schema's current limits: several compatibility
routes parse bodies manually, and many responses are generic dictionaries. They
cannot yet replace every `Row` or provide fully typed request methods. The pinned
Grocy specification also has references that its runtime fills in; use the
server's `/api/openapi/specification` for that resolved compatibility document.
