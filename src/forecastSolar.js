// -----------------------------------------------------------------------------
// Forecast.Solar API client.
//
// One call to the "estimate" endpoint returns the forecast of one solar plane
// for today and tomorrow (free plan):
//   GET https://api.forecast.solar[/:apikey]/estimate/:lat/:lon/:dec/:az/:kwp
// See https://doc.forecast.solar/api:estimate
//
// Free plan limit: 12 requests per hour and per IP address. The caller keeps
// the result in cache and only calls this module every `refresh_interval`.
//
// Node 20+ provides `fetch` natively: no dependency needed.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'forecast-solar' });

const API_BASE_URL = 'https://api.forecast.solar';

/** Error returned by Forecast.Solar (bad parameters, rate limit, outage…). */
export class ForecastSolarError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'ForecastSolarError';
    this.status = status;
  }

  get isRateLimited() {
    return this.status === 429;
  }
}

/**
 * Build the "estimate" URL for the configured plane.
 * `time=iso8601` returns timestamps with their UTC offset, so they can be
 * parsed with `new Date()` whatever the timezone of the container.
 */
export function buildEstimateUrl({ latitude, longitude, declination, azimuth, kwp, api_key }) {
  const key = api_key ? `/${encodeURIComponent(api_key)}` : '';
  const plane = [latitude, longitude, declination, azimuth, kwp].join('/');
  return `${API_BASE_URL}${key}/estimate/${plane}?time=iso8601`;
}

/**
 * Download the forecast of the configured plane.
 * @returns {Promise<{
 *   watts: Record<string, number>,
 *   wattHours: Record<string, number>,
 *   wattHoursDay: Record<string, number>,
 *   timezone: string | undefined,
 *   place: string | undefined,
 * }>}
 */
export async function fetchForecast(config) {
  const url = buildEstimateUrl(config);
  // Never log the API key.
  const loggedUrl = config.api_key ? url.replace(/[^/]+\/estimate\//, '***/estimate/') : url;
  logger.debug('Forecast.Solar request ->', loggedUrl);

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (proxy error page…): handled below with the HTTP status.
  }

  const message = body?.message ?? {};
  if (!response.ok || message.type === 'error') {
    const text = message.text || `HTTP ${response.status}`;
    throw new ForecastSolarError(`Forecast.Solar: ${text}`, { status: response.status });
  }

  const result = body?.result;
  if (!result?.watts || !result?.watt_hours || !result?.watt_hours_day) {
    throw new ForecastSolarError('Forecast.Solar: unexpected answer format', {
      status: response.status,
    });
  }

  const ratelimit = message.ratelimit;
  if (ratelimit) {
    logger.debug(`Rate limit: ${ratelimit.remaining}/${ratelimit.limit} requests left`);
  }

  return {
    watts: result.watts,
    wattHours: result.watt_hours,
    wattHoursDay: result.watt_hours_day,
    timezone: message.info?.timezone,
    place: message.info?.place,
  };
}
