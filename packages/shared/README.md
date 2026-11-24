# @kinetic/shared

Code shared by the web app (`web/`) and the mobile app (`mobile/`): everything except the UI.
Change it here and both apps follow.

Both apps import it as `@kinetic/shared/<module>`, e.g. `@kinetic/shared/format`. It is not an
npm package or workspace: each app maps the name to `packages/shared/src` itself (web:
`vite.config.ts` and `tsconfig.app.json`; mobile: `metro.config.js` and `tsconfig.json`).

## What is here

| Module | What |
| --- | --- |
| `types`, `api`, `stream` | API types, the fetch client each app configures, and the parser for streamed progress |
| `format`, `time`, `speed`, `graphs`, `training`, `performance`, `topMetrics` | Formatting and calculations |
| `navigation` | The pages, their icons and paths (the routes in both apps) |
| `activityList` | Totals and month groups of the activity list |
| `trainingPage` | Everything the Training page computes, its captions and toggled charts |
| `powerStats` | FTP estimates and weight for the power section |
| `forms` | Form values and request payloads for activities and race results |
| `routeMap` | How a route is coloured (by speed or per multisport leg) and its legend |
| `streamIndex` | Finding the stream point at a distance |
| `zip` | Reading a ZIP directory through a byte-range reader each app supplies |
| `stravaImport` | Strava export: which files to send, `activities.csv` details and the upload runner |
| `charts/theme` | Plotly light/dark styling applied by both apps before drawing |
| `charts/graphsPage` | The Graphs page as a registry of charts with their controls |
| `charts/activity`, `charts/training`, `charts/power`, `charts/races`, `charts/records` | The Plotly chart builders of the other pages |

## Rules

- **Plain TypeScript only.** No DOM (`window`, `document`, `localStorage`), no React Native, no
  UI libraries. Anything platform-specific goes in the app and is passed in, like
  `onUnauthorized` in `createApiClient`.
- **No runtime dependencies.** The folder has no `node_modules`; only type imports are allowed
  (`import type … from 'plotly.js-dist-min'`), which each app resolves to its own copy.

## Charts

The chart builders return a Plotly `[traces, layout]` pair; the web app draws it with
plotly.js, the mobile app with the same plotly.js in a WebView, both after `themedChart`.

`charts/graphsPage.ts` goes one step further: it lists the charts on the Graphs page
(`GRAPHS_PAGE`) with their controls, and both apps render the list in order, so adding,
removing or reordering a chart there changes both apps. Other pages can be turned into such a
registry the same way.

## Tests

The calculations and formatting here have unit tests in `test/`, run with
[Vitest](https://vitest.dev):

```bash
cd packages/shared
npm ci
npm test            # once; `npm run test:watch` reruns on changes
npm run typecheck   # type-checks the tests
```

`package.json` in this folder only holds that test tooling; the apps still import `src/`
directly. Tests run in the `Europe/Brussels` time zone (set in `vitest.config.ts`), because API
dates are read as local time and a zone with daylight saving time catches 23- and 25-hour-day
bugs. `test/factories.ts` builds API objects with neutral defaults, so a test only names the
fields it is about. CI runs them on every pull request and before every deploy
(`.github/workflows/ci.yml`).
