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

Requires **Gladys 5.1.0+** (dashboard widgets and scene declarations).

- **Houses**: the manifest declares `"location": true`; one device per
  **located** Gladys house is discovered. Only the devices the user adds are
  polled, so only those consume the Forecast.Solar quota.
- **Device** _Solar forecast (house)_, 4 read-only sensors
  (category `energy-production-sensor`, not counted by the energy monitoring):

  | Feature                          | Type               | Unit |
  | -------------------------------- | ------------------ | ---- |
  | Estimated power now              | `power`            | W    |
  | Estimated energy today           | `daily-production` | kWh  |
  | Estimated energy remaining today | `daily-production` | kWh  |
  | Estimated energy tomorrow        | `daily-production` | kWh  |

- **Widgets**: `solar_forecast` (live tiles, power curve, peak) and
  `solar_best_window` (best slot for an appliance of N hours).
- **Scene triggers**: `forecast_updated`, `production_started`,
  `production_peak`, `production_ended` (filter: house).
- **Scene actions**: `get_forecast`, `get_production_next_hours`,
  `find_best_window` (outputs usable in the next actions).
- **Manifest action**: refresh the forecast now.

Rhythms (free plan: 12 requests/hour/IP): the forecast of a house is
downloaded every `refresh_interval` minutes (default 60, 15 min after an
error, stretched so all created houses together stay under 10 requests/hour,
and after a 429 not before the `retry-at` Forecast.Solar gives) and kept in
memory; Gladys polls every minute, values are recomputed from the cache
(linear interpolation, exact trapezoid integral for energies) every 5 minutes
and published when they changed, or every 30 minutes; production events are
checked on every poll.

## Project structure

```
.
├─ index.js                          # SDK bootstrap + event wiring
├─ src/
│  ├─ app.js                         # logic: houses, cache, status, handlers
│  ├─ devices/solarForecast.js       # device payload + states
│  ├─ widgets.js                     # dashboard widget contents
│  ├─ scenes.js                      # scene events + scene action outputs
│  ├─ forecast.js                    # pure computations (power, kWh, windows)
│  ├─ forecastSolar.js               # Forecast.Solar API client
│  ├─ houses.js                      # located houses
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
