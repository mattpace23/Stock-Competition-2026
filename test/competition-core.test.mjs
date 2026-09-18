import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  calculatePositionValue,
  calculatePot,
  createStanding,
  generateFridayDates,
  latestCompletedFriday,
  sharesOnDate,
  parseCsv,
  rankStandings,
} from '../scripts/competition-core.mjs';

const actions = JSON.parse(fs.readFileSync(new URL('../data/manual-overrides.json', import.meta.url))).corporateActions;

test('OPTT split preserves September 11 and uses exactly 8 shares after September 14', () => {
  const entry = { id: '5', ticker: 'OPTT', shares: 218 };
  const action = actions['5'];
  assert.equal(sharesOnDate(entry, action, '2026-09-11'), 218);
  assert.equal(sharesOnDate(entry, action, '2026-09-14'), 8);
  for (const adjustedHistory of [false, true]) {
    const baseline = { close: adjustedHistory ? 13.8 : 0.46 };
    const before = { date: '2026-09-11', close: adjustedHistory ? 3.3 : 0.11 };
    const after = { date: '2026-09-18', close: 3.3 };
    assert.ok(Math.abs(calculatePositionValue(entry, baseline, before, { corporateAction: action }) - 23.98) < 1e-8);
    assert.ok(Math.abs(calculatePositionValue(entry, baseline, after, { corporateAction: action }) - 26.4) < 1e-8);
  }
  assert.equal(createStanding(entry, 26.4, '2026-09-18', '2026-09-18', action).shares, 8);
  assert.equal(createStanding(entry, 23.98, '2026-09-11', '2026-09-18', action).shares, 218);
  assert.equal(calculatePositionValue(entry, null, null, {
    corporateAction: action, valuationDate: '2026-12-21', finalSaleOverride: { salePrice: 3 },
  }), 24);
  assert.throws(() => calculatePositionValue(entry, { close: 7 }, { date: '2026-09-18', close: 3 }, {
    corporateAction: action,
  }), /unrecognized historical price basis/);
});

test('MSTU uses the confirmed holding without multiplying split-adjusted history twice', () => {
  const entry = { ticker: 'MSTU', shares: 19.4059 };
  assert.equal(sharesOnDate(entry, actions['3'], '2026-08-21'), 19.4059);
  assert.equal(sharesOnDate(entry, actions['3'], '2026-08-28'), 1.959);
  assert.equal(calculatePositionValue(entry, { close: 55.2 }, { date: '2026-08-21', close: 27.3 }, {
    corporateAction: actions['3'],
  }), 19.4059 * 2.73);
  assert.equal(calculatePositionValue(entry, { close: 55.2 }, { date: '2026-08-28', close: 30.05 }, {
    corporateAction: actions['3'],
  }), 1.959 * 30.05);
});

test('ECHO history remains one position with its dated ticker and unchanged shares', () => {
  const entry = { ticker: 'SATS', shares: 0.8925 };
  const before = createStanding(entry, 100, '2026-06-18', '2026-06-19', actions['21']);
  const after = createStanding(entry, 100, '2026-06-26', '2026-06-26', actions['21']);
  assert.equal(before.ticker, 'SATS');
  assert.equal(after.ticker, 'ECHO');
  assert.equal(after.shares, 0.8925);
  assert.equal(parseCsv('Draft order,Name,Ticker symbol,Number of shares\n21,Filko,SATS,0.8925')[0].sourceSymbol, 'ECHO');
});

test('Friday snapshots wait until the New York close in both daylight and standard time', () => {
  assert.equal(latestCompletedFriday(new Date('2026-09-18T19:59:59Z')), '2026-09-11');
  assert.equal(latestCompletedFriday(new Date('2026-09-18T20:00:00Z')), '2026-09-18');
  assert.equal(latestCompletedFriday(new Date('2026-11-06T20:59:59Z')), '2026-10-30');
  assert.equal(latestCompletedFriday(new Date('2026-11-06T21:00:00Z')), '2026-11-06');
});

test('parses entrants from the stock competition CSV shape', () => {
  const entrants = parseCsv(`Draft order,Name,Ticker symbol,Number of shares,,
1,Cam Christian,PLTR,0.7297,,
23,Andrew Barber,SOL,1.15,,
32,Sean Vollendorf,HYPE,2.91,,
`);

  assert.equal(entrants.length, 3);
  assert.equal(entrants[0].draftOrder, 1);
  assert.equal(entrants[1].sourceSymbol, 'SOL-USD');
  assert.equal(entrants[2].sourceSymbol, 'HYPE32196-USD');
  assert.equal(Math.round(entrants[0].impliedBuyPrice * 100) / 100, 137.04);
});

test('generates weekly Friday race dates from the official buy date', () => {
  assert.deepEqual(generateFridayDates('2026-02-06', '2026-03-01'), [
    '2026-02-06',
    '2026-02-13',
    '2026-02-20',
    '2026-02-27',
  ]);
});

test('calculates adjusted values through a split fixture', () => {
  const entry = {
    ticker: 'SPLT',
    shares: 10,
  };
  const baseline = {
    close: 10,
    adjustedClose: 5,
  };
  const current = {
    close: 7,
    adjustedClose: 7,
  };

  assert.equal(calculatePositionValue(entry, baseline, current), 140);
});

test('calculates pot floor and 80/20 payouts', () => {
  const standings = rankStandings([
    createStanding({ id: '1', draftOrder: 1, name: 'A', ticker: 'AAA', shares: 1 }, 140, '2026-02-13', '2026-02-13'),
    createStanding({ id: '2', draftOrder: 2, name: 'B', ticker: 'BBB', shares: 1 }, 110, '2026-02-13', '2026-02-13'),
    createStanding({ id: '3', draftOrder: 3, name: 'C', ticker: 'CCC', shares: 1 }, 72, '2026-02-13', '2026-02-13'),
  ]);

  const pot = calculatePot(standings);
  assert.equal(pot.total, 350);
  assert.equal(pot.winnerPayout, 280);
  assert.equal(pot.secondPayout, 70);
  assert.equal(standings[2].topUpOwed, 28);
});

test('uses manual final sale value over market-derived value', () => {
  const entry = {
    ticker: 'SALE',
    shares: 2,
  };
  const value = calculatePositionValue(
    entry,
    { close: 50, adjustedClose: 50 },
    { close: 75, adjustedClose: 75 },
    { finalSaleOverride: { saleValue: 123.45 } },
  );

  assert.equal(value, 123.45);
});

test('uses manual final sale price with optional share multiplier', () => {
  const entry = {
    ticker: 'SALE',
    shares: 2,
  };
  const value = calculatePositionValue(
    entry,
    { close: 50, adjustedClose: 50 },
    { close: 75, adjustedClose: 75 },
    { finalSaleOverride: { salePrice: 20, shareMultiplier: 3 } },
  );

  assert.equal(value, 120);
});
