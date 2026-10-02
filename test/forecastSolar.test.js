import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildEstimateUrl, fetchForecast, ForecastSolarError } from '../src/forecastSolar.js';
import { normalizeConfig } from '../src/config.js';
import { ESTIMATE, fakeFetch } from './helpers/fixtures.js';

const realFetch = globalThis.fetch;
const config = {
  ...normalizeConfig({ wp: 3000, declination: 30 }),
  latitude: 48.8566,
  longitude: 2.3522,
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('buildEstimateUrl describes the plane in the path', () => {
  assert.equal(
    buildEstimateUrl(config),
    'https://api.forecast.solar/estimate/48.8566/2.3522/30/0/3?time=iso8601',
  );
});

test('buildEstimateUrl puts the API key before /estimate', () => {
  assert.equal(
    buildEstimateUrl({ ...config, api_key: 'my key' }),
    'https://api.forecast.solar/my%20key/estimate/48.8566/2.3522/30/0/3?time=iso8601',
  );
});

test('fetchForecast returns the useful parts of the answer', async () => {
  globalThis.fetch = fakeFetch().fetch;
  const forecast = await fetchForecast(config);
  assert.deepEqual(forecast.wattHoursDay, ESTIMATE.result.watt_hours_day);
  assert.equal(forecast.watts, ESTIMATE.result.watts);
  assert.equal(forecast.wattHours, ESTIMATE.result.watt_hours);
  assert.equal(forecast.timezone, 'Europe/Paris');
  assert.match(forecast.place, /Paris/);
});

test('fetchForecast throws the Forecast.Solar error text', async () => {
  globalThis.fetch = fakeFetch({
    status: 400,
    body: {
      result: 'Invalid plane',
      message: { code: 602, type: 'error', text: "Declination '300' not in range 0 .. 90" },
    },
  }).fetch;
  await assert.rejects(
    () => fetchForecast(config),
    (err) =>
      err instanceof ForecastSolarError &&
      err.status === 400 &&
      !err.isRateLimited &&
      /Declination '300'/.test(err.message),
  );
});

test('fetchForecast flags the rate limit', async () => {
  globalThis.fetch = fakeFetch({ status: 429, body: null }).fetch;
  await assert.rejects(
    () => fetchForecast(config),
    (err) => err.isRateLimited && /HTTP 429/.test(err.message),
  );
});

test('fetchForecast rejects an unexpected answer', async () => {
  globalThis.fetch = fakeFetch({ body: { result: {}, message: { type: 'success' } } }).fetch;
  await assert.rejects(() => fetchForecast(config), /unexpected answer format/);
});
