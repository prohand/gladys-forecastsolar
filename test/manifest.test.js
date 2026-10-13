// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/app.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import {
  SCENE_TRIGGERS,
  bestWindowOutputs,
  dueProductionEvents,
  forecastUpdatedEvent,
  getForecastOutputs,
  nextHoursOutputs,
} from '../src/scenes.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { FORECAST, at } from './helpers/fixtures.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const app = createApp(createFakeGladys());
const keys = (list) => (list ?? []).map((entry) => entry.key).sort();

test('every manifest action, scene action and widget has a handler (and back)', () => {
  assert.deepEqual(keys(manifest.actions), Object.keys(app.actions).sort());
  assert.deepEqual(keys(manifest.scene_actions), Object.keys(app.sceneActions).sort());
  assert.deepEqual(keys(manifest.widgets), Object.keys(app.widgets).sort());
});

test('every scene trigger fired by the code is declared', () => {
  assert.deepEqual(keys(manifest.scene_triggers), Object.values(SCENE_TRIGGERS).sort());
});

test('scene events only carry declared filters and variables', () => {
  const now = at('2026-10-02T15:59:30+02:00');
  const events = [
    forecastUpdatedEvent(FORECAST, 'dev', 'Home', now),
    ...dueProductionEvents(FORECAST, 'dev', 'Home', now - 60000, now + 60000),
  ];
  for (const event of events) {
    const trigger = manifest.scene_triggers.find((t) => t.key === event.key);
    const declared = [...trigger.fields, ...trigger.variables].map((f) => f.key).sort();
    assert.deepEqual(Object.keys(event.data).sort(), declared, event.key);
  }
});

test('scene action outputs match the declared outputs', () => {
  const now = at('2026-10-02T10:00:00+02:00');
  const produced = {
    get_forecast: getForecastOutputs(FORECAST, now),
    get_production_next_hours: nextHoursOutputs(FORECAST, now, 3),
    find_best_window: bestWindowOutputs(FORECAST, now, { durationHours: 2, day: 'today' }),
  };
  for (const action of manifest.scene_actions) {
    const outputs = produced[action.key];
    assert.deepEqual(Object.keys(outputs).sort(), keys(action.outputs), action.key);
    for (const output of action.outputs) {
      assert.equal(typeof outputs[output.key], output.type, `${action.key}.${output.key}`);
    }
  }
});

test('the house location is requested', () => {
  assert.equal(manifest.location, true);
});

test('widgets and scenes require Gladys >= 5.1.0', () => {
  const minVersion = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.\d+/);
  assert.ok(minVersion, 'gladys_version must declare a minimum version');
  const [, major, minor] = minVersion.map(Number);
  assert.ok(major > 5 || (major === 5 && minor >= 1), manifest.gladys_version);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
});

test('manifest version and image tag follow package.json', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${pkg.version}`));
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, field.key);
    }
  }
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('widget labels and descriptions fit the Gladys limits', () => {
  for (const widget of manifest.widgets) {
    for (const text of Object.values(widget.label)) {
      assert.ok(text.length >= 3 && text.length <= 30, text);
    }
    for (const text of Object.values(widget.description)) {
      assert.ok(text.length <= 100, text);
    }
  }
});

// Gladys and the store accept any 2-letter key (`en` required); the Gladys UI
// speaks these four, so every text of the manifest carries all of them.
const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** Every multi-language object of the manifest (any object carrying `en`). */
function multiLanguageTexts(node, path = '$', found = []) {
  if (Array.isArray(node)) {
    node.forEach((child, index) => multiLanguageTexts(child, `${path}[${index}]`, found));
  } else if (node && typeof node === 'object') {
    if (typeof node.en === 'string') {
      found.push({ path, text: node });
    } else {
      for (const [key, child] of Object.entries(node)) {
        multiLanguageTexts(child, `${path}.${key}`, found);
      }
    }
  }
  return found;
}

test('every user-facing text is translated in English, French, German and Spanish', () => {
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 50, 'the walk must find the manifest texts');
  for (const { path, text } of texts) {
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), path);
    for (const language of LANGUAGES) {
      assert.ok(text[language].trim().length > 0, `${path}.${language}`);
    }
  }
});

test('the catalog description and section texts fit the store limits in every language', () => {
  for (const language of LANGUAGES) {
    const text = manifest.description[language];
    assert.ok(text.length >= 10 && text.length <= 100, `${language}: ${text}`);
  }
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    for (const language of LANGUAGES) {
      assert.ok(section.description[language].length <= 1000, `${section.key}.${language}`);
    }
  }
});

test('the manifest declares the transports used (the Forecast.Solar API is a cloud service)', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
});
