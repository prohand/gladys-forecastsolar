import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfig,
  invalidConfigKeys,
  configErrorMessage,
  DEFAULT_CONFIG,
} from '../src/config.js';

const VALID = { kwp: 3 };

test('normalizeConfig applies the defaults', () => {
  const config = normalizeConfig(VALID);
  assert.equal(config.declination, DEFAULT_CONFIG.declination);
  assert.equal(config.azimuth, DEFAULT_CONFIG.azimuth);
  assert.equal(config.refresh_interval, DEFAULT_CONFIG.refresh_interval);
  assert.equal(config.api_key, '');
});

test('normalizeConfig coerces numeric strings coming from a form', () => {
  const config = normalizeConfig({
    kwp: '6.2',
    declination: '20',
    azimuth: '-90',
    refresh_interval: '30',
  });
  assert.equal(config.kwp, 6.2);
  assert.equal(config.declination, 20);
  assert.equal(config.azimuth, -90);
  assert.equal(config.refresh_interval, 30);
});

test('normalizeConfig trims the API key', () => {
  assert.equal(normalizeConfig({ ...VALID, api_key: '  abc ' }).api_key, 'abc');
});

test('a complete config is valid', () => {
  const config = normalizeConfig(VALID);
  assert.deepEqual(invalidConfigKeys(config), []);
  assert.equal(configErrorMessage(config), null);
});

test('a missing peak power is reported', () => {
  assert.deepEqual(invalidConfigKeys(normalizeConfig()), ['kwp']);
  assert.deepEqual(invalidConfigKeys(normalizeConfig({ kwp: '' })), ['kwp']);
});

test('out of range values are reported', () => {
  const config = normalizeConfig({ declination: 120, azimuth: -200, kwp: 0 });
  assert.deepEqual(invalidConfigKeys(config), ['declination', 'azimuth', 'kwp']);
  const message = configErrorMessage(config);
  assert.match(message.en, /declination, azimuth, kwp/);
  assert.match(message.fr, /declination, azimuth, kwp/);
});
