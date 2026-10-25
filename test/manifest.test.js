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

// The store's catalog shelves (Gladys 5.3 added transport, vehicles, servers and leisure).
// An unknown key is only dropped with a warning, so a typo would silently cost the shelf.
const CATALOG_CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

/** Minimum version of a `>=X.Y.Z` range, compared as numbers (never as text). */
function floorAtLeast(range, [major, minor, patch]) {
  const match = range.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, `gladys_version must declare a minimum version: ${range}`);
  const floor = match.slice(1).map(Number);
  const wanted = [major, minor, patch];
  for (let i = 0; i < 3; i += 1) {
    if (floor[i] !== wanted[i]) {
      return floor[i] > wanted[i];
    }
  }
  return true;
}

test('the Gladys version floor covers every field the manifest declares', () => {
  // categories: 4.86.0; widgets and scenes: 5.1.0; keywords / countries / music: 5.3.0.
  // An older core rejects any manifest field it does not know.
  assert.ok(floorAtLeast(manifest.gladys_version, [4, 86, 0]), manifest.gladys_version);
  assert.ok(floorAtLeast(manifest.gladys_version, [5, 1, 0]), manifest.gladys_version);
  if (manifest.keywords || manifest.countries || manifest.music) {
    assert.ok(floorAtLeast(manifest.gladys_version, [5, 3, 0]), manifest.gladys_version);
  }
});

test('categories are 1 to 3 unique keys of the store vocabulary', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.equal(new Set(manifest.categories).size, manifest.categories.length);
  for (const category of manifest.categories) {
    assert.ok(CATALOG_CATEGORIES.includes(category), category);
  }
});

test('keywords are 1 to 10 unique search terms of 2 to 30 characters', () => {
  assert.ok(Array.isArray(manifest.keywords));
  assert.ok(manifest.keywords.length >= 1 && manifest.keywords.length <= 10);
  const normalized = manifest.keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, normalized.length, 'keywords must be unique');
  for (const keyword of normalized) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, keyword);
  }
});

test('no countries: Forecast.Solar covers the whole world', () => {
  assert.equal(manifest.countries, undefined);
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
