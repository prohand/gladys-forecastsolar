import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeForecastValues,
  dayKey,
  interpolate,
  nextDayKey,
  toPoints,
} from '../src/forecast.js';
import { ESTIMATE } from './helpers/fixtures.js';

const forecast = {
  watts: ESTIMATE.result.watts,
  wattHours: ESTIMATE.result.watt_hours,
  wattHoursDay: ESTIMATE.result.watt_hours_day,
  timezone: 'Europe/Paris',
};

test('interpolate is linear between two points and fixed outside', () => {
  const points = [
    [0, 0],
    [10, 100],
  ];
  assert.equal(interpolate(points, 5), 50);
  assert.equal(interpolate(points, 10), 100);
  assert.equal(interpolate(points, -1, { before: 7 }), 7);
  assert.equal(interpolate(points, 11, { after: 9 }), 9);
  assert.equal(interpolate([], 3), 0);
});

test('toPoints sorts the series by time', () => {
  const points = toPoints({ '2026-10-02T10:00:00+02:00': 2, '2026-10-02T09:00:00+02:00': 1 });
  assert.deepEqual(
    points.map(([, v]) => v),
    [1, 2],
  );
});

test('dayKey uses the timezone of the plane', () => {
  // 23:30 UTC on Oct 2 is already Oct 3 in Paris.
  assert.equal(dayKey(new Date('2026-10-02T23:30:00Z'), 'Europe/Paris'), '2026-10-03');
  assert.equal(dayKey(new Date('2026-10-02T23:30:00Z'), 'UTC'), '2026-10-02');
});

test('nextDayKey handles month ends and DST days', () => {
  assert.equal(nextDayKey('2026-10-31'), '2026-11-01');
  assert.equal(nextDayKey('2026-03-28'), '2026-03-29');
  assert.equal(nextDayKey('2026-12-31'), '2027-01-01');
});

test('values in the afternoon', () => {
  const values = computeForecastValues(forecast, new Date('2026-10-02T15:00:00+02:00'));
  assert.deepEqual(values, {
    powerNow: 710,
    energyToday: 5.35,
    energyRemainingToday: 2, // 5354 - 3353 Wh
    energyTomorrow: 4.51,
  });
});

test('power is interpolated between two forecast points', () => {
  const values = computeForecastValues(forecast, new Date('2026-10-02T15:30:00+02:00'));
  assert.equal(values.powerNow, 729); // (710 + 748) / 2
});

test('values before sunrise and after sunset', () => {
  const night = computeForecastValues(forecast, new Date('2026-10-02T05:00:00+02:00'));
  assert.equal(night.powerNow, 0);
  assert.equal(night.energyRemainingToday, 5.35);

  const evening = computeForecastValues(forecast, new Date('2026-10-02T22:00:00+02:00'));
  assert.equal(evening.powerNow, 0);
  assert.equal(evening.energyRemainingToday, 0);
  assert.equal(evening.energyToday, 5.35);
});

test('a cache from yesterday still gives today but not tomorrow', () => {
  const values = computeForecastValues(forecast, new Date('2026-10-03T12:00:00+02:00'));
  assert.equal(values.energyToday, 4.51);
  assert.equal(values.energyTomorrow, null);
  assert.equal(values.powerNow, 557);
});

test('a forecast that is far too old gives no value', () => {
  const values = computeForecastValues(forecast, new Date('2026-10-10T12:00:00+02:00'));
  assert.deepEqual(values, {
    powerNow: null,
    energyToday: null,
    energyRemainingToday: null,
    energyTomorrow: null,
  });
});
