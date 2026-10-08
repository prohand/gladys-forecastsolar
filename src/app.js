// -----------------------------------------------------------------------------
// The integration logic, independent from the SDK wiring (index.js) so it can
// be tested with a fake `gladys` object.
//
// Rhythms, to respect the Forecast.Solar free plan (12 requests/hour/IP):
//   - Gladys polls each CREATED device every minute;
//   - the forecast of a house is DOWNLOADED every `refresh_interval` minutes
//     (15 min after an error, or when a 429 says) and kept in memory; with
//     several houses the interval is stretched so that all of them together
//     stay under MAX_REQUESTS_PER_HOUR (the quota is per IP, not per house);
//   - the values are recomputed from this cache every 5 minutes (and right
//     after each download), and PUBLISHED when they changed or at least every
//     STATE_HEARTBEAT_MS (every state is a history row in Gladys);
//   - production events (start / peak / end) are checked on every poll.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { configErrorMessage, normalizeConfig } from './config.js';
import { fetchForecast } from './forecastSolar.js';
import { computeForecastValues } from './forecast.js';
import { locatedHouses, NO_LOCATED_HOUSE_MESSAGE } from './houses.js';
import { buildDevice, buildStates, deviceIds } from './devices/solarForecast.js';
import {
  bestWindowOutputs,
  dueProductionEvents,
  forecastUpdatedEvent,
  getForecastOutputs,
  nextHoursOutputs,
} from './scenes.js';
import {
  WIDGETS,
  bestWindowContent,
  emptyContent,
  loadingContent,
  NOT_READY_MESSAGE,
  solarForecastContent,
} from './widgets.js';

const logger = createLogger({ name: 'forecast-solar' });

export const PUBLISH_INTERVAL_MS = 5 * 60 * 1000;
export const ERROR_RETRY_MS = 15 * 60 * 1000;
export const HOUSES_RELOAD_MS = 60 * 60 * 1000;
// A failed read of the houses (Gladys restarting…) is retried this soon, not
// an hour later: without houses no device is polled.
export const HOUSES_RETRY_MS = 60 * 1000;
// The free plan allows 12 requests per hour and per IP, for every house
// together; this leaves a margin for the "Test" button and the scene actions.
export const MAX_REQUESTS_PER_HOUR = 10;
// Longest wait a 429 can impose: Forecast.Solar counts over a one-hour period.
export const MAX_RATE_LIMIT_WAIT_MS = 60 * 60 * 1000;
// The "Test" button reuses a forecast downloaded this recently: a few clicks
// in a row must not burn the hourly quota.
export const FORCED_REUSE_MS = 5 * 60 * 1000;
// An unchanged value is still published this often, so Gladys never shows a
// stable value (tomorrow's energy, 0 W at night) as stale.
export const STATE_HEARTBEAT_MS = 30 * 60 * 1000;
// Two paths poll a device — the core's scheduler and the app's own loop
// (pollCreated) — and this gap keeps them to one evaluation a minute.
export const MIN_POLL_GAP_MS = 50 * 1000;
// The core waits 15 s for a widget, then shows "data unavailable" and never
// retries until the dashboard is reloaded; one Forecast.Solar request is allowed
// 15 s on its own. Past this deadline the card says it is loading.
export const PULL_DEADLINE_MS = 9000;

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

const RATE_LIMIT_MESSAGE = {
  en: 'Forecast.Solar request limit reached, retrying later.',
  fr: 'Limite de requêtes Forecast.Solar atteinte, nouvel essai plus tard.',
};

const UNKNOWN_DEVICE_MESSAGE = {
  en: 'Unknown solar forecast device (house deleted or without location?).',
  fr: 'Appareil de prévision solaire inconnu (maison supprimée ou sans position ?).',
};

/**
 * @param {object} gladys SDK instance (or a fake in tests)
 * @param {object} [options]
 * @param {() => number} [options.now] clock, injected by the tests
 * @param {Function} [options.fetchForecastImpl] API client, injected by the tests
 */
