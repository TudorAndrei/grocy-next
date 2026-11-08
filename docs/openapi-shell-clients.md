# OpenAPI types for Native Shell clients

Research date: 2026-11-08. Scope: NSH 0.4.0 TSX clients and this repository’s API.

## Finding

Generate TypeScript declarations from OpenAPI and retain the existing fetch transport for now. NSH documents a global `fetch` for TSX on native platforms and web, with `Request`, `Response`, headers, cancellation, and other Fetch companions. Its native implementation uses platform networking; web uses browser networking. Consequently, type generation fits the current client without introducing another runtime transport. This is a compatibility inference supported by the completed local type-generation experiment, not proof that every fetch-based SDK works natively. [NSH networking](https://nsh.dev/docs/networking/), [current transport](../frontend/api.ts).

`openapi-typescript` supports OpenAPI 3.0/3.1 and produces runtime-free types, including `paths` and `components`. Node runs during generation; it need not ship with the NSH application. Types describe declared contracts and do not validate incoming JSON at runtime. The existing `request<T>()` still casts decoded data to the caller’s selected type, so a mismatched URL and type can pass compilation. [Generator introduction](https://openapi-ts.dev/introduction), [transport implementation](../frontend/api.ts).

## What the local experiment established

The parent task’s completed checks established the following; this note does not claim to have rerun them:

- Exporting `grocy.main.create_app().openapi()` produced OpenAPI 3.1 with 163 paths and 53 schemas. `openapi-typescript@7.13.0` generated `/tmp/grocy-server.d.ts`; the resulting declarations are now in [frontend/generated/server.d.ts](../frontend/generated/server.d.ts).
- [scripts/generate-client-types.sh](../scripts/generate-client-types.sh) exports the schema without application startup or database access, pins the generator version, and supports `--check`. Its freshness check passed. The upstream CLI documents local/remote schema inputs and the generated-file check. [CLI documentation](https://openapi-ts.dev/cli).
- [Nutrition.tsx](../frontend/screens/Nutrition.tsx) consumes generated proposal, nutrition-record, and revision types. `nsh check`, four tests, and web packaging passed. These demonstrate an initial integration, not native transport verification.
- Direct generation from [contracts/grocy.openapi.json](../contracts/grocy.openapi.json) failed on unresolved `ExposedEntity_*` references. Fetching the authenticated `http://127.0.0.1:8000/api/openapi/specification` yielded `/tmp/grocy-resolved-compat.json`, from which `/tmp/grocy-compat.d.ts` generated successfully.

The last result has a source-level explanation: [SystemService.specification()](../backend/src/grocy/domains/system/service.py) copies the pinned contract, adds entity schemas dynamically, queries user-defined entities, and sets the server URL to the deployment’s `/api` location. That resolved document can therefore vary with installation data. Keep the pinned contract unchanged; it is not a standalone client-generation input in its current form.

## Schema limitations and URL alignment

The two documents serve different purposes. FastAPI describes registered Python routes, including v2 endpoints; the resolved compatibility document describes the legacy API. Successful generation does not make either a complete, precise client contract.

For example, [compatibility/objects.py](../backend/src/grocy/api/compatibility/objects.py) reads create/update bodies through `json_body(request)`, rather than a declared body model, and returns some reads as `Response`. FastAPI cannot infer those JSON shapes from these signatures. [compatibility/stock.py](../backend/src/grocy/api/compatibility/stock.py) includes generic dictionary results and raw responses, while [v2/shopping.py](../backend/src/grocy/api/v2/shopping.py) declares several `dict`/`list[dict]` results. Generated types preserve these gaps; changing generators cannot reconstruct missing fields.

Path spelling also matters. The compatibility contract uses `/objects/{entity}/{objectId}` beneath its `/api` server URL; Python exposes `/api/objects/{entity}/{object_id}`. These identify equivalent wire locations after substitution but different generated path keys and parameter names. The current transport concatenates a deployment base with paths already containing `/api`; [v2 registration](../backend/src/grocy/api/v2/__init__.py) adds `/api/v2`. A future client must choose one base/path convention to avoid duplicated or missing `/api` segments. [Pinned paths](../contracts/grocy.openapi.json), [Python routes](../backend/src/grocy/api/compatibility/objects.py).

## Client choices and next steps

Type-only generation preserves current API-key headers, timeout/cancellation, empty-response handling, and error messages, with incremental adoption. `openapi-fetch` would additionally infer method, path parameters, bodies, and results from `paths`; its path literals must exactly match the schema. It wraps fetch, making it a plausible next experiment. It has not been tested here. A full generated SDK could provide named endpoint methods, but adds generated runtime code and transport behavior to review; no full SDK was tested. [openapi-fetch documentation](https://openapi-ts.dev/openapi-fetch/), [existing behavior](../frontend/api.ts).

Before wider native adoption:

1. Define one documented client schema spanning required compatibility and v2 operations. Resolve references reproducibly, distinguish stable entities from installation-specific names, and document base URLs and parameter naming without editing the pinned upstream contract.
2. Describe missing request bodies and response models, prioritizing operations used by client screens. Keep the pinned generator and freshness check in CI.
3. Test actual transport behavior: API-key failures, deployment prefixes, encoded parameters, JSON/error variants, 204 responses, cancellation, and timeouts. Exercise native NSH and web separately: native capability grants and browser CORS differ. Then compare retaining the wrapper with an `openapi-fetch` spike. [NSH networking constraints](https://nsh.dev/docs/networking/).
