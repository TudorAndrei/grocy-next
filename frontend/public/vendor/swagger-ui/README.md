# Native API browser runtime

These files are copied unchanged from Grocy 4.5.0, commit
`21aa5eab218c8466f90729154cb293fffbe10c21`, under
`public/packages/swagger-ui-dist/`:

- `swagger-ui-bundle.js` (Swagger UI 5.20.2)
- `swagger-ui-standalone-preset.js`
- `swagger-ui.css`
- `LICENSE` and `NOTICE` (Apache 2.0)

`SHA256SUMS` records their exact bytes. Source maps, duplicate JavaScript builds,
OAuth-only resources and package installation files are omitted. Do not format
or lint the copied runtime files.

`index.html`, `grocy.css` and `grocy-initializer.js` are application integration
files. They reproduce the pinned `openapiui` configuration inside an isolated
iframe. The parent supplies the authenticated specification URL and connection
key through a same-origin, source-checked message. Only the specification request
receives that connection key automatically; Swagger's Authorize dialog controls
operation credentials. The external specification validator is disabled.
