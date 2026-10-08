# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) that publishes the **solar production forecast**
of PV panels from the free [Forecast.Solar](https://forecast.solar) API. One device per
**located** Gladys house; the panels (tilt, azimuth, peak power in Wp, optional API key) are
described once in the configuration. Requires Gladys 5.1.0+.

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/forecast.test.js           # one file
node --test --test-name-pattern "trapezoid" # one test by name
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
```

CI runs `format:check`, `lint`, `test`. Releases go through **Actions → Release** (bumps
`package.json`, manifest `version` + `docker_image`, tags, builds): never bump by hand. The
release rewrites the manifest with `jq`, so run `npm run format` on it afterwards.

## Architecture

```
index.js                     SDK wiring only, handlers registered before connect()
src/app.js                   all the logic, built by createApp(gladys, { now, fetchForecastImpl })
src/config.js                defaults, normalization (wp -> kwp), configErrorMessage()
src/houses.js                keep the located houses from gladys.getHouses()
src/forecastSolar.js         API client (estimate endpoint, rate-limit headers, key masked in logs)
src/forecast.js              interpolation + exact trapezoid integrals -> feature values
src/devices/solarForecast.js device "Solar forecast (house)": 4 energy-production-sensor features
src/scenes.js                scene trigger events + scene action outputs (pure)
src/widgets.js               widgets solar_forecast and solar_best_window (pure)
```

### Invariants worth knowing

- **The free plan allows 12 requests/hour/IP.** A house's forecast is downloaded every
  `refresh_interval` minutes (default 60, 15 min after an error), stretched so the created
  houses together stay ≤ `MAX_REQUESTS_PER_HOUR` (`effectiveRefreshMs`), kept in memory per
  house (`caches`), and shared by one in-flight promise. A 429 stops every house until its
  `retry-at` (`rateLimitedUntil`); the Test button reuses a download younger than
  `FORCED_REUSE_MS`. Values are recomputed from the cache at most every 5 min
  (`PUBLISH_INTERVAL_MS`) and only published when changed, or every `STATE_HEARTBEAT_MS`
  (reset on `onDeviceCreated` / `onDeviceUpdated` / `connected`). Never add a download to a
  widget or scene path beyond `ensureForecast()`.
- **Only created devices cost quota**: `createdHouses()` filters houses by the devices Gladys
  holds. Houses have no update event: they are re-read on connect, on scan and every hour.
- **The cache key is the plane** (house position + tilt + azimuth + kWp + key): changing any of
  them restarts the house's forecast.
- **Location is personal data**: `"location": true` in the manifest is what allows
  `gladys.getHouses()` (403 without it). Coordinates are never logged nor published: the
  request URL is logged through `redactedEstimateUrl()`.
- **Polling**: devices declare `poll_frequency: 60000` (the slowest value Gladys accepts; any
  other value rejects the whole discovery) and `should_poll: true` (default `false` in the core,
  read once at creation). `app.pollCreated()`, run every minute by index.js, covers the devices
  created before that flag; both paths share `lastPollAt` (`MIN_POLL_GAP_MS`), so a device is
  evaluated once a minute.
- **Scene events only come from `poll()`**, never from a scene action (a scene bound to the
  event would loop). A download made elsewhere (scene action, widget, Test button) is announced
  as `forecast_updated` by the next poll (`fetchedAt > announcedFetchedAt`). Production start/peak/end are computed between two polls
  (`dueProductionEvents`); the first poll only records the time.
- **Features use `energy-production-sensor`**, not counted by Gladys energy monitoring, and every
  feature declares `min`/`max` (NOT NULL in Gladys).
- **Keys are forever**: widget, trigger, action, field and output keys are stored by users'
  dashboards and scenes.
- The API key never appears in logs (`loggedUrl` masks it).

### Manifest

`test/manifest.test.js` ties `gladys-assistant-integration.json` to `DEFAULT_CONFIG`, the config
bounds, the action/widget/scene keys and their outputs. Change both sides together.

## Testing

`createApp(fakeGladys, { now, fetchForecastImpl })` is tested with an injected clock and API
client; `test/fixtures/estimate.json` is a real API answer. No test touches the network.

## Conventions

Prettier formats, ESLint catches mistakes. Comments explain **why**, in English. User-facing
messages are bilingual `{ en, fr }`. User docs: `docs/en.md` and `docs/fr.md`, kept in sync. The
container rootfs is read-only: write nothing.
