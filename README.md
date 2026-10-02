# Gladys Assistant — Forecast.Solar

External integration for [Gladys Assistant](https://gladysassistant.com) that
publishes the **solar production forecast** of your PV panels, from the free
[Forecast.Solar](https://forecast.solar) API.

Built from the official
[integration template](https://github.com/GladysAssistant/integration-template-js)
with the JavaScript SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

User documentation: [English](docs/en.md) · [Français](docs/fr.md).

## Features

One device, **Solar forecast**, with 4 read-only sensors
(category `energy-production-sensor`):

| Feature                          | Type               | Unit |
| -------------------------------- | ------------------ | ---- |
| Estimated power now              | `power`            | W    |
| Estimated energy today           | `daily-production` | kWh  |
| Estimated energy remaining today | `daily-production` | kWh  |
| Estimated energy tomorrow        | `daily-production` | kWh  |

- The forecast is downloaded every `refresh_interval` minutes (default 60)
  and kept in memory, to respect the free plan limit (12 requests/hour/IP).
- Gladys polls the device every minute; values are recomputed from the cache
  (linear interpolation of the forecast curve) and published every 5 minutes.
- On an error (rate limit, outage), the previous forecast stays in use, the
  status is shown in the Configuration screen and the download is retried
  15 minutes later.
- A **Refresh the forecast now** action downloads the forecast on demand.

## Project structure

```
.
├─ index.js                          # SDK bootstrap + event wiring
├─ src/
│  ├─ devices/
│  │  ├─ index.js                    # device registry
│  │  └─ solarForecast.js            # the device: discovery, poll, cache, action
│  ├─ forecastSolar.js               # Forecast.Solar API client
│  ├─ forecast.js                    # pure computations (power now, kWh…)
│  └─ config.js                      # config defaults, normalization, checks
├─ test/                             # node --test (fixture = real API answer)
├─ docs/en.md, docs/fr.md            # user documentation
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile
└─ cover.png                         # catalog cover, 800×534 px
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="forecast-solar" \
LOG_LEVEL=debug \
npm start
```

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test
```

The same checks run in CI on every push and pull request.

Validate against the store rules before publishing:

```bash
npx github:GladysAssistant/integration-store .
```

## Publish

1. Add the GitHub topic `gladys-assistant-integration` to the repository.
2. **Actions → Release → Run workflow** (`patch` / `minor` / `major`): bumps
   the version in `package.json` and the manifest, tags `vX.Y.Z` and builds
   the `linux/amd64` + `linux/arm64` image to
   `ghcr.io/prohand/gladys-forecastsolar`.
3. Make the GHCR package public, so Gladys can pull it.

## License

Apache-2.0. Forecast data © [Forecast.Solar](https://forecast.solar)
(see their terms of use).
