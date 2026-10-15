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
