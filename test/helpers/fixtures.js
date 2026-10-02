// Real Forecast.Solar answer (Paris, 3 kWp, 30° tilt, south), captured on
// 2026-10-02 with `?time=iso8601`.
import { readFile } from 'node:fs/promises';

export const ESTIMATE = JSON.parse(
  await readFile(new URL('../fixtures/estimate.json', import.meta.url), 'utf8'),
);

/** The fixture in the format returned by fetchForecast(). */
export const FORECAST = {
  watts: ESTIMATE.result.watts,
  wattHours: ESTIMATE.result.watt_hours,
  wattHoursDay: ESTIMATE.result.watt_hours_day,
  timezone: ESTIMATE.message.info.timezone,
  place: ESTIMATE.message.info.place,
};

/** A fetch stub answering the fixture, counting the calls. */
export function fakeFetch({ status = 200, body = ESTIMATE } = {}) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetch, calls };
}

/** Milliseconds of an ISO date. */
export const at = (iso) => new Date(iso).getTime();
