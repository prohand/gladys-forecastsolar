import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, ERROR_RETRY_MS, PUBLISH_INTERVAL_MS } from '../src/app.js';
import { deviceIds, POLL_FREQUENCY_MS } from '../src/devices/solarForecast.js';
import { ForecastSolarError } from '../src/forecastSolar.js';
import { WIDGETS } from '../src/widgets.js';
import { SCENE_TRIGGERS } from '../src/scenes.js';
import { createFakeGladys, HOUSES } from './helpers/fakeGladys.js';
import { FORECAST, at } from './helpers/fixtures.js';

const MINUTE = 60 * 1000;
// Poll frequencies accepted by the Gladys core, in milliseconds.
const GLADYS_POLL_FREQUENCIES = [60000, 30000, 15000, 10000, 2000, 1000];

/** App with a fake clock and a fake API client counting the downloads. */
function setup({ fail = null, createdDevices, houses } = {}) {
  const gladys = createFakeGladys({ houses, createdDevices });
  const clock = { now: at('2026-10-02T15:00:00+02:00') };
  const calls = [];
  const app = createApp(gladys, {
    now: () => clock.now,
    fetchForecastImpl: async (plane) => {
      calls.push(plane);
      if (fail) {
        throw fail;
      }
      return FORECAST;
    },
  });
  app.setConfig({ wp: 3000, declination: 30 });
  const device = { external_id: deviceIds(gladys, HOUSES[0]).device };
  return { gladys, clock, calls, app, device };
}

test('one device is discovered per located house', async () => {
  const { app } = setup();
  const devices = await app.discoveredDevices();
  assert.equal(devices.length, 1, 'the house without location is skipped');
  assert.equal(devices[0].name, 'Solar forecast (Home)');
  assert.ok(GLADYS_POLL_FREQUENCIES.includes(devices[0].poll_frequency));
  assert.equal(devices[0].poll_frequency, POLL_FREQUENCY_MS);
  // Without should_poll the core never schedules the device.
  assert.equal(devices[0].should_poll, true);
  assert.equal(devices[0].features.length, 4);
});

test('the forecast is requested at the location of the house', async () => {
  const { app, calls, device } = setup();
  await app.loadHouses();
  await app.poll(device);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].latitude, 48.8566);
  assert.equal(calls[0].longitude, 2.3522);
  assert.equal(calls[0].kwp, 3);
});

test('first poll publishes the values and fires forecast_updated', async () => {
  const { app, gladys, device } = setup();
  await app.loadHouses();
  await app.poll(device);
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
  assert.deepEqual(
    gladys.sceneEvents.map((e) => e.key),
    [SCENE_TRIGGERS.FORECAST_UPDATED],
  );
  assert.equal(gladys.sceneEvents[0].data.device, device.external_id);
  assert.deepEqual(gladys.widgetRefreshes.sort(), Object.values(WIDGETS).sort());
});

test('the forecast is downloaded once per refresh interval, values every 5 min', async () => {
  const { app, gladys, calls, clock, device } = setup();
  await app.loadHouses();
  const start = clock.now;
  for (let minute = 0; minute < 60; minute += 1) {
    clock.now = start + minute * MINUTE;
    await app.poll(device);
  }
  assert.equal(calls.length, 1, 'one download for 60 polls');
  assert.equal(gladys.published.length, ((60 * MINUTE) / PUBLISH_INTERVAL_MS) * 4);

  clock.now = start + 60 * MINUTE;
  await app.poll(device);
  assert.equal(calls.length, 2, 'downloaded again after refresh_interval');
});

test('the production peak fires a scene event when crossed', async () => {
  const { app, gladys, clock, device } = setup();
  await app.loadHouses();
  clock.now = at('2026-10-02T15:58:00+02:00');
  await app.poll(device);
  clock.now = at('2026-10-02T15:59:00+02:00');
  await app.poll(device);
  assert.ok(!gladys.sceneEvents.some((e) => e.key === SCENE_TRIGGERS.PRODUCTION_PEAK));
  clock.now = at('2026-10-02T16:00:00+02:00');
  await app.poll(device);
  assert.ok(gladys.sceneEvents.some((e) => e.key === SCENE_TRIGGERS.PRODUCTION_PEAK));
});

test('a past event is not fired at startup', async () => {
  const { app, gladys, clock, device } = setup();
  await app.loadHouses();
  clock.now = at('2026-10-02T16:01:00+02:00'); // peak was 1 minute ago
  await app.poll(device);
  assert.ok(!gladys.sceneEvents.some((e) => e.key === SCENE_TRIGGERS.PRODUCTION_PEAK));
});

test('a failed download is reported and retried later, not every minute', async () => {
  const { app, gladys, calls, clock, device } = setup({
    fail: new ForecastSolarError('Forecast.Solar: HTTP 429', { status: 429 }),
  });
  await app.loadHouses();
  await app.poll(device);
  assert.equal(calls.length, 1);
  assert.equal(gladys.published.length, 0);
  const status = gladys.connectionStatuses.at(-1);
  assert.equal(status.connected, false);
  assert.match(status.message.fr, /Home : Limite de requêtes/);

  clock.now += MINUTE;
  await app.poll(device);
  assert.equal(calls.length, 1, 'no retry one minute later');

  clock.now += ERROR_RETRY_MS;
  await app.poll(device);
  assert.equal(calls.length, 2, 'retry after the error delay');
});

