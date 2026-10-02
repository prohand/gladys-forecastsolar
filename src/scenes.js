// -----------------------------------------------------------------------------
// Scene triggers and scene actions (manifest `scene_triggers` / `scene_actions`).
//
// Pure functions on a cached forecast: app.js finds the forecast of the house
// chosen in the scene, then calls these.
//
// Triggers are EVENTS ("production starts now"), fired once when the moment
// is reached. A threshold ("tomorrow > 10 kWh") is a STATE: use the standard
// Gladys "device value" trigger on the device features for that.
// -----------------------------------------------------------------------------

import {
  bestWindow,
  computeForecastValues,
  dayKey,
  dayProfile,
  dayRange,
  energyBetween,
  formatTime,
  maxPowerBetween,
  nextDayKey,
  whToKwh,
} from './forecast.js';

export const SCENE_TRIGGERS = {
  FORECAST_UPDATED: 'forecast_updated',
  PRODUCTION_STARTED: 'production_started',
  PRODUCTION_PEAK: 'production_peak',
  PRODUCTION_ENDED: 'production_ended',
};

// An event found more than this late (integration stopped, Gladys offline…)
// is dropped: a "production starts" event at 3 p.m. would be misleading.
export const MAX_EVENT_DELAY_MS = 15 * 60 * 1000;

const HOUR_MS = 3600 * 1000;

/** Data shared by every event of a house: lets a scene read the forecast. */
function commonData(forecast, deviceExternalId, houseName, now) {
  const values = computeForecastValues(forecast, new Date(now));
  return {
    device: deviceExternalId,
    house: houseName,
    power_now: values.powerNow,
    energy_today: values.energyToday,
    energy_remaining_today: values.energyRemainingToday,
    energy_tomorrow: values.energyTomorrow,
  };
}

/** Data of the "forecast updated" event, fired after each download. */
export function forecastUpdatedEvent(forecast, deviceExternalId, houseName, now) {
  const profile = dayProfile(forecast, dayKey(new Date(now), forecast.timezone));
  return {
    key: SCENE_TRIGGERS.FORECAST_UPDATED,
    data: {
      ...commonData(forecast, deviceExternalId, houseName, now),
      peak_power: profile?.peakPower ?? null,
      peak_time: profile?.peakTime ? formatTime(profile.peakTime, forecast.timezone) : null,
    },
  };
}

/**
 * Production events whose moment is in (from, to]: start, peak and end of
 * the estimated production of each day of the forecast.
 * @returns {Array<{ key: string, time: number, data: object }>}
 */
export function dueProductionEvents(forecast, deviceExternalId, houseName, from, to) {
  if (to - from <= 0) {
    return [];
  }
  const days = [...new Set(Object.keys(forecast.wattHoursDay ?? {}))];
  const events = [];
  for (const day of days) {
    const profile = dayProfile(forecast, day);
    if (!profile || profile.start === null) {
      continue;
    }
    const moments = [
      [SCENE_TRIGGERS.PRODUCTION_STARTED, profile.start],
      [SCENE_TRIGGERS.PRODUCTION_PEAK, profile.peakTime],
      [SCENE_TRIGGERS.PRODUCTION_ENDED, profile.end],
    ];
    for (const [key, time] of moments) {
      if (time > from && time <= to && to - time <= MAX_EVENT_DELAY_MS) {
        events.push({
          key,
          time,
          data: {
            ...commonData(forecast, deviceExternalId, houseName, to),
            peak_power: profile.peakPower,
            peak_time: formatTime(profile.peakTime, forecast.timezone),
          },
        });
      }
    }
  }
  return events.sort((a, b) => a.time - b.time);
}

/** Scene action `get_forecast`: the current values of the forecast. */
export function getForecastOutputs(forecast, now) {
  const values = computeForecastValues(forecast, new Date(now));
  const today = dayKey(new Date(now), forecast.timezone);
  const profile = dayProfile(forecast, today);
  return {
    power_now: values.powerNow ?? 0,
    energy_today: values.energyToday ?? 0,
    energy_remaining_today: values.energyRemainingToday ?? 0,
    energy_tomorrow: values.energyTomorrow ?? 0,
    peak_power: profile?.peakPower ?? 0,
    peak_time: profile?.peakTime ? formatTime(profile.peakTime, forecast.timezone) : '',
  };
}

/** Scene action `get_production_next_hours`: energy expected in the next hours. */
export function nextHoursOutputs(forecast, now, hours) {
  const to = now + hours * HOUR_MS;
  const energyWh = energyBetween(forecast, now, to);
  return {
    energy: whToKwh(energyWh),
    average_power: Math.round(energyWh / hours),
    max_power: Math.round(maxPowerBetween(forecast, now, to)),
  };
}

/**
 * Best window of `durationHours` today (from now) or tomorrow, for an
 * appliance to run on solar power.
 */
export function findBestWindow(forecast, now, { durationHours, day }) {
  const today = dayKey(new Date(now), forecast.timezone);
  const targetDay = day === 'tomorrow' ? nextDayKey(today) : today;
  const range = dayRange(forecast, targetDay);
  const window =
    range &&
    bestWindow(forecast, {
      from: Math.max(range.from, now),
      to: range.to,
      durationMs: durationHours * HOUR_MS,
    });
  if (!window) {
    return null;
  }
  return {
    ...window,
    day: targetDay,
    startTime: formatTime(window.start, forecast.timezone),
    endTime: formatTime(window.end, forecast.timezone),
    energy: whToKwh(window.energyWh),
  };
}

/** Scene action `find_best_window`: outputs (always all declared keys). */
export function bestWindowOutputs(forecast, now, options) {
  const window = findBestWindow(forecast, now, options);
  if (!window) {
    return { found: false, start_time: '', end_time: '', energy: 0, minutes_until_start: 0 };
  }
  return {
    found: true,
    start_time: window.startTime,
    end_time: window.endTime,
    energy: window.energy,
    minutes_until_start: Math.max(0, Math.round((window.start - now) / 60000)),
  };
}
