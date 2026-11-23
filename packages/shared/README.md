# @kinetic/shared

Code shared by the web app (`web/`) and the mobile app (`mobile/`): API types, the API client,
formatting and calculations, and chart definitions.

Both apps import it as `@kinetic/shared/<module>`, e.g. `@kinetic/shared/format`. It is not an
npm package or workspace: each app maps the name to `packages/shared/src` itself (web:
`vite.config.ts` and `tsconfig.app.json`; mobile: `metro.config.js` and `tsconfig.json`).

## Rules

- **Plain TypeScript only.** No DOM (`window`, `document`, `localStorage`), no React Native, no
  UI libraries. Anything platform-specific goes in the app and is passed in, like
  `onUnauthorized` in `createApiClient`.
- **No runtime dependencies.** The folder has no `node_modules`; only type imports are allowed
  (`import type … from 'plotly.js-dist-min'`), which each app resolves to its own copy.

## Charts

`src/charts/graphsPage.ts` lists the charts on the Graphs page (`GRAPHS_PAGE`). Each entry
builds a Plotly chart from the page filters and data, and can declare its own controls (e.g.
weekly / monthly / yearly). Both apps render the list in order, so adding, removing or
reordering a chart there changes the web and mobile app together.

`src/charts/theme.ts` holds the Plotly light/dark styling both apps apply before drawing.

To share another page the same way, move its chart builders (e.g.
`web/src/components/training/charts.ts`) here as a registry and render it in both apps.
