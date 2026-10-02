// -----------------------------------------------------------------------------
// Turn a Forecast.Solar answer into the values published in Gladys.
//
// Pure functions (no I/O): the forecast is downloaded once per refresh
// interval, while these values are recomputed on every poll from the cache,
// so "power now" follows the sun between two downloads.
// -----------------------------------------------------------------------------

/**
 * Sorted [timestampMs, value] points from a `{ "<ISO date>": value }` object.
 */
export function toPoints(series = {}) {
  return Object.entries(series)
    .map(([date, value]) => [new Date(date).getTime(), Number(value)])
    .filter(([time, value]) => Number.isFinite(time) && Number.isFinite(value))
    .sort((a, b) => a[0] - b[0]);
}

/**
 * Linear interpolation between the two points around `time`.
 * Before the first point -> `before`, after the last point -> `after`.
 */
export function interpolate(points, time, { before = 0, after = 0 } = {}) {
  if (points.length === 0 || time < points[0][0]) {
    return before;
  }
  if (time > points[points.length - 1][0]) {
    return after;
  }
  for (let i = 1; i < points.length; i += 1) {
    const [t1, v1] = points[i];
    if (time <= t1) {
      const [t0, v0] = points[i - 1];
      if (t1 === t0) {
        return v1;
      }
      return v0 + ((v1 - v0) * (time - t0)) / (t1 - t0);
    }
  }
  return points[0][1];
}

/**
 * Day key ("YYYY-MM-DD") of a date in the timezone of the solar plane, the
 * same format as the keys of `watt_hours_day`.
 */
export function dayKey(date, timeZone) {
  // The en-CA locale formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** The day after a "YYYY-MM-DD" key (no timezone / DST trap: pure calendar). */
export function nextDayKey(key) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

const round = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const whToKwh = (wh) => round(wh / 1000, 2);

/**
 * Compute the published values at a given time.
 * A value is `null` when the forecast does not cover it (e.g. a cache from
 * yesterday): the caller then simply does not publish it.
 *
 * @param {{ watts: object, wattHours: object, wattHoursDay: object, timezone?: string }} forecast
 * @param {Date} [now]
 * @returns {{
 *   powerNow: number | null,
 *   energyToday: number | null,
 *   energyRemainingToday: number | null,
 *   energyTomorrow: number | null,
 * }}
 */
export function computeForecastValues(forecast, now = new Date()) {
  const time = now.getTime();
  const today = dayKey(now, forecast.timezone);
  const tomorrow = nextDayKey(today);

  const todayWh = forecast.wattHoursDay?.[today];
  const tomorrowWh = forecast.wattHoursDay?.[tomorrow];

  // Power: interpolated between the forecast points (0 at night). Outside the
  // forecast window the value is unknown, not 0.
  const powerPoints = toPoints(forecast.watts);
  const covered =
    powerPoints.length > 0 &&
    time >= powerPoints[0][0] - 24 * 3600 * 1000 &&
    time <= powerPoints[powerPoints.length - 1][0] + 24 * 3600 * 1000;
  const powerNow = covered ? Math.max(0, Math.round(interpolate(powerPoints, time))) : null;

  // Remaining today: today's total minus the energy already produced, read on
  // the cumulative `watt_hours` curve of today.
  let energyRemainingToday = null;
  if (todayWh !== undefined) {
    const todayPoints = toPoints(forecast.wattHours).filter(
      ([pointTime]) => dayKey(new Date(pointTime), forecast.timezone) === today,
    );
    const producedWh = interpolate(todayPoints, time, {
      before: 0,
      after: todayPoints.length > 0 ? todayPoints[todayPoints.length - 1][1] : 0,
    });
    energyRemainingToday = whToKwh(Math.max(0, todayWh - producedWh));
  }

  return {
    powerNow,
    energyToday: todayWh === undefined ? null : whToKwh(todayWh),
    energyRemainingToday,
    energyTomorrow: tomorrowWh === undefined ? null : whToKwh(tomorrowWh),
  };
}
