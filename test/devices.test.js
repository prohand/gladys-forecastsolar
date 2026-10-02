import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import {
  DEVICE_BLUEPRINTS,
  buildDiscoveredDevices,
  findBlueprintByDevice,
} from '../src/devices/index.js';
import {
  solarForecast,
  ERROR_RETRY_MS,
  PUBLISH_INTERVAL_MS,
} from '../src/devices/solarForecast.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { fakeFetch } from './helpers/fixtures.js';

const realFetch = globalThis.fetch;
const config = normalizeConfig({ latitude: 48.8566, longitude: 2.3522, kwp: 3, declination: 30 });
// 15:00 in Paris on the day of the fixture.
const NOW = new Date('2026-10-02T15:00:00+02:00').getTime();
const MINUTE = 60 * 1000;

// Poll frequencies accepted by the Gladys core, in milliseconds.
const GLADYS_POLL_FREQUENCIES = [60000, 30000, 15000, 10000, 2000, 1000];

let gladys;

beforeEach(() => {
  gladys = createFakeGladys();
  solarForecast.reset();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('every blueprint exposes the required shape', () => {
  for (const bp of DEVICE_BLUEPRINTS) {
    assert.equal(typeof bp.key, 'string');
    assert.equal(typeof bp.deviceExternalId, 'function');
    assert.equal(typeof bp.buildDevice, 'function');
  }
});

test('the discovered device carries the 4 production features', () => {
  const [device] = buildDiscoveredDevices(gladys, config);
  assert.equal(device.external_id, solarForecast.deviceExternalId(gladys));
  assert.ok(GLADYS_POLL_FREQUENCIES.includes(device.poll_frequency));
  assert.equal(device.features.length, 4);
  for (const feature of device.features) {
    assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.ENERGY_PRODUCTION_SENSOR);
    assert.equal(feature.read_only, true);
  }
  const [power, ...energies] = device.features;
  assert.equal(power.type, DEVICE_FEATURE_TYPES.ENERGY_PRODUCTION_SENSOR.POWER);
  assert.equal(power.unit, DEVICE_FEATURE_UNITS.WATT);
  for (const energy of energies) {
    assert.equal(energy.unit, DEVICE_FEATURE_UNITS.KILOWATT_HOUR);
  }
  const ids = device.features.map((f) => f.external_id);
  assert.equal(new Set(ids).size, ids.length, 'feature external_ids are unique');
});

test('findBlueprintByDevice routes an external_id back to its owner blueprint', () => {
  const external_id = solarForecast.deviceExternalId(gladys);
  assert.equal(findBlueprintByDevice(gladys, { external_id }), solarForecast);
  assert.equal(findBlueprintByDevice(gladys, { external_id: 'nope' }), undefined);
});

test('first poll downloads the forecast and publishes the values', async () => {
  const { fetch, calls } = fakeFetch();
  globalThis.fetch = fetch;

  await solarForecast.onPoll(gladys, config, NOW);

  assert.equal(calls.length, 1);
  const byKey = Object.fromEntries(
    gladys.published.map(({ featureExternalId, state }) => [
      featureExternalId.split(':').pop(),
      state,
    ]),
  );
  assert.deepEqual(byKey, {
    'power-now': 710,
    'energy-today': 5.35,
    'energy-remaining-today': 2,
    'energy-tomorrow': 4.51,
  });
  assert.deepEqual(gladys.connectionStatuses, [{ connected: true, message: undefined }]);
});

test('the forecast is downloaded once per refresh interval', async () => {
  const { fetch, calls } = fakeFetch();
  globalThis.fetch = fetch;

  for (let minute = 0; minute < 60; minute += 1) {
    await solarForecast.onPoll(gladys, config, NOW + minute * MINUTE);
  }
  assert.equal(calls.length, 1, 'one download for 60 polls');

  await solarForecast.onPoll(gladys, config, NOW + 60 * MINUTE);
  assert.equal(calls.length, 2, 'downloaded again after refresh_interval');
});

test('values are published every 5 minutes between two downloads', async () => {
  globalThis.fetch = fakeFetch().fetch;

  for (let minute = 0; minute < 15; minute += 1) {
    await solarForecast.onPoll(gladys, config, NOW + minute * MINUTE);
  }
  // Publications at minute 0, 5 and 10, 4 values each.
  assert.equal(gladys.published.length, ((15 * MINUTE) / PUBLISH_INTERVAL_MS) * 4);
});

test('a failed download is reported and retried later, not every minute', async () => {
  const { fetch, calls } = fakeFetch({ status: 429, body: null });
  globalThis.fetch = fetch;

  await solarForecast.onPoll(gladys, config, NOW);
  assert.equal(calls.length, 1);
  assert.equal(gladys.published.length, 0);
  assert.equal(gladys.connectionStatuses[0].connected, false);
  assert.match(gladys.connectionStatuses[0].message.fr, /Limite de requêtes/);

  await solarForecast.onPoll(gladys, config, NOW + MINUTE);
  assert.equal(calls.length, 1, 'no retry one minute later');

  await solarForecast.onPoll(gladys, config, NOW + ERROR_RETRY_MS);
  assert.equal(calls.length, 2, 'retry after the error delay');
});

test('an error keeps the previous forecast in use', async () => {
  globalThis.fetch = fakeFetch().fetch;
  await solarForecast.onPoll(gladys, config, NOW);

  globalThis.fetch = fakeFetch({ status: 503, body: null }).fetch;
  gladys.published.length = 0;
  await solarForecast.onPoll(gladys, config, NOW + 60 * MINUTE);
  assert.equal(gladys.published.length, 4, 'values still published from the cache');
  assert.equal(gladys.connectionStatuses.at(-1).connected, false);
});

test('polls are ignored while the configuration is incomplete', async () => {
  const { fetch, calls } = fakeFetch();
  globalThis.fetch = fetch;
  await solarForecast.onPoll(gladys, normalizeConfig(), NOW);
  assert.equal(calls.length, 0);
  assert.equal(gladys.published.length, 0);
});

test('test_forecast action downloads now and summarizes the result', async () => {
  const { fetch, calls } = fakeFetch();
  globalThis.fetch = fetch;
  const message = await solarForecast.actions.test_forecast(gladys, { config });
  assert.equal(calls.length, 1);
  assert.match(message.en, /kWh today/);
  assert.match(message.fr, /kWh aujourd'hui/);
});

test('test_forecast action explains an incomplete configuration', async () => {
  const message = await solarForecast.actions.test_forecast(gladys, {
    config: normalizeConfig(),
  });
  assert.match(message.en, /latitude, longitude, kwp/);
});

test('resendStatus repeats the last known status', async () => {
  globalThis.fetch = fakeFetch().fetch;
  await solarForecast.onPoll(gladys, config, NOW);
  await solarForecast.resendStatus(gladys);
  assert.deepEqual(gladys.connectionStatuses.at(-1), { connected: true, message: undefined });
});
