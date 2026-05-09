import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePositionValue,
  calculatePot,
  createStanding,
  generateFridayDates,
  parseCsv,
  rankStandings,
} from '../scripts/competition-core.mjs';

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
