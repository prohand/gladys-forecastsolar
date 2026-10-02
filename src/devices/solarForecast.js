// -----------------------------------------------------------------------------
// Device type: SOLAR FORECAST
// Read-only sensors computed from the Forecast.Solar estimate of the plane:
//   - estimated power right now (W);
//   - estimated energy today, still to come today, and tomorrow (kWh).
//
// Two rhythms, to respect the free plan limit (12 requests/hour/IP):
//   - Gladys polls the device every minute (fastest allowed frequency);
//   - the forecast is DOWNLOADED only every `refresh_interval` minutes and
//     kept in memory; the values are recomputed from this cache and
//     PUBLISHED every 5 minutes (and right after each download).
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { configErrorMessage } from '../config.js';
import { fetchForecast } from '../forecastSolar.js';
import { computeForecastValues } from '../forecast.js';

const DEVICE_TYPE = 'solar-forecast';

const logger = createLogger({ name: DEVICE_TYPE });

// Forecast.Solar gives no id to a plane: the integration describes ONE plane
// (its config), so the id is fixed. Keeping it stable means changing the tilt
// or the location updates the same device instead of creating a new one.
const PLATFORM_DEVICE_ID = 'plane-1';

// Gladys only accepts a few poll frequencies, in MILLISECONDS; one minute is
// the slowest one. The real pace is driven by the timings below.
const POLL_FREQUENCY_MS = 60 * 1000;

// Publish the recomputed values at most this often (history stays light).
export const PUBLISH_INTERVAL_MS = 5 * 60 * 1000;

// After a failed download, wait this long before trying again.
export const ERROR_RETRY_MS = 15 * 60 * 1000;

// Feature keys, kept in one place so discovery and polling always agree.
const FEATURE = {
  POWER_NOW: 'power-now',
  ENERGY_TODAY: 'energy-today',
  ENERGY_REMAINING_TODAY: 'energy-remaining-today',
  ENERGY_TOMORROW: 'energy-tomorrow',
};

// In-memory cache (lost on restart: the first poll downloads it again).
const cache = {
  forecast: null,
  fetchedAt: 0,
  lastAttemptAt: 0,
  lastPublishedAt: 0,
  // Last status reported to the Configuration screen: { connected, message }.
  status: null,
};

function energyFeature(ids, key, name, type) {
  return {
    name,
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_PRODUCTION_SENSOR,
    type,
    unit: DEVICE_FEATURE_UNITS.KILOWATT_HOUR,
    min: 0,
    max: 100000,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
}

/** Report the status shown in the Configuration screen, and remember it. */
async function reportStatus(gladys, connected, message) {
  cache.status = { connected, message };
  await gladys.setConnectionStatus(connected, message);
}

async function download(gladys, config, now) {
  cache.lastAttemptAt = now;
  try {
    cache.forecast = await fetchForecast(config);
    cache.fetchedAt = now;
    logger.info(`Forecast downloaded${cache.forecast.place ? ` for ${cache.forecast.place}` : ''}`);
    await reportStatus(gladys, true);
  } catch (err) {
    logger.error('Forecast download failed:', err.message);
    await reportStatus(
      gladys,
      false,
      err.isRateLimited
        ? {
            en: 'Forecast.Solar request limit reached, retrying later.',
            fr: 'Limite de requêtes Forecast.Solar atteinte, nouvel essai plus tard.',
          }
        : { en: err.message, fr: err.message },
    );
    throw err;
  }
}

async function publishValues(gladys, now) {
  const ids = gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID);
  const values = computeForecastValues(cache.forecast, new Date(now));
  const states = [
    [FEATURE.POWER_NOW, values.powerNow],
    [FEATURE.ENERGY_TODAY, values.energyToday],
    [FEATURE.ENERGY_REMAINING_TODAY, values.energyRemainingToday],
    [FEATURE.ENERGY_TOMORROW, values.energyTomorrow],
  ]
    .filter(([, state]) => state !== null)
    .map(([key, state]) => ({ device_feature_external_id: ids.feature(key), state }));

  if (states.length > 0) {
    await gladys.publishStates(states);
  }
  cache.lastPublishedAt = now;
  logger.debug('Published values', values);
  return values;
}

