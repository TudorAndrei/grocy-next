# Included library

`htmlpurifier` contains the unmodified HTMLPurifier 4.18.0 runtime library from
the checksum-verified Grocy 4.5.0 release. `ORIGIN.json` records its source commit
and each included file checksum. The library uses LGPL-2.1-or-later. Its license,
credits, and version are included with the source.

The backend runs this library through a PHP worker to keep Grocy's HTML and CSS
processing rules. The full runtime library is included because its autoloader
selects classes from the input and configuration at runtime.

The request runtime also includes Grocy's pinned Slim HTTP and PSR-7 packages,
their HTTP interfaces and helpers, and LessQL. Their source files are unchanged.
Each package includes its license, source revision, and file checksums in
`ORIGIN.json`. The runtime uses native PHP 8.1 or later functions, so it does not
need the PHP 8.0 polyfill package.

Slim parses request bodies. LessQL compiles permission writes with the same PDO
quoting and relation rules as Grocy. A query callback stops the query before
execution. The Python backend executes that statement against its own database.
The PHP worker has only a private memory database for PDO quoting.

Generic object and custom field writes pass raw request bodies to Grocy's
unchanged `BaseApiController`. It parses and filters each body before LessQL
uses its PHP values. `slim-framework` contains the pinned `HttpException` class
and its license. This class keeps native Content-Type errors and status codes.

List and stock reads also use the pinned Grocy controllers and services. The
adapter supplies the application connection. The original database service
retains its raw SQL calls and grouped object fetches for stock responses.

File requests use the unchanged Grocy file controller and service. The pinned
Gumlet PHP Image Resize 2.0.4 source and MIT license are in `gumlet-image-resize`.
PHP GD creates the image bytes. The adapter selects the configured storage root
and supplies HTTP streams. The native code retains file name checks, upload
chunk rules, image parameters, cache names, and cache deletion.

Task, battery, and chore actions also use the pinned controllers and services. The
included `Users/User.php` and `PermissionMissingException.php` retain their
permission checks. A request-specific worker sets Grocy's current user constant.
The adapter supplies the application connection to the native database service.
It forwards raw SQL and transaction commands. A private PDO database keeps the native
transaction state, including the different implicit rollback rules in PHP 8.3 and 8.4.
Its native triggers also permit SQL preparation for writes through native views.

`UsersApiController` now handles user, permission, and setting requests. The
adapter supplies the configured default permission names and pinned setting
defaults. Request parsing, password hashes, write order, and PHP array keys
remain in the original controller and user service.

Recipe and shopping actions run the pinned controllers and services. The adapter forwards
prepared raw SQL and retains its insert IDs. Recipe copy uses the original localization
service, Gettext 4.8.12, Languages 2.12.1, and the release's English translation files.
Recipe output labels use the original Grocycode and webhook helpers. Guzzle 7.9.3,
Promises 2.2.0, PSR-7 2.7.1, HTTP Client 1.0.3, and Deprecation Contracts 3.5.1 supply
its native HTTP behavior. Each included package has its license and checksums.

Stock bookings, inventory, entry edits, opening, transfers, merges, barcode actions,
read operations, and undo now use the original stock controller and service.
All five label endpoints use their original controllers and the pinned webhook code.
The adapter applies the existing nutrition cleanup to raw product deletion inside
Grocy's transaction. This prevents local extension constraints from blocking native merges.

Calendar requests use the original calendar controller, calendar service, API key service,
and URL manager. The release's eluceo/iCal 2.14.0 runtime and MIT license are included.
The adapter supplies the request base URL and application connection. The original code
retains event IDs, date parsing, escaping, line folding, time zones, and shared key selection.
Responses with a disposition header retain their content type, as in JsonMiddleware.

Thermal printing uses the original print controller and service with the release's
mike42/escpos-php 4.0 and gfx-php 0.6 source files, capability data, and licenses.
The adapter supplies the native printer settings and application connection.
The original code formats shopping rows and writes ESC/POS commands through its
file or network connector. Query parsing, permission order, encoding, and errors
remain in the unchanged source.
