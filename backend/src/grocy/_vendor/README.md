# Included library

`htmlpurifier` contains the unmodified HTMLPurifier 4.18.0 runtime library from
the checksum-verified Grocy 4.5.0 release. `ORIGIN.json` records its source commit
and each included file checksum. The library uses LGPL-2.1-or-later. Its license,
credits, and version are included with the source.

The backend runs this library through a PHP worker to keep Grocy's HTML and CSS
processing rules. The full runtime library is included because its autoloader
selects classes from the input and configuration at runtime.