export function createApp(
  gladys,
  { now = () => Date.now(), fetchForecastImpl = fetchForecast } = {},
) {
  let config = normalizeConfig();
  let houses = []; // located houses only
  let housesNextLoadAt = 0;
  let housesError = null;
  let lastStatus = null;
  // Forecast.Solar answered 429: no download before this time (ms), whatever
  // the house — the quota is per IP.
  let rateLimitedUntil = 0;
  let lastLoggedRefreshMs = null;
  // Per house: { planeKey, forecast, fetchedAt, announcedFetchedAt,
  //              lastAttemptAt, lastPublishedAt, lastEvaluatedAt, error, pending }
  const caches = new Map();
  // Last poll of each device external_id (ms).
  const lastPollAt = new Map();
  // Per device external_id: Map(feature external_id -> { state, at }), what
  // Gladys was last given (recorded once publishStates resolved).
  const publishedStates = new Map();

  // --- Houses -----------------------------------------------------------------

  async function loadHouses() {
    try {
      houses = locatedHouses(await gladys.getHouses());
      housesError = null;
      housesNextLoadAt = now() + HOUSES_RELOAD_MS;
      logger.info(`${houses.length} located house(s): ${houses.map((h) => h.name).join(', ')}`);
    } catch (err) {
      // Retried soon: the last known houses are kept meanwhile.
      housesNextLoadAt = now() + HOUSES_RETRY_MS;
      logger.error('Cannot read the houses from Gladys:', err.message);
      housesError = {
        en: `Cannot read the houses from Gladys: ${err.message}`,
        fr: `Impossible de lire les maisons de Gladys : ${err.message}`,
      };
    }
    return houses;
  }

  async function reloadHousesIfOld() {
    if (now() >= housesNextLoadAt) {
      await loadHouses();
    }
  }

  function houseOfDevice(externalId) {
    return houses.find((house) => deviceIds(gladys, house).device === externalId);
  }

  /** Houses whose device was added by the user (only those are polled). */
  async function createdHouses() {
    let devices = gladys.devices ?? [];
    try {
      devices = await gladys.getDevices();
    } catch (err) {
      logger.warn('Cannot read the created devices, using the local list:', err.message);
    }
    const created = new Set(devices.map((device) => device.external_id));
    return houses.filter((house) => created.has(deviceIds(gladys, house).device));
  }

  // --- Status shown in the Configuration screen ---------------------------------

  function currentStatus() {
    const configError = configErrorMessage(config);
    if (configError) {
      return { connected: false, message: configError };
    }
    if (housesError) {
      return { connected: false, message: housesError };
    }
    if (houses.length === 0) {
      return { connected: false, message: NO_LOCATED_HOUSE_MESSAGE };
    }
    for (const house of houses) {
      const error = caches.get(house.id)?.error;
      if (error) {
        return {
          connected: false,
          message: { en: `${house.name}: ${error.en}`, fr: `${house.name} : ${error.fr}` },
        };
      }
    }
    return { connected: true };
  }

  /** Send the status when it changed (or always, with `force`). */
  async function reportStatus({ force = false } = {}) {
    const status = currentStatus();
    const serialized = JSON.stringify(status);
    if (!force && serialized === lastStatus) {
      return;
    }
    lastStatus = serialized;
    await gladys.setConnectionStatus(status.connected, status.message);
  }

  // --- Forecast cache -----------------------------------------------------------

  function entryOf(house) {
    const planeKey = [
      house.latitude,
      house.longitude,
      config.declination,
      config.azimuth,
      config.kwp,
      config.api_key,
    ].join('/');
    let entry = caches.get(house.id);
    // New house, or the plane changed (config or house location): start over.
    if (!entry || entry.planeKey !== planeKey) {
      entry = {
        planeKey,
        forecast: null,
        fetchedAt: 0,
        announcedFetchedAt: 0,
        lastAttemptAt: 0,
        lastPublishedAt: 0,
        lastEvaluatedAt: 0,
        firedEvents: new Set(),
        error: null,
        pending: null,
      };
      caches.set(house.id, entry);
    }
    return entry;
  }

  function requestWidgetRefreshes() {
    for (const key of Object.values(WIDGETS)) {
      Promise.resolve()
        .then(() => gladys.requestWidgetRefresh?.(key))
        .catch((err) => logger.debug(`Widget refresh ${key} not sent:`, err.message));
    }
  }

  /**
   * Download interval of each house: the configured one, stretched when the
   * created houses together would exceed MAX_REQUESTS_PER_HOUR (4 houses every
   * 15 min = 16 requests/hour, a 429 at every turn). Counted over ANY hour,
   * not on average: downloads every I minutes put up to ceil(60 / I) of them
   * in one hour, so 4 houses every 24 min would still make 12 in the first one.
   */
  function effectiveRefreshMs() {
    const configuredMs = config.refresh_interval * 60 * 1000;
    const created = new Set((gladys.devices ?? []).map((device) => device.external_id));
    const downloading = houses.filter((house) => created.has(deviceIds(gladys, house).device));
    const count = Math.max(1, downloading.length);
    const perHouse = Math.floor(MAX_REQUESTS_PER_HOUR / count);
    // Past MAX_REQUESTS_PER_HOUR houses, even one download an hour each is too
    // many: spread them as evenly as the quota allows.
    const quotaMinutes =
      perHouse >= 1 ? Math.ceil(60 / perHouse) : Math.ceil((count * 60) / MAX_REQUESTS_PER_HOUR);
    const refreshMs = Math.max(configuredMs, quotaMinutes * 60 * 1000);
    if (refreshMs !== lastLoggedRefreshMs) {
      lastLoggedRefreshMs = refreshMs;
      if (refreshMs > configuredMs) {
        logger.info(
          `Forecast refreshed every ${refreshMs / 60000} min (not ${config.refresh_interval}): ` +
            `${downloading.length} houses share the Forecast.Solar hourly quota`,
        );
      }
    }
    return refreshMs;
  }

  async function download(house, entry) {
    entry.lastAttemptAt = now();
    try {
      entry.forecast = await fetchForecastImpl({
        ...config,
        latitude: house.latitude,
        longitude: house.longitude,
      });
      entry.fetchedAt = entry.lastAttemptAt;
      entry.lastPublishedAt = 0; // publish the new values on the next occasion
      entry.error = null;
      logger.info(`Forecast downloaded for ${house.name}`);
      requestWidgetRefreshes();
    } catch (err) {
      logger.error(`Forecast download failed for ${house.name}:`, err.message);
      if (err.isRateLimited) {
        // Wait until Forecast.Solar says so (bounded), or the usual delay.
        const time = now();
        const retryAt = Number.isFinite(err.retryAt) ? err.retryAt : time + ERROR_RETRY_MS;
        rateLimitedUntil = Math.min(Math.max(retryAt, time), time + MAX_RATE_LIMIT_WAIT_MS);
      }
      entry.error = err.isRateLimited ? RATE_LIMIT_MESSAGE : { en: err.message, fr: err.message };
      throw err;
    } finally {
      await reportStatus();
    }
  }

  /**
   * Cached forecast of a house, downloaded first when it is too old (or when
   * `force` is set, for the manual refresh button — which still reuses a
   * download of the last FORCED_REUSE_MS and waits out a 429).
   * @returns {Promise<{ entry: object, downloaded: boolean }>}
   */
  async function ensureForecast(house, { force = false } = {}) {
    const entry = entryOf(house);
    if (entry.pending) {
      await entry.pending.catch(() => {});
      return { entry, downloaded: false };
    }
    const time = now();
    const refreshMs = effectiveRefreshMs();
    const tooOld = !entry.forecast || time - entry.fetchedAt >= refreshMs;
    const rateLimited = time < rateLimitedUntil;
    const retryAllowed =
      !rateLimited && time - entry.lastAttemptAt >= Math.min(refreshMs, ERROR_RETRY_MS);
    const forced =
      force && !rateLimited && !(entry.forecast && time - entry.fetchedAt < FORCED_REUSE_MS);
    if (!forced && !(tooOld && retryAllowed)) {
      if (force && rateLimited && !entry.forecast) {
        entry.error = RATE_LIMIT_MESSAGE;
      }
      return { entry, downloaded: false };
    }
    entry.pending = download(house, entry);
    try {
      await entry.pending;
      return { entry, downloaded: true };
    } catch (err) {
      if (force) {
        throw err;
      }
      return { entry, downloaded: false }; // keep the previous forecast, if any
    } finally {
      entry.pending = null;
    }
  }

  /** Forecast of the house of a device chosen in a scene or a widget. */
  /**
   * The forecast a widget shows: the one in memory whenever there is one (the
   * polls keep it fresh), a download only for a house that has none yet, and
   * never longer than the deadline — `null` then, the download going on.
   */
  async function forecastForWidget(externalId, deadlineMs) {
    if (configErrorMessage(config)) {
      throw new Error(configErrorMessage(config).en);
    }
    await reloadHousesIfOld();
    const house = houseOfDevice(externalId);
    if (!house) {
      throw new Error(UNKNOWN_DEVICE_MESSAGE.en);
    }
    const entry = entryOf(house);
    if (entry.forecast) {
      return { house, entry };
    }
    const download = forecastForDevice(externalId);
    download.catch(() => {});
    let timer;
    const late = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), deadlineMs);
      timer.unref?.();
    });
    return Promise.race([download, late]).finally(() => clearTimeout(timer));
  }

  async function forecastForDevice(externalId) {
    if (configErrorMessage(config)) {
      throw new Error(configErrorMessage(config).en);
    }
    await reloadHousesIfOld();
    const house = houseOfDevice(externalId);
    if (!house) {
      throw new Error(UNKNOWN_DEVICE_MESSAGE.en);
    }
    const { entry } = await ensureForecast(house);
    if (!entry.forecast) {
      throw new Error(entry.error?.en ?? 'No forecast available yet.');
    }
    return { house, entry };
  }

  /**
   * Publish the values of a house that changed since what Gladys was last
   * given, or that were not re-sent for STATE_HEARTBEAT_MS. Every state is a
   * history row (`keep_history: true`): the four features re-sent every 5 min
   * whatever they hold would fill the database with flat lines.
   */
  async function publish(house, entry) {
    const time = now();
    const values = computeForecastValues(entry.forecast, new Date(time));
    const deviceId = deviceIds(gladys, house).device;
    const known = publishedStates.get(deviceId) ?? new Map();
    const states = buildStates(gladys, house, values).filter(
      ({ device_feature_external_id, state }) => {
        const last = known.get(device_feature_external_id);
        return !last || last.state !== state || time - last.at >= STATE_HEARTBEAT_MS;
      },
    );
    if (states.length > 0) {
      await gladys.publishStates(states);
      // Recorded only once Gladys accepted them: a failed call is re-sent.
      for (const { device_feature_external_id, state } of states) {
        known.set(device_feature_external_id, { state, at: time });
      }
      publishedStates.set(deviceId, known);
    }
    entry.lastPublishedAt = time;
    return values;
  }

  /**
   * Forget what was published for a device (or for every device): Gladys
   * dropped the states sent before the device existed, and may have missed
   * some while the integration was disconnected.
   */
  function forgetPublishedStates(deviceExternalId) {
    const targets = deviceExternalId
      ? houses.filter((house) => deviceIds(gladys, house).device === deviceExternalId)
      : houses;
    if (deviceExternalId) {
      publishedStates.delete(deviceExternalId);
    } else {
      publishedStates.clear();
    }
    for (const house of targets) {
      const entry = caches.get(house.id);
      if (entry) {
        entry.lastPublishedAt = 0;
      }
    }
  }

  async function fireSceneEvent(key, data) {
    try {
      await gladys.publishSceneEvent(key, data);
      logger.info(`Scene event ${key} (${data.house})`);
    } catch (err) {
      logger.warn(`Scene event ${key} not accepted:`, err.message);
    }
  }

  // --- Handlers -----------------------------------------------------------------

  async function poll(device, { force = false } = {}) {
    if (configErrorMessage(config)) {
      logger.debug('Poll ignored: configuration incomplete');
      return;
    }
    const last = lastPollAt.get(device.external_id);
    if (!force && last !== undefined && now() - last < MIN_POLL_GAP_MS) {
      return;
    }
    lastPollAt.set(device.external_id, now());
    await reloadHousesIfOld();
    const house = houseOfDevice(device.external_id);
    if (!house) {
      logger.debug(`Poll ignored: no located house for ${device.external_id}`);
      return;
    }
    const { entry } = await ensureForecast(house);
    if (!entry.forecast) {
      return;
    }
    const time = now();
    if (time - entry.lastPublishedAt >= PUBLISH_INTERVAL_MS) {
      await publish(house, entry);
    }

    // Scene events: only from the poll, never as a consequence of a scene
    // action (a scene bound to the event would loop through the integration).
    // A download made by a scene action, a widget or the "Test" button is
    // still announced, here, on the next poll: the event says a new forecast
    // exists, whoever fetched it. No loop: a scene reacting to it reads the
    // cache, and a new download only happens once the interval has passed.
    if (entry.fetchedAt > entry.announcedFetchedAt) {
      entry.announcedFetchedAt = entry.fetchedAt;
      const event = forecastUpdatedEvent(entry.forecast, device.external_id, house.name, time);
      await fireSceneEvent(event.key, event.data);
    }
    if (entry.lastEvaluatedAt > 0) {
      const events = dueProductionEvents(
        entry.forecast,
        device.external_id,
        house.name,
        entry.lastEvaluatedAt,
        time,
        entry.firedEvents,
      );
      for (const event of events) {
        await fireSceneEvent(event.key, event.data);
      }
    }
    entry.lastEvaluatedAt = time;
  }

  /** Re-read houses + config, re-publish devices, refresh the created ones. */
  async function synchronize() {
    await loadHouses();
    await gladys.publishDiscoveredDevices(houses.map((house) => buildDevice(gladys, house)));
    for (const house of await createdHouses()) {
      await poll({ external_id: deviceIds(gladys, house).device }, { force: true });
    }
    await reportStatus({ force: true });
  }

  return {
    get config() {
      return config;
    },

    get houses() {
      return houses;
    },

    setConfig(raw) {
      config = normalizeConfig(raw);
      // A new configuration is evaluated at once, not a minute later.
      lastPollAt.clear();
    },

    loadHouses,
    synchronize,
    poll,

    /**
     * One tick of the app's own refresh loop (index.js, every minute): poll
     * every device the user created. Gladys only schedules the devices whose
     * row carries `should_poll: true`, read once at creation, so the ones
     * created before that flag was published would otherwise never refresh.
     * Shares `lastPollAt` with poll(), so a device Gladys also polls is still
     * evaluated once a minute.
     */
    async pollCreated() {
      const created = new Set((gladys.devices ?? []).map((device) => device.external_id));
      for (const house of houses) {
        const externalId = deviceIds(gladys, house).device;
        if (!created.has(externalId)) {
          continue;
        }
        try {
          await poll({ external_id: externalId });
        } catch (err) {
          logger.error(`Refresh of ${house.name} failed:`, err.message);
        }
      }
    },

    /** Discovery: one device per located house. */
    async discoveredDevices() {
      await loadHouses();
      return houses.map((house) => buildDevice(gladys, house));
    },

    forgetPublishedStates,

    /** The user just added a device: publish its values right away. */
    async onDeviceCreated(device) {
      if (houseOfDevice(device.external_id)) {
        forgetPublishedStates(device.external_id);
        await poll(device, { force: true });
      }
    },

    /** Same on an update: the features may have just been (re)created. */
    async onDeviceUpdated(device) {
      if (houseOfDevice(device.external_id)) {
        forgetPublishedStates(device.external_id);
        await poll(device, { force: true });
      }
    },

    // Manifest actions (buttons of the Configuration screen).
    actions: {
      async test_forecast() {
        const configError = configErrorMessage(config);
        if (configError) {
          return configError;
        }
        await loadHouses();
        if (houses.length === 0) {
          return housesError ?? NO_LOCATED_HOUSE_MESSAGE;
        }
        // The houses whose device was added; otherwise test the first one
        // (without publishing: its device does not exist in Gladys yet).
        const created = await createdHouses();
        const targets = created.length > 0 ? created : houses.slice(0, 1);
        const lines = [];
        for (const house of targets) {
          const { entry } = await ensureForecast(house, { force: true });
          if (!entry.forecast) {
            throw new Error(entry.error?.en ?? 'No forecast available yet.');
          }
          const values = created.includes(house)
            ? await publish(house, entry)
            : computeForecastValues(entry.forecast, new Date(now()));
          lines.push({
            house: house.name,
            today: values.energyToday,
            tomorrow: values.energyTomorrow,
          });
        }
        return {
          en: lines
            .map(
              (l) => `${l.house}: ${l.today ?? '?'} kWh today, ${l.tomorrow ?? '?'} kWh tomorrow`,
            )
            .join(' · '),
          fr: lines
            .map(
              (l) =>
                `${l.house} : ${l.today ?? '?'} kWh aujourd'hui, ${l.tomorrow ?? '?'} kWh demain`,
            )
            .join(' · '),
        };
      },
    },

    // Scene actions (manifest `scene_actions`), with the RESOLVED fields.
    sceneActions: {
      async get_forecast(fields) {
        const { entry } = await forecastForDevice(fields.device);
        return getForecastOutputs(entry.forecast, now());
      },

      async get_production_next_hours(fields) {
        const { entry } = await forecastForDevice(fields.device);
        return nextHoursOutputs(entry.forecast, now(), clamp(fields.hours, 1, 48, 3));
      },

      async find_best_window(fields) {
        const { entry } = await forecastForDevice(fields.device);
        return bestWindowOutputs(entry.forecast, now(), {
          durationHours: clamp(fields.duration_hours, 0.25, 12, 2),
          day: fields.day === 'tomorrow' ? 'tomorrow' : 'today',
        });
      },
    },

    // Dashboard widgets (manifest `widgets`).
    widgets: {
      async [WIDGETS.SOLAR_FORECAST]({ settings = {} }, { deadlineMs = PULL_DEADLINE_MS } = {}) {
        try {
          const found = await forecastForWidget(settings.device, deadlineMs);
          if (!found) {
            return loadingContent();
          }
          const { house, entry } = found;
          return solarForecastContent({
            forecast: entry.forecast,
            ids: deviceIds(gladys, house),
            houseName: house.name,
            fetchedAt: entry.fetchedAt,
            now: now(),
          });
        } catch (err) {
          logger.debug('Widget without forecast:', err.message);
          return emptyContent(NOT_READY_MESSAGE);
        }
      },

      async [WIDGETS.BEST_WINDOW]({ settings = {} }, { deadlineMs = PULL_DEADLINE_MS } = {}) {
        try {
          const found = await forecastForWidget(settings.device, deadlineMs);
          if (!found) {
            return loadingContent();
          }
          const { house, entry } = found;
          return bestWindowContent({
            forecast: entry.forecast,
            houseName: house.name,
            durationHours: clamp(settings.duration_hours, 0.25, 12, 2),
            now: now(),
          });
        } catch (err) {
          logger.debug('Widget without forecast:', err.message);
          return emptyContent(NOT_READY_MESSAGE);
        }
      },
    },
  };
}
