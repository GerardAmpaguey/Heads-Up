import test from 'node:test';
import assert from 'node:assert/strict';
import { fromNominatim, townLabel } from '../site/js/places.js';

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
