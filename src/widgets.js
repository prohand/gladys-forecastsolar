// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`).
//
// The content is declarative: Gladys renders it with its own theme, dark mode
// and translations. Budget per widget: 8 components, 1 chart, 6 tiles,
// 2 texts, 1 status list, 4 buttons (see the SDK README).
// -----------------------------------------------------------------------------

import { WIDGET_CHART_TYPES, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { dayKey, dayProfile, formatTime, toPoints } from './forecast.js';
import { findBestWindow } from './scenes.js';
import { FEATURE } from './devices/solarForecast.js';

export const WIDGETS = {
  SOLAR_FORECAST: 'solar_forecast',
  BEST_WINDOW: 'solar_best_window',
};

// The data moves slowly: Gladys re-pulls the content every 5 minutes, and the
// integration nudges it right after each download.
const TTL_SECONDS = 300;

/** Content shown while the forecast is not available yet. */
export function emptyContent(message) {
  return {
    ttl_seconds: 60,
    components: [{ type: 'text', variant: 'body', text: message }],
  };
}

/** The card served while a first download finishes, re-pulled 15 s later. */
export function loadingContent() {
  return {
    ttl_seconds: 15,
    components: [
      {
        type: 'text',
        variant: 'body',
        text: {
          en: 'Downloading the forecast, this takes longer than usual…',
          fr: 'Téléchargement de la prévision, plus long que d’habitude…',
        },
      },
    ],
  };
}

export const NOT_READY_MESSAGE = {
  en: 'No forecast yet. Add the device from the Discovery tab and wait a minute.',
  fr: "Pas encore de prévision. Ajoutez l'appareil depuis l'onglet Découverte et patientez une minute.",
};

const profileText = (profile, timeZone) =>
  profile?.start
    ? `${formatTime(profile.start, timeZone)} → ${formatTime(profile.end, timeZone)}`
    : '—';

/**
 * Widget `solar_forecast`: live tiles + power curve for today and tomorrow.
 * @param {object} params
 * @param {object} params.forecast cached forecast of the house
 * @param {object} params.ids external ids of the house device
 * @param {string} params.houseName
 * @param {number} params.fetchedAt time of the download (ms)
 * @param {number} params.now
 */
export function solarForecastContent({ forecast, ids, houseName, fetchedAt, now }) {
  const tz = forecast.timezone;
  const today = dayKey(new Date(now), tz);
  const profile = dayProfile(forecast, today);
  const points = toPoints(forecast.watts).map(([time, value]) => ({
    t: new Date(time).toISOString(),
    v: Math.round(value),
  }));

  const annotations = profile?.peakTime
    ? [
        {
          t: new Date(profile.peakTime).toISOString(),
          value: profile.peakPower,
          label: { en: 'Peak', fr: 'Pic' },
          color: WIDGET_COLORS.WARNING,
        },
      ]
    : [];

  return {
    ttl_seconds: TTL_SECONDS,
    components: [
      { type: 'text', variant: 'caption', text: `${houseName} · Forecast.Solar` },
      {
        type: 'value',
        label: { en: 'Power now', fr: 'Puissance actuelle' },
        icon: 'sun',
        color: WIDGET_COLORS.WARNING,
        device_feature: ids.feature(FEATURE.POWER_NOW),
      },
      {
        type: 'value',
        label: { en: 'Today', fr: "Aujourd'hui" },
        icon: 'calendar',
        device_feature: ids.feature(FEATURE.ENERGY_TODAY),
      },
      {
        type: 'value',
        label: { en: 'Remaining today', fr: "Reste aujourd'hui" },
        icon: 'battery-charging',
        device_feature: ids.feature(FEATURE.ENERGY_REMAINING_TODAY),
      },
      {
        type: 'value',
        label: { en: 'Tomorrow', fr: 'Demain' },
        icon: 'sunrise',
        device_feature: ids.feature(FEATURE.ENERGY_TOMORROW),
      },
      {
        type: 'chart',
        chart_type: WIDGET_CHART_TYPES.AREA,
        title: { en: 'Estimated power', fr: 'Puissance estimée' },
        unit: 'W',
        now_marker: true,
        series: [{ name: { en: 'Power', fr: 'Puissance' }, points }],
        annotations,
      },
      {
        type: 'status',
        items: [
          {
            label: { en: 'Peak today', fr: "Pic aujourd'hui" },
            value: profile?.peakTime
              ? `${profile.peakPower} W · ${formatTime(profile.peakTime, tz)}`
              : '—',
            icon: 'trending-up',
            color: WIDGET_COLORS.WARNING,
          },
          {
            label: { en: 'Production today', fr: "Production aujourd'hui" },
            value: profileText(profile, tz),
            icon: 'clock',
            color: WIDGET_COLORS.INFO,
          },
          {
            label: { en: 'Updated at', fr: 'Mise à jour' },
            value: formatTime(fetchedAt, tz),
            icon: 'refresh-cw',
            color: WIDGET_COLORS.NEUTRAL,
          },
        ],
      },
    ],
  };
}

const windowText = (window) =>
  window ? `${window.startTime} → ${window.endTime} · ${window.energy} kWh` : '—';

/**
 * Widget `solar_best_window`: best moment to run an appliance of the chosen
 * duration, today (from now) and tomorrow.
 */
export function bestWindowContent({ forecast, houseName, durationHours, now }) {
  const today = findBestWindow(forecast, now, { durationHours, day: 'today' });
  const tomorrow = findBestWindow(forecast, now, { durationHours, day: 'tomorrow' });
  const next = today ?? tomorrow;
  const nextIsTomorrow = !today && Boolean(tomorrow);

  return {
    ttl_seconds: TTL_SECONDS,
    components: [
      {
        type: 'text',
        variant: 'caption',
        text: {
          en: `${houseName} · appliance running ${durationHours} h`,
          fr: `${houseName} · appareil de ${durationHours} h`,
        },
      },
      {
        type: 'value',
        label: nextIsTomorrow
          ? { en: 'Start tomorrow', fr: 'Départ demain' }
          : { en: 'Start', fr: 'Départ' },
        icon: 'play-circle',
        color: next ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
        value: next ? next.startTime : '—',
      },
      {
        type: 'value',
        label: { en: 'Solar energy', fr: 'Énergie solaire' },
        icon: 'zap',
        color: WIDGET_COLORS.WARNING,
        value: next ? next.energy : 0,
        unit: 'kWh',
      },
      {
        type: 'status',
        items: [
          {
            label: { en: 'Today', fr: "Aujourd'hui" },
            value: windowText(today),
            icon: 'sun',
            color: today ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
          },
          {
            label: { en: 'Tomorrow', fr: 'Demain' },
            value: windowText(tomorrow),
            icon: 'sunrise',
            color: tomorrow ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
          },
        ],
      },
    ],
  };
}
