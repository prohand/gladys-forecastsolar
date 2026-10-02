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

/**
 * Energy (Wh) between two times: exact integral of the piecewise-linear power
 * curve (the same trapezoid rule Forecast.Solar uses for `watt_hours_period`).
 */
export function energyBetween(forecast, from, to) {
  const points = toPoints(forecast.watts);
  let wh = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [t0, v0] = points[i - 1];
    const [t1, v1] = points[i];
    const start = Math.max(t0, from);
    const end = Math.min(t1, to);
    if (end <= start || t1 === t0) {
      continue;
    }
    const valueAt = (time) => v0 + ((v1 - v0) * (time - t0)) / (t1 - t0);
    wh += ((valueAt(start) + valueAt(end)) / 2) * ((end - start) / 3600_000);
  }
  return wh;
}

/** Highest power (W) of the curve between two times. */
export function maxPowerBetween(forecast, from, to) {
  const points = toPoints(forecast.watts);
  const inside = points.filter(([time]) => time > from && time < to).map(([, value]) => value);
  inside.push(interpolate(points, from), interpolate(points, to));
  return Math.max(0, ...inside);
}

/**
 * Production profile of one day: start (sunrise point before the first
 * positive power), end (first zero after the last positive power) and peak.
 * Times in ms; null when the forecast does not cover the day.
 */
export function dayProfile(forecast, day) {
  const points = toPoints(forecast.watts).filter(
    ([time]) => dayKey(new Date(time), forecast.timezone) === day,
  );
  if (points.length === 0) {
    return null;
  }
  const firstPositive = points.findIndex(([, value]) => value > 0);
  if (firstPositive === -1) {
    return { start: null, end: null, peakTime: null, peakPower: 0 };
  }
  const lastPositive = points.findLastIndex(([, value]) => value > 0);
  const peak = points.reduce((best, point) => (point[1] > best[1] ? point : best));
  return {
    start: points[Math.max(0, firstPositive - 1)][0],
    end: points[Math.min(points.length - 1, lastPositive + 1)][0],
    peakTime: peak[0],
    peakPower: Math.round(peak[1]),
  };
}

/**
 * Best window of `durationMs` between `from` and `to`: the one with the most
 * estimated energy, tested every `stepMs` (15 min by default).
 * @returns {{ start: number, end: number, energyWh: number } | null}
 */
export function bestWindow(forecast, { from, to, durationMs, stepMs = 15 * 60 * 1000 }) {
  let best = null;
  for (let start = Math.ceil(from / stepMs) * stepMs; start + durationMs <= to; start += stepMs) {
    const energyWh = energyBetween(forecast, start, start + durationMs);
    if (!best || energyWh > best.energyWh) {
      best = { start, end: start + durationMs, energyWh };
    }
  }
  return best && best.energyWh > 0 ? best : null;
}

/** "HH:MM" in the timezone of the plane. */
export function formatTime(time, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(time));
}

/** Time range [first point, last point] of one day of the forecast, or null. */
export function dayRange(forecast, day) {
  const points = toPoints(forecast.watts).filter(
    ([time]) => dayKey(new Date(time), forecast.timezone) === day,
  );
  if (points.length === 0) {
    return null;
  }
  return { from: points[0][0], to: points[points.length - 1][0] };
}

export { whToKwh };
