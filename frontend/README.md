# Grocy Next web client

The primary web client uses [Native Shell 0.4.0](https://nsh.dev/docs/web/), TSX signals,
and the NSH DOM/Wasm renderer. It has no React, npm runtime dependencies, or Vite.
The Python API remains an independent service.

The household overview, barcode workflows, batch processing and in-store shopping
take behavioral inspiration from [Grocy Android](https://github.com/patzly/grocy-android).
This is an independent NSH implementation; no Android source code or assets are copied.

Install the [NSH 0.4.0 distribution](https://nsh.dev/docs/installation/) and put `nsh`
on your PATH. Keep the distribution's runtime directory beside its bin directory.

Install the development-only lint and format tools from the repository root
using Node.js 20.19+ or 22.12+ (mise pins Node 24):

```sh
npm ci
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
and [design specification](DESIGN.md). Desktop has a 224px navigation rail; phones
have four bottom destinations, with Overview, Batch and Settings in the header.
Editors open in side sheets with fixed submit controls.

- **Overview:** live stock and due-date counts, shopping-list and recipe counts,
  links to household work, and Purchase, Consume, Open and Inventory shortcuts.
- **Stock:** compact rows, relative due dates, urgency grouping, all-product search
  (including out-of-stock products), status/location/group filters, name/due/quantity
  sorting, one-tap use and transaction undo. Barcode entry opens a product or its
  purchase, consume, open or inventory editor. Product sheets contain opening,
  counts, moves, stock entries, shopping, editing and nutrition history.
- **Add purchase:** use an existing product or create one inline with its unit and
  location. Date shortcuts and a calendar replace typed dates. Leave the date blank
  for the product default; Add another supports unpacking several purchases.
- **Batch:** purchase, consume, open or count products one at a time using product
  selection or barcode lookup. Each confirmed booking saves immediately. Session
  history offers undo when the server returns a transaction; failed bookings retain
  the draft. Purchase supports dates and locations; consumption supports waste.
- **Shopping:** list-first checkboxes, checked items last, add-below-minimum, and one
  Put away action. Create, rename and delete lists; edit quantities and notes or
  remove individual items, with confirmation for deletion. Search matches products
  and notes. In-store mode enlarges checklist targets and reports collected items.
  Batch operations report individual failures and retain failed rows. Undo restores
  stock only; deleted shopping items are not recreated.
- **Meals:** previous/next week navigation, recipe search, meal scheduling, ingredient
  review, cooking confirmation and shopping for missing ingredients.
- **Chores:** one due-ordered list for tasks, recurring chores and batteries, with
  task creation, completion, undo, and an optional completed-task view.
- **Reviews:** pending nutrition changes appear from Stock. Compare current and
  proposed nutrients before approving; product sheets hold revision history.
- **Settings:** connection and secondary household records. Catalog creation, editing
  and confirmed deletion remain available here; freezer flags use a checkbox and
  recurring chore periods use named choices.

This client does not provide full Grocy Android or Grocy API screen parity.
Barcode input supports manual entry and connected keyboard-style scanners; it does
not access a camera. Shopping requires an active server connection: there is no
offline cache or queued synchronization. Dark/dynamic themes and
OpenFoodFacts/OpenBeautyFacts lookup are not implemented.

Administrative access/key management, file/photo uploads, rich-text editing,
custom fields/entities, stock journals/reports, advanced
recurrence and printing are available through the API but have no dedicated screens
here. HTML descriptions are shown as plain text; they are never inserted as HTML.

## Verification

Run these from the repository root:

```sh
npm run lint          # Oxlint: correctness and suspicious-code checks
npm run lint:fix      # apply safe fixes
npm run format        # Oxfmt: format frontend sources and tool configuration
npm run format:check  # read-only formatting check
mise run web:check    # lint, formatting check, and NSH type checking
mise run web:test     # NSH behavior tests
mise run web:build    # all frontend checks, then the production web package
```

Oxlint is pinned to 1.92.0 and Oxfmt to 0.77.0 in the root package lockfile. They
are development tools only. The linter understands NSH's `Each` global and does
not apply React rules to NSH components. Both tools exclude `frontend/generated`,
`.nsh`, and `dist`; generated API declarations retain their generator's format.
The hk hooks run lint before formatting on matching frontend files. `mise run
check` includes frontend checks, and `mise run fix` includes safe frontend fixes
and formatting alongside the Python tools.

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

## Android development on a USB phone

NSH 0.4.0's packaged Android app rejects plain HTTP by default. The development
packager adds a network security policy that permits HTTP only for `127.0.0.1`,
`localhost`, and `::1`. Other server addresses still require HTTPS. The standard
NSH release package is unchanged.

With Android SDK platform 35, build tools, a JDK, Python, and NSH on your PATH:

```sh
python scripts/package-android-dev.py
adb -s PHONE_SERIAL install -r 'frontend/.nsh/android/Grocy Next.apk'
adb -s PHONE_SERIAL reverse tcp:8000 tcp:8000
```

Start the Python API separately, then connect in the app using
`http://127.0.0.1:8000` and the seeded development key. USB reverse forwarding
makes the phone's loopback port reach the computer's API. Reapply it after
reconnecting the phone; it requires the USB connection and a running API.
For a remote installation, enter your HTTPS Grocy URL and its API key instead.

The script uses a development signing key under `frontend/.nsh/android/`; retain
that key to update the installed app without losing data. `--out` changes the
output directory; `--keystore` can reuse an existing Android debug key (alias
`androiddebugkey`, password `android`). It builds arm64, matching the connected
OnePlus. This is a development build, not a store-signed release. The custom
manifest targets the pinned NSH 0.4.0 activity and must be reviewed when updating
NSH; the script refuses apps with resource assets that would need merging.
