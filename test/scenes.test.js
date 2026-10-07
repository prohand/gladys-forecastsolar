import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_EVENT_DELAY_MS,
  SCENE_TRIGGERS,
  bestWindowOutputs,
  dueProductionEvents,
  forecastUpdatedEvent,
  getForecastOutputs,
  nextHoursOutputs,
} from '../src/scenes.js';
import { FORECAST, at } from './helpers/fixtures.js';

const DEVICE = 'ext:forecast-solar:solar-forecast:house-1';

test('forecast_updated carries the current values', () => {
  const { key, data } = forecastUpdatedEvent(
    FORECAST,
    DEVICE,
    'Home',
    at('2026-10-02T15:00:00+02:00'),
  );
  assert.equal(key, SCENE_TRIGGERS.FORECAST_UPDATED);
  assert.deepEqual(data, {
    device: DEVICE,
    house: 'Home',
    power_now: 710,
    energy_today: 5.35,
    energy_remaining_today: 2,
    energy_tomorrow: 4.51,
    peak_power: 748,
    peak_time: '16:00',
  });
});

test('production events fire once, when their moment is crossed', () => {
  const before = at('2026-10-02T15:59:00+02:00');
  const after = at('2026-10-02T16:00:00+02:00');
  const events = dueProductionEvents(FORECAST, DEVICE, 'Home', before, after);
  assert.deepEqual(
    events.map((e) => e.key),
    [SCENE_TRIGGERS.PRODUCTION_PEAK],
  );
  assert.equal(events[0].data.peak_power, 748);
  // The next minute: nothing new.
  assert.deepEqual(dueProductionEvents(FORECAST, DEVICE, 'Home', after, after + 60000), []);
});

test('a new download moving the peak later does not fire it a second time', () => {
  const fired = new Set();
  const first = dueProductionEvents(
    FORECAST,
    DEVICE,
    'Home',
    at('2026-10-02T15:59:00+02:00'),
    at('2026-10-02T16:00:00+02:00'),
    fired,
  );
  assert.deepEqual(
    first.map((e) => e.key),
    [SCENE_TRIGGERS.PRODUCTION_PEAK],
  );
  // The hourly download now puts the peak at 17:00.
  const moved = { ...FORECAST, watts: { ...FORECAST.watts, '2026-10-02T17:00:00+02:00': 800 } };
  const again = dueProductionEvents(
    moved,
    DEVICE,
    'Home',
    at('2026-10-02T16:59:00+02:00'),
    at('2026-10-02T17:00:00+02:00'),
    fired,
  );
  assert.deepEqual(again, []);
});

test('start and end events follow sunrise and sunset', () => {
  const start = dueProductionEvents(
    FORECAST,
    DEVICE,
    'Home',
    at('2026-10-02T07:51:00+02:00'),
    at('2026-10-02T07:52:00+02:00'),
  );
  assert.deepEqual(
    start.map((e) => e.key),
    [SCENE_TRIGGERS.PRODUCTION_STARTED],
  );
  const end = dueProductionEvents(
    FORECAST,
    DEVICE,
    'Home',
    at('2026-10-02T19:28:00+02:00'),
    at('2026-10-02T19:29:00+02:00'),
  );
  assert.deepEqual(
    end.map((e) => e.key),
    [SCENE_TRIGGERS.PRODUCTION_ENDED],
  );
});

test('events found too late are dropped', () => {
  const from = at('2026-10-02T15:00:00+02:00');
  const to = at('2026-10-02T16:00:00+02:00') + MAX_EVENT_DELAY_MS + 60000;
  assert.deepEqual(dueProductionEvents(FORECAST, DEVICE, 'Home', from, to), []);
});

test('get_forecast outputs', () => {
  assert.deepEqual(getForecastOutputs(FORECAST, at('2026-10-02T15:00:00+02:00')), {
    power_now: 710,
    energy_today: 5.35,
    energy_remaining_today: 2,
    energy_tomorrow: 4.51,
    peak_power: 748,
    peak_time: '16:00',
  });
});

test('get_production_next_hours outputs', () => {
  const outputs = nextHoursOutputs(FORECAST, at('2026-10-02T15:00:00+02:00'), 2);
  // 15:00 → 17:00: 729 + 652 Wh (watt_hours_period of Forecast.Solar).
  assert.deepEqual(outputs, { energy: 1.38, average_power: 691, max_power: 748 });
});

test('find_best_window outputs, today and tomorrow', () => {
  const now = at('2026-10-02T10:00:00+02:00');
  const today = bestWindowOutputs(FORECAST, now, { durationHours: 2, day: 'today' });
  assert.deepEqual(today, {
    found: true,
    start_time: '14:30',
    end_time: '16:30',
    energy: 1.42,
    minutes_until_start: 270,
  });
  const tomorrow = bestWindowOutputs(FORECAST, now, { durationHours: 1, day: 'tomorrow' });
  assert.equal(tomorrow.found, true);
  assert.equal(tomorrow.start_time, '13:00');
});

test('find_best_window after sunset finds nothing today', () => {
  const outputs = bestWindowOutputs(FORECAST, at('2026-10-02T20:00:00+02:00'), {
    durationHours: 2,
    day: 'today',
  });
  assert.deepEqual(outputs, {
    found: false,
    start_time: '',
    end_time: '',
    energy: 0,
    minutes_until_start: 0,
  });
});
