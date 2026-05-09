export const STARTING_VALUE = 100;
export const BUY_DATE = '2026-02-06';
export const SELL_DATE = '2026-12-21';

export const SYMBOL_MAPPINGS = {
  SOL: 'SOL-USD',
  HYPE: 'HYPE32196-USD',
};

export function parseCsv(text) {
  const records = parseCsvRecords(text).filter((record) =>
    record.some((cell) => cell.trim() !== ''),
  );
  const [headers, ...rows] = records;
  if (!headers) {
    throw new Error('CSV is empty.');
  }

  return rows
    .map((row, index) => {
      const raw = Object.fromEntries(
        headers.map((header, headerIndex) => [header.trim(), (row[headerIndex] ?? '').trim()]),
      );
      if (!raw.Name && !raw['Ticker symbol']) {
        return null;
      }

      const draftOrder = Number(raw['Draft order']);
      const shares = Number(raw['Number of shares']);
      if (!Number.isFinite(draftOrder) || !Number.isFinite(shares)) {
        throw new Error(`Invalid draft order or share count on CSV row ${index + 2}.`);
      }

      const ticker = raw['Ticker symbol'].toUpperCase();
      return {
        id: String(draftOrder),
        draftOrder,
        name: raw.Name,
        ticker,
        sourceSymbol: SYMBOL_MAPPINGS[ticker] ?? ticker,
        shares,
        impliedBuyPrice: STARTING_VALUE / shares,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.draftOrder - b.draftOrder);
}

export function parseCsvRecords(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        i += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

export function generateFridayDates(startDate, latestDate) {
  const dates = [];
  let cursor = toUtcDate(startDate);
  const latest = toUtcDate(latestDate);

  while (cursor <= latest) {
    if (cursor.getUTCDay() === 5) {
      dates.push(formatDate(cursor));
    }
    cursor = addDays(cursor, 1);
  }

  return dates;
}

export function latestCompletedFriday(today = new Date()) {
  const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  while (cursor.getUTCDay() !== 5) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return formatDate(cursor);
}

export function findPriceOnOrBefore(prices, targetDate) {
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  let selected = null;

  for (const price of sorted) {
    if (price.date <= targetDate) {
      selected = price;
    } else {
      break;
    }
  }

  return selected;
}

export function isPriceInsideRange(price, targetPrice) {
  return (
    Number.isFinite(price?.low) &&
    Number.isFinite(price?.high) &&
    price.low <= targetPrice &&
    targetPrice <= price.high
  );
}

export function calculatePositionValue(entry, baselinePrice, currentPrice, options = {}) {
  const override = options.finalSaleOverride;
  const corporateAction = options.corporateAction;

  if (override?.saleValue != null) {
    return Number(override.saleValue);
  }

  if (override?.salePrice != null) {
    const shareMultiplier =
      Number(override.shareMultiplier ?? corporateAction?.shareMultiplier ?? 1) || 1;
    return entry.shares * shareMultiplier * Number(override.salePrice);
  }

  const shareMultiplier = corporateActionApplies(corporateAction, currentPrice?.date)
    ? Number(corporateAction?.shareMultiplier ?? 1) || 1
    : 1;
  const baselineClose = Number(baselinePrice?.close);
  const baselineAdjustedClose = Number(baselinePrice?.adjustedClose ?? baselinePrice?.close);
  const currentAdjustedClose = Number(currentPrice?.adjustedClose ?? currentPrice?.close);

  if (
    !Number.isFinite(baselineClose) ||
    baselineClose <= 0 ||
    !Number.isFinite(baselineAdjustedClose) ||
    baselineAdjustedClose <= 0 ||
    !Number.isFinite(currentAdjustedClose)
  ) {
    throw new Error(`Cannot calculate value for ${entry.ticker}: missing price data.`);
  }

  const baselineAdjustmentRatio = baselineAdjustedClose / baselineClose;
  const adjustedSharePrice = currentAdjustedClose / baselineAdjustmentRatio;
  return entry.shares * shareMultiplier * adjustedSharePrice;
}

export function corporateActionApplies(corporateAction, currentDate) {
  if (!corporateAction?.shareMultiplier) {
    return false;
  }
  if (!corporateAction.effectiveDate || !currentDate) {
    return true;
  }
  return currentDate >= corporateAction.effectiveDate;
}

export function createStanding(entry, value, sourceDate, snapshotDate) {
  const topUpOwed = Math.max(0, STARTING_VALUE - value);
  return {
    id: entry.id,
    draftOrder: entry.draftOrder,
    name: entry.name,
    ticker: entry.ticker,
    sourceSymbol: entry.sourceSymbol,
    shares: entry.shares,
    impliedBuyPrice: entry.impliedBuyPrice,
    value,
    returnPct: ((value - STARTING_VALUE) / STARTING_VALUE) * 100,
    topUpOwed,
    sourceDate,
    snapshotDate,
  };
}

export function rankStandings(standings) {
  return standings
    .slice()
    .sort((a, b) => {
      if (b.returnPct !== a.returnPct) {
        return b.returnPct - a.returnPct;
      }
      return a.draftOrder - b.draftOrder;
    })
    .map((standing, index, all) => ({
      ...standing,
      rank: index + 1,
      isTopFive: index < 5,
      isLeader: index === 0,
      isSecond: index === 1,
      isLast: index === all.length - 1,
      payoutShare: index === 0 ? 0.8 : index === 1 ? 0.2 : 0,
    }));
}

export function calculatePot(standings) {
  const total = standings.reduce((sum, standing) => sum + Math.max(standing.value, STARTING_VALUE), 0);
  return {
    total,
    winnerPayout: total * 0.8,
    secondPayout: total * 0.2,
  };
}

export function addDays(date, count) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + count);
  return next;
}

export function toUtcDate(dateLike) {
  if (dateLike instanceof Date) {
    return new Date(Date.UTC(dateLike.getUTCFullYear(), dateLike.getUTCMonth(), dateLike.getUTCDate()));
  }
  const [year, month, day] = dateLike.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}
