# Kinetic mobile

Expo (React Native) app with all the pages of the web app: Activities (with adding, editing,
deleting and .fit uploads), activity details, Map, Graphs, Training, Best Efforts, Races,
Friends and Sync. Sync has a tab per platform: Garmin Connect (sign in and sync), Apple Watch
(the Health Auto Export token; the Health export.zip is imported on the website) and Strava
(import the archive zip, or many loose .fit/.gpx/.tcx files).

It shares everything except the UI with the web app through `packages/shared` (see its
README): data types, the API client, calculations, chart builders, route colouring, form
payloads and the navigation list. Charts are drawn by the same plotly.js as the web app inside
a WebView (`src/components/PlotView.tsx`), and maps by the same Leaflet and OpenStreetMap tiles
(`src/components/LeafletView.tsx`), so they look the same on both.

## Structure

- `src/app/`: the screens, with [Expo Router](https://docs.expo.dev/router/introduction/).
  The paths match the web routes: `/activity/[id]`, `/best-efforts/[distance]`,
  `/best-efforts/top/[metric]`, `/graphs`, … The tab bar has Activities, Map, Insights and More.
- `src/components/`: the mobile UI kit (`ui.tsx`), icons, charts, maps, tables and form sheets.
- `src/lib/`: the API client, data hooks, theme and session.

## Run

```powershell
cd mobile
npm install
npx expo start
```

Create `mobile/.env` with the web app's public origin (e.g. the Vercel domain):

```
EXPO_PUBLIC_KINETIC_URL=https://your-kinetic-domain.example
```

Then scan the QR code with Expo Go on your phone, or press `a` for an Android emulator.

## How it talks to the API

The app calls `<EXPO_PUBLIC_KINETIC_URL>/api/…` just like the browser does, so requests pass the
Vercel proxy (which adds the origin secret). It sends `Origin: <EXPO_PUBLIC_KINETIC_URL>` itself,
because the backend only accepts state-changing requests from that origin, and the session
cookie is kept by the phone's native cookie store. The Garmin sync and training analysis stream
their progress; the app reads those streams with XMLHttpRequest, as React Native's fetch cannot.

The Strava archive can be gigabytes (photos), so `src/lib/stravaExport.ts` never loads it whole:
`expo-file-system` reads only the zip directory and each activity file's bytes, `fflate`
inflates them (Hermes has no `DecompressionStream`), and each file is written to the cache and
uploaded by uri. The zip directory and `activities.csv` logic is shared with the web app
(`packages/shared/src/zip.ts`, `stravaImport.ts`).

A local backend on `http://localhost:5173` is not reachable from a phone, and the backend
accepts plain HTTP only for localhost origins. For testing, point `EXPO_PUBLIC_KINETIC_URL` at a
deployed instance (e.g. a Vercel preview), or use an Android emulator or USB phone with
`adb reverse tcp:5173 tcp:5173` and `EXPO_PUBLIC_KINETIC_URL=http://localhost:5173`.

## Checks

```powershell
npx tsc --noEmit
npx expo export --platform android
```

## Accessibility

Screen readers (VoiceOver, TalkBack) can use every control: tappable elements have a role and
a label (`IconButton` requires `label`), state such as selected, checked, disabled or busy is
reported, titles are headings, icons are hidden unless they carry meaning (`<Icon label>`),
stat tiles read as one item, toasts are announced, and charts and maps are described.

Text colours reach WCAG's 4.5:1 in light and dark mode: use `c.primaryText` and
`c.positiveText` for text, `c.primary` only for fills and icons, and `useTextColor()` for data
colours (sports, metrics) used as text. CI runs `node mobile/scripts/a11y-audit.js`, which fails
on a `Pressable` without a role or an `IconButton` without a label.
