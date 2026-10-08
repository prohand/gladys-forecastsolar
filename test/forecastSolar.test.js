import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEstimateUrl,
  fetchForecast,
  ForecastSolarError,
  readRetryAt,
  redactedEstimateUrl,
} from '../src/forecastSolar.js';
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

test('the logged URL hides the coordinates and the API key', () => {
  const url = redactedEstimateUrl({ ...config, api_key: 'secret-key' });
  assert.equal(url, 'https://api.forecast.solar/***/estimate/***/***/30/0/3?time=iso8601');
  assert.doesNotMatch(url, /48\.85|2\.35|secret/);
  assert.doesNotMatch(redactedEstimateUrl(config), /48\.85|2\.35/);
});

test('a 429 carries the retry-at time of the body, or of the header', async () => {
  globalThis.fetch = fakeFetch({
    status: 429,
    body: {
      result: null,
      message: {
        code: 429,
        type: 'error',
        text: 'Rate limit for API calls reached.',
        ratelimit: { period: 3600, limit: 12, 'retry-at': '2026-10-02T15:42:00+02:00' },
      },
    },
  }).fetch;
  await assert.rejects(
    () => fetchForecast(config),
    (err) => err.isRateLimited && err.retryAt === new Date('2026-10-02T15:42:00+02:00').getTime(),
  );

  const headers = new Headers({ 'X-Ratelimit-Retry-At': '2026-10-02T16:00:00+02:00' });
  assert.equal(readRetryAt(null, headers), new Date('2026-10-02T16:00:00+02:00').getTime());
  assert.equal(readRetryAt({ message: {} }, undefined), null);
});
