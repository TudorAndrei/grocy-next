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

Task and battery actions also use the pinned controllers and services. The
included `Users/User.php` and `PermissionMissingException.php` retain their
permission checks. A request-specific worker sets Grocy's current user constant.
The adapter supplies the application connection to the native database service.

`UsersApiController` now handles user, permission, and setting requests. The
adapter supplies the configured default permission names and pinned setting
defaults. Request parsing, password hashes, write order, and PHP array keys
remain in the original controller and user service.
