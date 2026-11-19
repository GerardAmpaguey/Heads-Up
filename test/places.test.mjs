import test from 'node:test';
import assert from 'node:assert/strict';
import { canBrowse, fromNominatim, homeFirst, townLabel } from '../site/js/places.js';

const row = (o) => ({ category: 'place', lat: '16.04', lon: '120.33', ...o });

test('a Philippine province is labelled by itself, not by an old region', () => {
  const p = fromNominatim(row({ category: 'boundary', addresstype: 'state', name: 'Pangasinan', address: { state: 'Pangasinan', region: 'Ilocos Region', country: 'Philippines', country_code: 'ph' } }));
  assert.deepEqual([p.label, p.name, p.kind, p.cc], ['Pangasinan, Philippines', 'Pangasinan', 'Province', 'PH']);
});

test('a city sits under its province, and a barangay searches news by its city', () => {
  const city = fromNominatim(row({ addresstype: 'city', name: 'Dagupan', address: { city: 'Dagupan', state: 'Pangasinan', country: 'Philippines', country_code: 'ph' } }));
  assert.equal(city.label, 'Dagupan, Pangasinan, Philippines');
  const brgy = fromNominatim(row({ addresstype: 'village', name: 'Poblacion East', address: { village: 'Poblacion East', municipality: 'Calasiao', state: 'Pangasinan', country: 'Philippines', country_code: 'ph' } }));
  assert.deepEqual([brgy.label, brgy.name, brgy.kind], ['Poblacion East, Calasiao, Pangasinan, Philippines', 'Calasiao', 'Barangay']);
});

test('shops, roads and rows without coordinates are ignored', () => {
  assert.equal(fromNominatim(row({ category: 'shop', addresstype: 'shop', name: 'Pangasinan Bakery', address: {} })), null);
  assert.equal(fromNominatim({ category: 'place', addresstype: 'city', name: 'X', lat: 'x', lon: 'y', address: {} }), null);
});

test('PSGC city names read naturally', () => {
  assert.equal(townLabel({ name: 'City of Dagupan' }), 'Dagupan City');
  assert.equal(townLabel({ name: 'Calasiao' }), 'Calasiao');
});

test('places outside the Philippines use their own words: states, villages, counties and countries', () => {
  const austin = fromNominatim(row({ addresstype: 'city', name: 'Austin', address: { city: 'Austin', county: 'Travis County', state: 'Texas', country: 'United States', country_code: 'us' } }));
  assert.deepEqual([austin.label, austin.name, austin.kind, austin.cc], ['Austin, Texas, United States', 'Austin', 'City', 'US']);
  const texas = fromNominatim(row({ category: 'boundary', addresstype: 'state', name: 'Texas', address: { state: 'Texas', country: 'United States', country_code: 'us' } }));
  assert.deepEqual([texas.label, texas.kind], ['Texas, United States', 'State or province']);
  const county = fromNominatim(row({ category: 'boundary', addresstype: 'county', name: 'Orange County', address: { county: 'Orange County', state: 'California', country: 'United States', country_code: 'us' } }));
  assert.deepEqual([county.label, county.kind], ['Orange County, California, United States', 'County']);
  const village = fromNominatim(row({ addresstype: 'village', name: 'Grasmere', address: { village: 'Grasmere', county: 'Westmorland and Furness', state: 'England', country: 'United Kingdom', country_code: 'gb' } }));
  assert.deepEqual([village.label, village.name, village.kind], ['Grasmere, England, United Kingdom', 'Grasmere', 'Village'], 'a village with no town searches news by its own name');
  const suburb = fromNominatim(row({ addresstype: 'suburb', name: 'Shibuya', address: { suburb: 'Shibuya', city: 'Tokyo', province: 'Tokyo', country: 'Japan', country_code: 'jp' } }));
  assert.deepEqual([suburb.label, suburb.name, suburb.kind], ['Shibuya, Tokyo, Japan', 'Tokyo', 'Suburb']);
  const japan = fromNominatim(row({ category: 'boundary', addresstype: 'country', name: 'Japan', address: { country: 'Japan', country_code: 'jp' } }));
  assert.deepEqual([japan.label, japan.name, japan.kind], ['Japan', 'Japan', 'Country'], 'the country is not repeated');
});

test('search lists the visitor\'s own country first, and only the Philippines can be browsed', () => {
  const list = [{ label: 'San Fernando, Cádiz, Spain', cc: 'ES' }, { label: 'San Fernando, La Union, Philippines', cc: 'PH' }, { label: 'San Fernando, Trinidad and Tobago', cc: 'TT' }, { label: 'San Fernando, Pampanga, Philippines', cc: 'PH' }];
  assert.deepEqual(homeFirst(list, 'PH').map((p) => p.cc), ['PH', 'PH', 'ES', 'TT']);
  assert.deepEqual(homeFirst(list, 'TT').map((p) => p.cc), ['TT', 'ES', 'PH', 'PH']);
  assert.equal(homeFirst(list, null), list);
  assert.equal(canBrowse('PH'), true);
  assert.equal(canBrowse('US'), false);
  assert.equal(canBrowse(null), false);
});
