import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSource, extractDailySources, groupSourceBreakdown } from '../app/group-overview/source-breakdown.ts';

test('Booking.com punctuation, casing and explicit aliases match', () => {
  for (const name of ['bookingcom', 'Booking.com', ' BOOKING COM ', 'Booking', 'booking dot com']) assert.equal(canonicalSource(name), 'Booking.com');
  assert.equal(canonicalSource('Booking Holidays Agency'), 'Booking Holidays Agency');
});
test('daily payload takes precedence without double counting; legacy days work', () => {
  assert.deepEqual(extractDailySources({dailySources:[{day:1,rooms:[{name:'Agoda',rooms:2}]}],sources:[{name:'Agoda',days:[{day:1,rooms:9},{day:2,rooms:3}]}]},2), [[{name:'Agoda',rooms:2}],[{name:'Agoda',rooms:3}]]);
  assert.deepEqual(extractDailySources({dailySources:[{day:1,rooms:[]}],sources:[{name:'Agoda',days:[{day:1,rooms:9}]}]},1), [[]]);
});
test('group aliases aggregate and reconciliation stays per hotel', () => {
  const result = groupSourceBreakdown([
    {occupied:[5],dailySources:[[{name:'Booking.com',rooms:3},{name:'Agent A',rooms:1}]]},
    {occupied:[2],dailySources:[[{name:'bookingcom',rooms:2},{name:'agent a',rooms:1}]]},
  ],0);
  assert.deepEqual(result.sources,[{name:'Booking.com',rooms:5},{name:'Agent A',rooms:2}]);
  assert.equal(result.unclassified,1);
  assert.equal(result.excess,1);
});
test('missing sources, dates and invalid entries do not fabricate bookings', () => {
  assert.deepEqual(extractDailySources({dailySources:[{day:1,rooms:[{name:'',rooms:3},{name:'X',rooms:-1},{name:'X',rooms:NaN}]}]},1),[[]]);
  assert.equal(groupSourceBreakdown([{occupied:[4]}],0).unclassified,4);
  assert.equal(groupSourceBreakdown([{occupied:[4]}],1).recorded,0);
  assert.equal(groupSourceBreakdown([],0).recorded,0);
});
