// -----------------------------------------------------------------------------
// Device type: SOLAR FORECAST (one device per located house)
// Read-only sensors computed from the Forecast.Solar estimate:
//   - estimated power right now (W);
//   - estimated energy today, still to come today, and tomorrow (kWh).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'solar-forecast';

// Gladys only accepts a few poll frequencies, in MILLISECONDS; one minute is
// the slowest one. The real pace (downloads, publications) is set in app.js.
export const POLL_FREQUENCY_MS = 60 * 1000;

// Feature keys, kept in one place so discovery, polling and widgets agree.
export const FEATURE = {
  POWER_NOW: 'power-now',
  ENERGY_TODAY: 'energy-today',
  ENERGY_REMAINING_TODAY: 'energy-remaining-today',
  ENERGY_TOMORROW: 'energy-tomorrow',
};

/**
 * External ids of the device of a house. The platform id is the house id
 * (stable, unlike its name): renaming the house keeps the same device.
 */
export function deviceIds(gladys, house) {
  return gladys.externalIds(DEVICE_TYPE, house.id);
}

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

/** Discovery payload of the device of a house. */
export function buildDevice(gladys, house) {
  const ids = deviceIds(gladys, house);
  return {
    name: `Solar forecast (${house.name})`,
    external_id: ids.device,
    poll_frequency: POLL_FREQUENCY_MS,
    // Gladys only schedules a device that also asks for it (`should_poll` is
    // false by default in the core): without it the forecast was never
    // refreshed after the device was created. The core reads the flag once,
    // at creation; older devices are covered by the app's own loop.
    should_poll: true,
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
}

/** States to publish for the computed values (unknown values are skipped). */
export function buildStates(gladys, house, values) {
  const ids = deviceIds(gladys, house);
  return [
    [FEATURE.POWER_NOW, values.powerNow],
    [FEATURE.ENERGY_TODAY, values.energyToday],
    [FEATURE.ENERGY_REMAINING_TODAY, values.energyRemainingToday],
    [FEATURE.ENERGY_TOMORROW, values.energyTomorrow],
  ]
    .filter(([, state]) => state !== null)
    .map(([key, state]) => ({ device_feature_external_id: ids.feature(key), state }));
}
