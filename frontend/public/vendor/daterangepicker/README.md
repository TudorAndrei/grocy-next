# Legacy date range picker

The JavaScript files come unchanged from Grocy 4.5.0, commit
`21aa5eab218c8466f90729154cb293fffbe10c21`.

- `jquery.min.js`: `public/packages/jquery/dist/jquery.min.js` (jQuery 3.7.1).
- `daterangepicker.js`: `public/packages/daterangepicker/daterangepicker.js` (Date Range Picker 3.1).

Both MIT licenses are included. The application supplies its existing Moment
library. These scripts load only when the report date range control is mounted.
Do not format or lint the copied JavaScript. The source stylesheet is adapted
in `src/styles/date-range-picker.css` to use the application theme.
