# Kinetic mobile

Expo (React Native) app. It shares its data types, API client, calculations and chart
definitions with the web app through `packages/shared` (see its README). Charts are drawn by
the same plotly.js as the web app, inside a WebView (`src/components/PlotView.tsx`), so a chart
looks the same on both.

Currently it has a sign-in screen and the Graphs page.

## Run

```powershell
cd mobile
npm install
copy .env.example .env
npx expo start
```

Set `EXPO_PUBLIC_KINETIC_URL` in `.env` to the web app's public origin (e.g. the Vercel
domain). Then scan the QR code with Expo Go on your phone, or press `a` for an Android
emulator.

## How it talks to the API

The app calls `<EXPO_PUBLIC_KINETIC_URL>/api/…` just like the browser does, so requests pass the
Vercel proxy (which adds the origin secret). It sends `Origin: <EXPO_PUBLIC_KINETIC_URL>` itself,
because the backend only accepts state-changing requests from that origin, and the session
cookie is kept by the phone's native cookie store.

A local backend on `http://localhost:5173` is not reachable from a phone, and the backend
accepts plain HTTP only for localhost origins. For testing, point `EXPO_PUBLIC_KINETIC_URL` at a
deployed instance (e.g. a Vercel preview), or at an HTTPS tunnel to your local Vite server with
`KINETIC_PUBLIC_ORIGIN` set to the tunnel's address.

## Checks

```powershell
npx tsc --noEmit
npx expo export --platform android
```
