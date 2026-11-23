# Kinetic mobile

Expo (React Native) app with all the pages of the web app: Activities (with adding, editing,
deleting and .fit uploads), activity details, Map, Graphs, Training, Best Efforts, Races,
Friends and Garmin Sync.

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

A local backend on `http://localhost:5173` is not reachable from a phone, and the backend
accepts plain HTTP only for localhost origins. For testing, point `EXPO_PUBLIC_KINETIC_URL` at a
deployed instance (e.g. a Vercel preview), or use an Android emulator or USB phone with
`adb reverse tcp:5173 tcp:5173` and `EXPO_PUBLIC_KINETIC_URL=http://localhost:5173`.

## Checks

```powershell
npx tsc --noEmit
npx expo export --platform android
```
