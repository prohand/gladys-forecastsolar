import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  NOT_READY_MESSAGE,
  bestWindowContent,
  emptyContent,
  solarForecastContent,
} from '../src/widgets.js';
import { createFakeGladys, HOUSES } from './helpers/fakeGladys.js';
import { deviceIds } from '../src/devices/solarForecast.js';
import { FORECAST, at } from './helpers/fixtures.js';

const gladys = createFakeGladys();
const now = at('2026-10-02T15:00:00+02:00');

test('solar_forecast content fits the widget vocabulary and budget', () => {
  const content = solarForecastContent({
    forecast: FORECAST,
    ids: deviceIds(gladys, HOUSES[0]),
    houseName: 'Home',
    fetchedAt: at('2026-10-02T14:51:00+02:00'),
    now,
  });
  assert.deepEqual(validateWidgetContent(content), []);
  const chart = content.components.find((c) => c.type === 'chart');
  assert.equal(chart.series[0].points.length, Object.keys(FORECAST.watts).length);
  const status = content.components.find((c) => c.type === 'status');
  assert.equal(status.items[0].value, '748 W · 16:00');
  assert.equal(status.items[1].value, '07:51 → 19:28');
  assert.equal(status.items[2].value, '14:51');
});

test('solar_best_window content fits the widget vocabulary and budget', () => {
  const content = bestWindowContent({
    forecast: FORECAST,
    houseName: 'Home',
    durationHours: 2,
    now,
  });
  assert.deepEqual(validateWidgetContent(content), []);
  const start = content.components.find((c) => c.type === 'value');
  assert.equal(start.value, '15:00');
});

test('solar_best_window switches to tomorrow after sunset', () => {
  const content = bestWindowContent({
    forecast: FORECAST,
    houseName: 'Home',
    durationHours: 2,
    now: at('2026-10-02T20:00:00+02:00'),
  });
  assert.deepEqual(validateWidgetContent(content), []);
  const start = content.components.find((c) => c.type === 'value');
  assert.equal(start.label.en, 'Start tomorrow');
});

test('the empty content is valid', () => {
  assert.deepEqual(validateWidgetContent(emptyContent(NOT_READY_MESSAGE)), []);
});
