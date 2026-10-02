// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the `config_schema`
// declared in `gladys-assistant-integration.json`. The SDK fetches it for you
// (`gladys.getConfig()`) and notifies you of every change through
// `gladys.onConfigUpdated()`.
//
// This module provides defaults, normalizes the received object and checks that
// the solar plane is fully described before any call to Forecast.Solar.
// The location is NOT part of the config: it comes from the houses configured
// in Gladys (see src/houses.js).
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest. The peak power has no sensible default: a
// wrong value would silently give a wrong forecast.
export const DEFAULT_CONFIG = {
  declination: 35, // tilt in degrees, 0 = flat, 90 = vertical
  azimuth: 0, // orientation in degrees, 0 = south, -90 = east, 90 = west
  api_key: '', // empty = free public plan
  refresh_interval: 60, // minutes between two downloads of the forecast
};

/**
 * Convert a form value to a number. Empty values become NaN (= not filled in).
 */
function toNumber(value) {
  if (value === undefined || value === null || value === '') {
    return NaN;
  }
  return Number(value);
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    // Force the types: config may arrive as strings from a form.
    declination: toNumber(raw.declination ?? DEFAULT_CONFIG.declination),
    azimuth: toNumber(raw.azimuth ?? DEFAULT_CONFIG.azimuth),
    // Peak power is typed in Wp (whole number): Gladys renders number fields
    // without a `step`, so the browser only accepts integers. Forecast.Solar
    // expects kWp.
    wp: toNumber(raw.wp),
    kwp: toNumber(raw.wp) / 1000,
    api_key: typeof raw.api_key === 'string' ? raw.api_key.trim() : DEFAULT_CONFIG.api_key,
    refresh_interval: Number(raw.refresh_interval ?? DEFAULT_CONFIG.refresh_interval),
  };
}

// Allowed range of each numeric field, same as the manifest `min`/`max`.
const RANGES = {
  declination: [0, 90],
  azimuth: [-180, 180],
  wp: [10, 10000000],
  refresh_interval: [15, 1440],
};

/**
 * List the config fields that are missing or out of range.
 * @returns {string[]} the invalid keys (empty when the config is usable)
 */
export function invalidConfigKeys(config) {
  return Object.entries(RANGES)
    .filter(([key, [min, max]]) => {
      const value = config[key];
      return !Number.isFinite(value) || value < min || value > max;
    })
    .map(([key]) => key);
}

/**
 * Multi-language message shown in the Configuration screen when the config is
 * not usable, or null when everything is fine.
 */
export function configErrorMessage(config) {
  const keys = invalidConfigKeys(config);
  if (keys.length === 0) {
    return null;
  }
  const list = keys.join(', ');
  return {
    en: `Configuration incomplete or invalid: ${list}.`,
    fr: `Configuration incomplète ou invalide : ${list}.`,
  };
}
