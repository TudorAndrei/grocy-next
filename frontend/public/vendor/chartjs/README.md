# Legacy price chart

These files come unchanged from Grocy 4.5.0, commit
`21aa5eab218c8466f90729154cb293fffbe10c21`.

- `Chart.min.js`: `public/packages/chart.js/dist/Chart.min.js` (Chart.js 2.9.4).
- `chartjs-plugin-trendline.min.js`:
  `public/packages/chartjs-plugin-trendline/dist/chartjs-plugin-trendline.min.js`.

The matching licenses are included. The web app supplies its existing Moment
library before it loads Chart.js. Both files are loaded only for a nonempty price
history. Do not format or lint the copied source.
