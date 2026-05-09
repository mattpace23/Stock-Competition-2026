import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import {
  BUY_DATE,
  SELL_DATE,
  calculatePositionValue,
  calculatePot,
  createStanding,
  findPriceOnOrBefore,
  generateFridayDates,
  isPriceInsideRange,
  latestCompletedFriday,
  parseCsv,
  rankStandings,
  SYMBOL_MAPPINGS,
  toUtcDate,
  addDays,
  formatDate,
} from './competition-core.mjs';

const ROOT = process.cwd();
const CSV_PATH = path.join(ROOT, 'Stock Data.csv');
const OVERRIDES_PATH = path.join(ROOT, 'data', 'manual-overrides.json');
const OUTPUT_PATH = path.join(ROOT, 'src', 'data', 'competition.json');

const csv = await fs.readFile(CSV_PATH, 'utf8');
const overrides = JSON.parse(await fs.readFile(OVERRIDES_PATH, 'utf8'));
const entries = parseCsv(csv);
const latestFriday = latestCompletedFriday(new Date());
const snapshotDates = generateFridayDates(BUY_DATE, latestFriday);
const hasFinalSalePrices = Object.keys(overrides.finalSalePrices ?? {}).length > 0;

const fetchEndDate = formatDate(addDays(toUtcDate(latestFriday), 2));
const histories = {};
const warnings = [];

console.log(`Refreshing ${entries.length} entrants through ${latestFriday}`);
for (const entry of entries) {
  try {
    console.log(`Fetching ${entry.ticker} (${entry.sourceSymbol})`);
    histories[entry.id] = await fetchYahooHistory(entry.sourceSymbol, BUY_DATE, fetchEndDate);
    console.log(`Fetched ${entry.ticker} (${entry.sourceSymbol})`);
  } catch (error) {
    warnings.push({
      level: 'error',
      ticker: entry.ticker,
      message: `Could not fetch history for ${entry.sourceSymbol}: ${error.message}`,
    });
    histories[entry.id] = [];
  }
  await wait(350);
}

for (const warning of warnings) {
  console.warn(`${warning.level.toUpperCase()}: ${warning.ticker}: ${warning.message}`);
}

const entrySummaries = entries.map((entry) => {
  const baseline = findPriceOnOrBefore(histories[entry.id], BUY_DATE);
  const hasDailyRange = baseline?.low !== baseline?.high;
  const baselineFits =
    hasDailyRange &&
    baseline != null &&
    baseline.date === BUY_DATE &&
    isPriceInsideRange(baseline, entry.impliedBuyPrice);

  if (hasDailyRange && !baselineFits) {
    warnings.push({
      level: 'warning',
      ticker: entry.ticker,
      message: `${entry.ticker} implied buy price was not inside the Feb. 6 daily range.`,
    });
  }

  return {
    ...entry,
    baselineSourceDate: baseline?.date ?? null,
    baselineFits: baselineFits || null,
    baselineRange: hasDailyRange
      ? {
          low: roundCurrency(baseline.low),
          high: roundCurrency(baseline.high),
          close: roundCurrency(baseline.close),
        }
      : null,
  };
});

const snapshots = snapshotDates.map((snapshotDate) =>
  buildSnapshot(snapshotDate, false, entries, histories, overrides),
);

if (hasFinalSalePrices) {
  snapshots.push(buildSnapshot(SELL_DATE, true, entries, histories, overrides));
}

const currentSnapshot = snapshots[snapshots.length - 1];
const output = {
  generatedAt: new Date().toISOString(),
  buyDate: BUY_DATE,
  sellDate: SELL_DATE,
  latestSnapshotDate: currentSnapshot?.date ?? BUY_DATE,
  latestMarketDate: currentSnapshot?.marketDate ?? BUY_DATE,
  hasFinalSalePrices,
  startingValue: 100,
  symbolMappings: SYMBOL_MAPPINGS,
  entries: entrySummaries,
  snapshots,
  warnings,
};