export const solarForecast = {
  key: DEVICE_TYPE,

  deviceExternalId(gladys) {
    return gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID).device;
  },

  buildDevice(gladys) {
    const ids = gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID);
    return {
      name: 'Solar forecast',
      external_id: ids.device,
      poll_frequency: POLL_FREQUENCY_MS,
      features: [
        {
          name: 'Estimated power now',
          external_id: ids.feature(FEATURE.POWER_NOW),
          category: DEVICE_FEATURE_CATEGORIES.ENERGY_PRODUCTION_SENSOR,
          type: DEVICE_FEATURE_TYPES.ENERGY_PRODUCTION_SENSOR.POWER,
          unit: DEVICE_FEATURE_UNITS.WATT,
          min: 0,
          max: 10000000,
          read_only: true,
          has_feedback: false,
          keep_history: true,
        },
        energyFeature(
          ids,
          FEATURE.ENERGY_TODAY,
          'Estimated energy today',
          DEVICE_FEATURE_TYPES.ENERGY_PRODUCTION_SENSOR.DAILY_PRODUCTION,
        ),
        energyFeature(
          ids,
          FEATURE.ENERGY_REMAINING_TODAY,
          'Estimated energy remaining today',
          DEVICE_FEATURE_TYPES.ENERGY_PRODUCTION_SENSOR.DAILY_PRODUCTION,
        ),
        energyFeature(
          ids,
          FEATURE.ENERGY_TOMORROW,
          'Estimated energy tomorrow',
          DEVICE_FEATURE_TYPES.ENERGY_PRODUCTION_SENSOR.DAILY_PRODUCTION,
        ),
      ],
    };
  },

  // Manifest action: download the forecast now and show the result under the
  // button. Uses one request of the hourly quota.
  actions: {
    async test_forecast(gladys, { config }) {
      const configError = configErrorMessage(config);
      if (configError) {
        return configError;
      }
      const now = Date.now();
      await download(gladys, config, now);
      const { energyToday, energyTomorrow } = await publishValues(gladys, now);
      const place = cache.forecast.place ? ` (${cache.forecast.place})` : '';
      return {
        en: `Forecast.Solar OK${place}: ${energyToday ?? '?'} kWh today, ${energyTomorrow ?? '?'} kWh tomorrow.`,
        fr: `Forecast.Solar OK${place} : ${energyToday ?? '?'} kWh aujourd'hui, ${energyTomorrow ?? '?'} kWh demain.`,
      };
    },
  },

  /**
   * Called by Gladys every minute: download the forecast when it is too old,
   * then publish the recomputed values when it is time to.
   * @param {object} gladys SDK instance
   * @param {object} config normalized config
   * @param {number} [now] current time in ms (injected by the tests)
   */
  async onPoll(gladys, config, now = Date.now()) {
    if (configErrorMessage(config)) {
      logger.debug('Poll ignored: configuration incomplete');
      return;
    }

    const refreshMs = config.refresh_interval * 60 * 1000;
    const forecastTooOld = !cache.forecast || now - cache.fetchedAt >= refreshMs;
    const retryAllowed = now - cache.lastAttemptAt >= Math.min(refreshMs, ERROR_RETRY_MS);
    let downloaded = false;
    if (forecastTooOld && retryAllowed) {
      try {
        await download(gladys, config, now);
        downloaded = true;
      } catch {
        // Already logged and reported: keep using the previous forecast.
      }
    }

    if (!cache.forecast) {
      return;
    }
    if (downloaded || now - cache.lastPublishedAt >= PUBLISH_INTERVAL_MS) {
      await publishValues(gladys, now);
    }
  },

  /** Send the last known status again (e.g. after a reconnection). */
  async resendStatus(gladys) {
    if (cache.status) {
      await gladys.setConnectionStatus(cache.status.connected, cache.status.message);
    }
  },

  /** Forget the cached forecast (the plane changed): next poll downloads. */
  reset() {
    cache.forecast = null;
    cache.fetchedAt = 0;
    cache.lastAttemptAt = 0;
    cache.lastPublishedAt = 0;
    cache.status = null;
  },
};