test('changing the panels or the house location downloads again', async () => {
  const { app, gladys, calls, clock, device } = setup();
  await app.loadHouses();
  await app.poll(device);
  app.setConfig({ wp: 6000, declination: 30 });
  await app.poll(device);
  assert.equal(calls.length, 2);
  gladys.houses = [{ ...HOUSES[0], latitude: 45.75, longitude: 4.85 }];
  await app.loadHouses();
  clock.now += MINUTE;
  await app.poll(device);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].latitude, 45.75);
});

test('synchronize publishes devices, refreshes created ones and reports the status', async () => {
  const gladysDevice = { external_id: 'ext:forecast-solar:solar-forecast:house-1' };
  const { app, gladys, calls } = setup({ createdDevices: [gladysDevice] });
  await app.synchronize();
  assert.equal(gladys.discovered.at(-1).length, 1);
  assert.equal(calls.length, 1, 'the created device is refreshed right away');
  assert.deepEqual(gladys.connectionStatuses.at(-1), { connected: true, message: undefined });
});

test('no located house is reported in the Configuration screen', async () => {
  const { app, gladys } = setup({ houses: [HOUSES[1]] });
  await app.synchronize();
  const status = gladys.connectionStatuses.at(-1);
  assert.equal(status.connected, false);
  assert.match(status.message.fr, /Aucune maison localisée/);
});

test('an incomplete configuration is reported and nothing is downloaded', async () => {
  const { app, gladys, calls, device } = setup();
  app.setConfig({});
  await app.synchronize();
  await app.poll(device);
  assert.equal(calls.length, 0);
  assert.match(gladys.connectionStatuses.at(-1).message.en, /wp/);
});

test('test_forecast downloads now and summarizes each house', async () => {
  const { app, calls } = setup();
  const message = await app.actions.test_forecast();
  assert.equal(calls.length, 1);
  assert.equal(message.en, 'Home: 5.35 kWh today, 4.51 kWh tomorrow');
  assert.equal(message.fr, "Home : 5.35 kWh aujourd'hui, 4.51 kWh demain");
});

test('scene actions read the forecast of the chosen device', async () => {
  const { app, device, gladys } = setup();
  await app.loadHouses();
  const forecast = await app.sceneActions.get_forecast({ device: device.external_id });
  assert.equal(forecast.energy_tomorrow, 4.51);
  const next = await app.sceneActions.get_production_next_hours({
    device: device.external_id,
    hours: 2,
  });
  assert.equal(next.energy, 1.38);
  const best = await app.sceneActions.find_best_window({
    device: device.external_id,
    duration_hours: 1,
    day: 'tomorrow',
  });
  assert.equal(best.found, true);
  assert.equal(gladys.sceneEvents.length, 0, 'a scene action never fires a scene event');
});

test('scene actions fail clearly on an unknown device', async () => {
  const { app } = setup();
  await app.loadHouses();
  await assert.rejects(() => app.sceneActions.get_forecast({ device: 'nope' }), /Unknown/);
});

test('widgets return a content, or a waiting message', async () => {
  const { app, device } = setup();
  await app.loadHouses();
  const content = await app.widgets[WIDGETS.SOLAR_FORECAST]({
    settings: { device: device.external_id },
  });
  assert.ok(content.components.some((c) => c.type === 'chart'));
  const best = await app.widgets[WIDGETS.BEST_WINDOW]({
    settings: { device: device.external_id, duration_hours: 3 },
  });
  assert.ok(best.components.some((c) => c.type === 'status'));
  const empty = await app.widgets[WIDGETS.SOLAR_FORECAST]({ settings: {} });
  assert.equal(empty.components[0].type, 'text');
});

test('a widget never waits past the deadline, nor downloads when it has a forecast', async () => {
  const gladys = createFakeGladys({});
  let release;
  let downloads = 0;
  const app = createApp(gladys, {
    now: () => at('2026-10-02T15:00:00+02:00'),
    fetchForecastImpl: () => {
      downloads += 1;
      return new Promise((resolve) => (release = () => resolve(FORECAST)));
    },
  });
  app.setConfig({ wp: 3000, declination: 30 });
  await app.loadHouses();
  const settings = { device: deviceIds(gladys, HOUSES[0]).device };

  const loading = await app.widgets[WIDGETS.SOLAR_FORECAST]({ settings }, { deadlineMs: 10 });
  assert.equal(loading.ttl_seconds, 15, 'a loading card, re-pulled shortly');
  release();
  await new Promise((resolve) => setImmediate(resolve));

  const content = await app.widgets[WIDGETS.SOLAR_FORECAST]({ settings }, { deadlineMs: 10 });
  assert.ok(content.components.some((c) => c.type === 'chart'));
  assert.equal(downloads, 1, 'the download the first pull started is the one used');
});

test('concurrent requests share one download', async () => {
  const { app, calls, device } = setup();
  await app.loadHouses();
  await Promise.all([
    app.poll(device),
    app.sceneActions.get_forecast({ device: device.external_id }),
    app.widgets[WIDGETS.SOLAR_FORECAST]({ settings: { device: device.external_id } }),
  ]);
  assert.equal(calls.length, 1);
});

test('two polls in the same minute evaluate once (core poll + own loop)', async () => {
  const gladysDevice = { external_id: 'ext:forecast-solar:solar-forecast:house-1' };
  const { app, gladys, clock } = setup({ createdDevices: [gladysDevice] });
  await app.loadHouses();
  await app.pollCreated();
  const published = gladys.published.length;
  assert.ok(published > 0, 'the own loop refreshes a created device');
  clock.now += 10 * 1000;
  await app.poll(gladysDevice);
  assert.equal(gladys.published.length, published);
  assert.equal(gladys.sceneEvents.length, 1, 'forecast_updated fired once');
});
