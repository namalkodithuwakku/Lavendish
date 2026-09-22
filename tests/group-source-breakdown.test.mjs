import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSource, extractDailySources, groupSourceBreakdown, groupMonthlySourceBreakdown } from '../app/group-overview/source-breakdown.ts';

test('monthly totals combine aliases across days and hotels and respect month length', () => {
  const result = groupMonthlySourceBreakdown([
    { occupied:[3,2,99], dailySources:[[{name:'bookingcom',rooms:3}],[{name:'Agoda',rooms:2}],[{name:'Agoda',rooms:99}]] },
    { occupied:[2,4], dailySources:[[{name:'Booking.com',rooms:2}],[{name:'agoda.com',rooms:4}]] },
  ],2);
  assert.deepEqual(result.sources,[{name:'Agoda',rooms:6},{name:'Booking.com',rooms:5}]);
  assert.equal(result.recorded,11);
  assert.equal(result.unclassified,0);
  assert.equal(result.excess,0);
});
test('monthly reconciliation does not cancel shortages against excess on other days', () => {
  const result = groupMonthlySourceBreakdown([{occupied:[5,2,4],dailySources:[[{name:'Agoda',rooms:3}],[{name:'Agoda',rooms:4}]]}],3);
  assert.equal(result.unclassified,6);
  assert.equal(result.excess,2);
  assert.equal(groupMonthlySourceBreakdown([],31).recorded,0);
});

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
