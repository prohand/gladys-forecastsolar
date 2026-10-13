import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  NOT_READY_MESSAGE,
  bestWindowContent,
  emptyContent,
  loadingContent,
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

test('every widget text is translated in English, French, German and Spanish', () => {
  const texts = [];
  const collect = (node) => {
    if (Array.isArray(node)) {
      node.forEach(collect);
    } else if (node && typeof node === 'object') {
      if (typeof node.en === 'string') {
        texts.push(node);
      } else {
        Object.values(node).forEach(collect);
      }
    }
  };
  collect([
    solarForecastContent({
      forecast: FORECAST,
      ids: deviceIds(gladys, HOUSES[0]),
      houseName: 'Home',
      fetchedAt: now,
      now,
    }),
    bestWindowContent({ forecast: FORECAST, houseName: 'Home', durationHours: 2, now }),
    bestWindowContent({
      forecast: FORECAST,
      houseName: 'Home',
      durationHours: 2,
      now: at('2026-10-02T20:00:00+02:00'),
    }),
    loadingContent(),
    NOT_READY_MESSAGE,
  ]);
  assert.ok(texts.length > 10);
  for (const text of texts) {
    assert.deepEqual(Object.keys(text).sort(), ['de', 'en', 'es', 'fr'], JSON.stringify(text));
  }
});