await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Generated ${path.relative(ROOT, OUTPUT_PATH)} with ${entries.length} entrants and ${snapshots.length} snapshots.`);

function buildSnapshot(snapshotDate, isFinal, entriesForSnapshot, historiesById, manualOverrides) {
  const standings = entriesForSnapshot.map((entry) => {
    const baseline = findPriceOnOrBefore(historiesById[entry.id], BUY_DATE);
    const current = findPriceOnOrBefore(historiesById[entry.id], snapshotDate);
    const override = isFinal ? manualOverrides.finalSalePrices?.[entry.id] : null;
    const corporateAction = manualOverrides.corporateActions?.[entry.id] ?? null;

    if (!baseline || (!current && !override)) {
      throw new Error(`Missing price data for ${entry.ticker} on ${snapshotDate}.`);
    }

    const value = calculatePositionValue(entry, baseline, current ?? baseline, {
      finalSaleOverride: override,
      corporateAction,
    });

    return createStanding(entry, roundCurrency(value), current?.date ?? snapshotDate, snapshotDate);
  });

  const ranked = rankStandings(standings);
  const pot = calculatePot(ranked);

  return {
    date: snapshotDate,
    marketDate: mostRecentMarketDate(ranked),
    isFinal,
    hasManualSalePrices: isFinal,
    pot: {
      total: roundCurrency(pot.total),
      winnerPayout: roundCurrency(pot.winnerPayout),
      secondPayout: roundCurrency(pot.secondPayout),
    },
    standings: ranked.map((standing) => ({
      ...standing,
      value: roundCurrency(standing.value),
      topUpOwed: roundCurrency(standing.topUpOwed),
      returnPct: roundPercent(standing.returnPct),
      projectedPayout: roundCurrency(standing.payoutShare * pot.total),
    })),
  };
}

function mostRecentMarketDate(standings) {
  return standings
    .map((standing) => standing.sourceDate)
    .filter(Boolean)
    .sort()
    .at(-1);
}

async function fetchYahooSpark(symbols) {
  let data = null;
  let lastError = null;

  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const url = new URL(`https://${host}/v7/finance/spark`);
        url.searchParams.set('symbols', symbols.join(','));
        url.searchParams.set('range', 'ytd');
        url.searchParams.set('interval', '1d');
        data = await requestJson(url);
        break;
      } catch (error) {
        lastError = error;
        await wait(750 * attempt);
      }
    }
    if (data) {
      break;
    }
  }

  if (!data) {
    throw lastError ?? new Error('Could not fetch Spark data.');
  }

  const historiesBySymbol = {};
  const results = data.spark?.result ?? [];

  for (const result of results) {
    const response = result.response?.[0];
    const timestamps = response?.timestamp ?? [];
    const closes = response?.close ?? [];

    historiesBySymbol[result.symbol] = timestamps
      .map((timestamp, index) => {
        const close = numberOrNull(closes[index]);
        if (close == null) {
          return null;
        }

        return {
          date: formatDate(new Date(timestamp * 1000)),
          open: close,
          high: close,
          low: close,
          close,
          adjustedClose: close,
          volume: null,
        };
      })
      .filter(Boolean);
  }

  return historiesBySymbol;
}

async function fetchYahooHistory(symbol, startDate, endDate) {
  const period1 = Math.floor(toUtcDate(startDate).getTime() / 1000);
  const period2 = Math.floor(toUtcDate(endDate).getTime() / 1000);
  let lastError = null;

  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const url = new URL(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}`);
        url.searchParams.set('period1', String(period1));
        url.searchParams.set('period2', String(period2));
        url.searchParams.set('interval', '1d');
        url.searchParams.set('events', 'history');
        url.searchParams.set('includeAdjustedClose', 'true');

        const data = await requestJson(url);
        return parseYahooHistory(symbol, data);
      } catch (error) {
        lastError = error;
        await wait(250 * attempt);
      }
    }
  }

  throw lastError ?? new Error(`Could not fetch ${symbol}.`);
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        timeout: 12_000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/json,text/plain,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          Connection: 'close',
        },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`${url.hostname} HTTP ${response.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error(`${url.hostname} request timed out`));
    });
    request.on('error', reject);
  });
}

function parseYahooHistory(symbol, data) {
  const error = data.chart?.error;
  if (error) {
    throw new Error(error.description ?? error.code ?? 'Yahoo chart error');
  }

  const result = data.chart?.result?.[0];
  if (!result) {
    throw new Error('No chart result.');
  }

  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose ?? [];

  return timestamps
    .map((timestamp, index) => {
      const close = numberOrNull(quote.close?.[index]);
      if (close == null) {
        return null;
      }

      return {
        date: formatDate(new Date(timestamp * 1000)),
        open: numberOrNull(quote.open?.[index]),
        high: numberOrNull(quote.high?.[index]),
        low: numberOrNull(quote.low?.[index]),
        close,
        adjustedClose: numberOrNull(adjusted[index]) ?? close,
        volume: numberOrNull(quote.volume?.[index]),
      };
    })
    .filter(Boolean);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundPercent(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
