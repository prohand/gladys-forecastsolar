import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locatedHouses } from '../src/houses.js';

test('only houses with valid coordinates are kept', () => {
  const houses = [
    { id: 'a', latitude: 48.8, longitude: 2.3 },
    { id: 'b', latitude: null, longitude: null },
    { id: 'c', latitude: 0, longitude: 0 },
    { id: 'd', latitude: 91, longitude: 2 },
    null,
  ];
  assert.deepEqual(
    locatedHouses(houses).map((h) => h.id),
    ['a', 'c'],
  );
  assert.deepEqual(locatedHouses(), []);
});
