# Native Calendar runtime

Copied unchanged from pinned Grocy 4.5.0 commit `21aa5eab218c8466f90729154cb293fffbe10c21` under `public/packages/`: FullCalendar 3.10.5, jQuery 3.7.1, Moment, Bootstrap 4.6.2 and Font Awesome Free 6.7.2. `SHA256SUMS` records the copied bytes; bundled license files retain upstream terms. No source maps or unused FullCalendar plugins are included.

`index.html`, `grocy.css` and `grocy-initializer.js` isolate the native runtime from the React application. The authenticated parent supplies the native event snapshot and translated component locales. First responsive view change uses the outer page viewport; the library still owns all view/date parsing and rendering.
