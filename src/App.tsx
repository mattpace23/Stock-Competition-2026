import {
  CalendarDays,
  ExternalLink,
  Flag,
  Medal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Trophy,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import competitionData from './data/competition.json';
import moverNotesData from './data/mover-notes.json';

type Entry = {
  id: string;
  draftOrder: number;
  name: string;
  ticker: string;
  sourceSymbol: string;
  shares: number;
  impliedBuyPrice: number;
  baselineSourceDate?: string | null;
  baselineFits?: boolean | null;
  baselineRange?: {
    low: number;
    high: number;
    close: number;
  } | null;
};

type Standing = {
  id: string;
  rank: number;
  draftOrder: number;
  name: string;
  ticker: string;
  sourceSymbol: string;
  shares: number;
  impliedBuyPrice: number;
  value: number;
  returnPct: number;
  topUpOwed: number;
  sourceDate: string;
  snapshotDate: string;
  isTopFive: boolean;
  isLeader: boolean;
  isSecond: boolean;
  isLast: boolean;
  payoutShare: number;
  projectedPayout: number;
};

type Snapshot = {
  date: string;
  marketDate: string;
  isFinal: boolean;
  hasManualSalePrices: boolean;
  pot: {
    total: number;
    winnerPayout: number;
    secondPayout: number;
  };
  standings: Standing[];
};

type Warning = {
  level: string;
  ticker: string;
  message: string;
};

type CompetitionData = {
  generatedAt: string | null;
  buyDate: string;
  sellDate: string;
  latestSnapshotDate: string;
  latestMarketDate: string;
  hasFinalSalePrices: boolean;
  startingValue: number;
  symbolMappings: Record<string, string>;
  entries: Entry[];
  snapshots: Snapshot[];
  warnings: Warning[];
};

type SortKey = 'rank' | 'draft' | 'return' | 'value' | 'topUp' | 'ticker';

const data = competitionData as CompetitionData;
const moverNotes = moverNotesData as Record<string, Record<string, MoverNote>>;

type MoverNote = {
  headline: string;
  summary: string;
  sourceLabel: string;
  sourceUrl: string;
};

type Mover = Standing & {
  delta: number;
  note?: MoverNote;
};

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 4,
});

const percent = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  signDisplay: 'exceptZero',
});

const lineColors = ['#d49a28', '#198754', '#33658a', '#7c4d2d', '#bb4430', '#4c6b45'];

function App() {
  const snapshots = data.snapshots ?? [];
  const [snapshotIndex, setSnapshotIndex] = useState(Math.max(0, snapshots.length - 1));
  const [isPlaying, setIsPlaying] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [topFiveOnly, setTopFiveOnly] = useState(false);
  const [selectedHorseIds, setSelectedHorseIds] = useState<string[]>(() =>
    snapshots[Math.max(0, snapshots.length - 1)]?.standings.slice(0, 5).map((standing) => standing.id) ?? [],
  );
  const [horseToAdd, setHorseToAdd] = useState('');

  useEffect(() => {
    if (!isPlaying || snapshots.length <= 1) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setSnapshotIndex((current) => (current + 1) % snapshots.length);
    }, 900);

    return () => window.clearInterval(timer);
  }, [isPlaying, snapshots.length]);

  const selectedSnapshot = snapshots[snapshotIndex];
  const standings = selectedSnapshot?.standings ?? [];
  const leader = standings[0];
  const second = standings[1];
  const lastPlace = standings[standings.length - 1];
  const topFiveIds = useMemo(() => standings.slice(0, 5).map((standing) => standing.id), [standings]);
  const raceSplitCount = Math.max(1, snapshots.length - 1);
  const activeSplit = Math.min(snapshotIndex, raceSplitCount);
  const activeSplitProgress = activeSplit / raceSplitCount;

  const sortedStandings = useMemo(() => {
    const sorted = [...standings].sort((a, b) => {
      if (sortKey === 'draft') return a.draftOrder - b.draftOrder;
      if (sortKey === 'return') return b.returnPct - a.returnPct;
      if (sortKey === 'value') return b.value - a.value;
      if (sortKey === 'topUp') return b.topUpOwed - a.topUpOwed;
      if (sortKey === 'ticker') return a.ticker.localeCompare(b.ticker);
      return a.rank - b.rank;
    });

    return topFiveOnly ? sorted.filter((standing) => standing.isTopFive) : sorted;
  }, [sortKey, standings, topFiveOnly]);

  const raceRows = useMemo(() => [...standings].sort((a, b) => a.rank - b.rank), [standings]);
  const visibleRaceRows = useMemo(() => {
    const selected = selectedHorseIds
      .map((id) => raceRows.find((standing) => standing.id === id))
      .filter((standing): standing is Standing => Boolean(standing));

    return selected.length > 0 ? selected : raceRows.slice(0, 5);
  }, [raceRows, selectedHorseIds]);
  const availableHorses = useMemo(
    () => raceRows.filter((standing) => !visibleRaceRows.some((visible) => visible.id === standing.id)),
    [raceRows, visibleRaceRows],
  );
  const chartIds = useMemo(() => {
    const ids = visibleRaceRows.map((standing) => standing.id);
    if (lastPlace && !ids.includes(lastPlace.id)) {
      ids.push(lastPlace.id);
    }
    return ids;
  }, [lastPlace, visibleRaceRows]);

  const chartData = useMemo(
    () =>
      snapshots.map((snapshot) => {
        const row: Record<string, string | number> = { date: shortDate(snapshot.date) };
        for (const id of chartIds) {
          const standing = snapshot.standings.find((candidate) => candidate.id === id);
          if (standing) {
            row[standing.ticker] = standing.returnPct;
          }
        }
        return row;
      }),
    [chartIds, snapshots],
  );

  const chartTickers = useMemo(
    () =>
      chartIds
        .map((id) => raceRows.find((standing) => standing.id === id)?.ticker)
        .filter((ticker): ticker is string => Boolean(ticker)),
    [chartIds, raceRows],
  );

  const raceReturnRange = Math.max(0, (leader?.returnPct ?? 0) - (lastPlace?.returnPct ?? 0));
  const splitMarkers = useMemo(
    () =>
      Array.from({ length: raceSplitCount }, (_, index) => {
        const split = index + 1;
        return {
          split,
          point: getOvalPoint(split / raceSplitCount, 6),
        };
      }),
    [raceSplitCount],
  );
  const weeklyMovers = useMemo(() => {
    if (snapshotIndex === 0 || !selectedSnapshot) {
      return { up: null, down: null };
    }

    const previousSnapshot = snapshots[snapshotIndex - 1];
    const previousReturns = new Map(previousSnapshot.standings.map((standing) => [standing.id, standing.returnPct]));
    const notesForDate = moverNotes[selectedSnapshot.date] ?? {};
    const movers = standings.map((standing) => ({
      ...standing,
      delta: standing.returnPct - (previousReturns.get(standing.id) ?? 0),
      note: notesForDate[standing.ticker],
    }));

    return {
      up: movers.reduce<Mover | null>((best, standing) => (best && best.delta >= standing.delta ? best : standing), null),
      down: movers.reduce<Mover | null>((worst, standing) => (worst && worst.delta <= standing.delta ? worst : standing), null),
    };
  }, [selectedSnapshot, snapshotIndex, snapshots, standings]);

  useEffect(() => {
    if (selectedHorseIds.length === 0 && topFiveIds.length > 0) {
      setSelectedHorseIds(topFiveIds);
    }
  }, [selectedHorseIds.length, topFiveIds]);

  const goToSnapshot = (value: number) => {
    setIsPlaying(false);
    setSnapshotIndex(value);
  };

  if (!selectedSnapshot) {
    return <EmptyState warnings={data.warnings} />;
  }

  return (
    <main className="app-shell">
      <section className="scoreboard">
        <div className="scoreboard__content">
          <div>
            <p className="eyebrow">2026 Stock Draft Competition</p>
            <h1>Stock Draft Derby</h1>
            <div className="scoreboard__meta">
              <span>
                <CalendarDays size={16} aria-hidden="true" />
                Buy: {formatDate(data.buyDate)}
              </span>
              <span>
                <Flag size={16} aria-hidden="true" />
                Sell: {formatDate(data.sellDate)}
              </span>
              <span>
                <RefreshCw size={16} aria-hidden="true" />
                Data: {formatDate(selectedSnapshot.marketDate)}
              </span>
            </div>
          </div>

          <div className="scoreboard__payout">
            <span className="label">Projected Pot</span>
            <strong>{money.format(selectedSnapshot.pot.total)}</strong>
            <small>
              {data.hasFinalSalePrices ? 'Final sale prices loaded' : 'Projected from latest weekly close'}
            </small>
          </div>
        </div>
      </section>

      <section className="stat-grid" aria-label="Competition highlights">
        <StatCard
          accentLabel="Projected Payout"
          accentValue={money.format(selectedSnapshot.pot.winnerPayout)}
          icon={<Trophy size={20} />}
          label="Leader"
          value={leader ? `${leader.draftOrder}. ${leader.name}` : 'No leader'}
          detail={leader ? `${leader.ticker} ${percent.format(leader.returnPct)}%` : ''}
          tone="gold"
        />
        <StatCard
          accentLabel="Projected Payout"
          accentValue={money.format(selectedSnapshot.pot.secondPayout)}
          icon={<Medal size={20} />}
          label="Second Place"
          value={second ? `${second.draftOrder}. ${second.name}` : 'No second'}
          detail={second ? `${second.ticker} ${percent.format(second.returnPct)}%` : ''}
          tone="green"
        />
        <StatCard
          accentLabel="Projected Pay In"
          accentValue={lastPlace ? money.format(lastPlace.topUpOwed) : money.format(0)}
          icon={<TrendingDown size={20} />}
          label="Loser"
          value={lastPlace ? `${lastPlace.draftOrder}. ${lastPlace.name}` : 'No last place'}
          detail={lastPlace ? `${lastPlace.ticker} ${percent.format(lastPlace.returnPct)}%` : ''}
          tone="red"
        />
      </section>

      <section className="mover-grid" aria-label="Weekly movers">
        <MoverCard
          detail="Biggest percentage-point gain from the prior Friday"
          icon={<TrendingUp size={20} />}
          mover={weeklyMovers.up}
          title="Biggest Breakaway"
          tone="green"
        />
        <MoverCard
          detail="Biggest percentage-point drop from the prior Friday"
          icon={<TrendingDown size={20} />}
          mover={weeklyMovers.down}
          title="Hardest Fade"
          tone="red"
        />
      </section>

      <section className="race-section" aria-label="Horse race standings">
        <div className="section-header">
          <div>
            <p className="eyebrow">Weekly Race</p>
            <h2>{formatDate(selectedSnapshot.date)} Standings</h2>
          </div>
          <div className="race-controls">
            <button
              className="icon-button"
              type="button"
              title={isPlaying ? 'Pause race' : 'Play race'}
              aria-label={isPlaying ? 'Pause race' : 'Play race'}
              onClick={() => setIsPlaying((current) => !current)}
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button
              className="icon-button"
              type="button"
              title="Reset to start"
              aria-label="Reset to start"
              onClick={() => {
                setIsPlaying(false);
                setSnapshotIndex(0);
              }}
            >
              <RotateCcw size={18} />
            </button>
          </div>
        </div>

        <div className="timeline-control">
          <span>{snapshots[0] ? shortDate(snapshots[0].date) : '--'}</span>
          <input
            aria-label="Select weekly race date"
            min={0}
            max={Math.max(0, snapshots.length - 1)}
            type="range"
            value={snapshotIndex}
            onChange={(event) => {
              goToSnapshot(Number(event.currentTarget.value));
            }}
            onInput={(event) => {
              goToSnapshot(Number(event.currentTarget.value));
            }}
          />
          <span>{shortDate(snapshots[snapshots.length - 1]?.date ?? selectedSnapshot.date)}</span>
        </div>

        <div className="race-layout">
          <div
            className="oval-track"
            aria-label={`Oval race simulation with ${visibleRaceRows.length} horses at split ${activeSplit} of ${raceSplitCount}`}
            role="img"
          >
            <div className="oval-track__outer" aria-hidden="true" />
            <div className="oval-track__inner" aria-hidden="true" />
            <div className="oval-track__infield">
              <span>Race Split</span>
              <strong>{activeSplit} / {raceSplitCount}</strong>
              <small>{formatDate(selectedSnapshot.date)}</small>
            </div>
            <div className="finish-post" aria-hidden="true">
              START / FINISH
            </div>
            {splitMarkers.map(({ point, split }) => (
              <span
                aria-hidden="true"
                className={`split-marker ${split === activeSplit ? 'split-marker--active' : ''}`}
                key={split}
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
              >
                {split}
              </span>
            ))}
            {visibleRaceRows.map((standing, index) => {
              const performanceShare =
                raceReturnRange > 0
                  ? Math.max(0, Math.min(1, (standing.returnPct - (lastPlace?.returnPct ?? 0)) / raceReturnRange))
                  : 0;
              const point = getOvalPoint(performanceShare * activeSplitProgress, index);
              return (
                <div
                  className={[
                    'oval-horse',
                    standing.isTopFive ? 'oval-horse--top' : '',
                    standing.isLast ? 'oval-horse--last' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  key={standing.id}
                  style={{ left: `${point.x}%`, top: `${point.y}%` }}
                >
                  <HorseIcon />
                  <span>{standing.draftOrder}</span>
                  <strong>{standing.ticker}</strong>
                </div>
              );
            })}
          </div>

          <aside className="race-roster" aria-label="Simulation field">
            <div>
              <p className="eyebrow">Simulation Field</p>
              <h3>Top 5 Default</h3>
            </div>
            <div className="field-actions">
              <select
                aria-label="Add horse to simulation"
                value={horseToAdd}
                onChange={(event) => setHorseToAdd(event.target.value)}
              >
                <option value="">Add</option>
                {availableHorses.map((standing) => (
                  <option key={standing.id} value={standing.id}>
                    #{standing.draftOrder} {standing.name} ({standing.ticker})
                  </option>
                ))}
              </select>
              <button
                className="icon-button"
                disabled={!horseToAdd}
                type="button"
                title="Add horse"
                aria-label="Add selected horse"
                onClick={() => {
                  if (!horseToAdd) return;
                  setSelectedHorseIds((ids) => [...ids, horseToAdd]);
                  setHorseToAdd('');
                }}
              >
                <Plus size={18} />
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setSelectedHorseIds(topFiveIds);
                  setHorseToAdd('');
                }}
              >
                Top 5
              </button>
            </div>
            <div className="horse-chip-list">
              {visibleRaceRows.map((standing) => (
                <span className="horse-chip" key={standing.id}>
                  #{standing.draftOrder} {standing.ticker}
                  <button
                    type="button"
                    title={`Remove ${standing.ticker}`}
                    aria-label={`Remove ${standing.ticker} from simulation`}
                    onClick={() => setSelectedHorseIds((ids) => ids.filter((id) => id !== standing.id))}
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          </aside>
        </div>
      </section>

      <section className="analytics-grid">
        <div className="chart-panel">
          <div className="section-header section-header--compact">
            <div>
              <p className="eyebrow">Selected Field + Trailer</p>
              <h2>Return Trend</h2>
            </div>
            <TrendingUp size={22} aria-hidden="true" />
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 18, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="#d9ddd6" strokeDasharray="4 4" />
                <XAxis dataKey="date" tick={{ fill: '#5b625c', fontSize: 12 }} />
                <YAxis
                  tick={{ fill: '#5b625c', fontSize: 12 }}
                  tickFormatter={(value) => `${value}%`}
                  width={44}
                />
                <Tooltip formatter={(value) => [`${Number(value).toFixed(2)}%`, 'Return']} />
                {chartTickers.map((ticker, index) => (
                  <Line
                    dataKey={ticker}
                    dot={false}
                    key={ticker}
                    stroke={lineColors[index % lineColors.length]}
                    strokeWidth={index < 5 ? 3 : 2}
                    type="monotone"
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-legend">
            {chartTickers.map((ticker, index) => (
              <span key={ticker}>
                <i style={{ background: lineColors[index % lineColors.length] }} />
                {ticker}
              </span>
            ))}
          </div>
        </div>

        <div className="data-panel">
          <p className="eyebrow">Data Board</p>
          <h2>Refresh Status</h2>
          <dl>
            <div>
              <dt>Generated</dt>
              <dd>{data.generatedAt ? formatDateTime(data.generatedAt) : 'Not yet refreshed'}</dd>
            </div>
            <div>
              <dt>Manual Sales</dt>
              <dd>{data.hasFinalSalePrices ? 'Loaded' : 'Waiting for Dec. 21 sale prices'}</dd>
            </div>
            <div>
              <dt>Crypto Mappings</dt>
              <dd>{Object.entries(data.symbolMappings).map(([from, to]) => `${from}=${to}`).join(', ')}</dd>
            </div>
          </dl>
          {data.warnings.length > 0 && (
            <div className="warning-list">
              {data.warnings.slice(0, 4).map((warning) => (
                <p key={`${warning.ticker}-${warning.message}`}>
                  <strong>{warning.ticker}</strong> {warning.message}
                </p>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="leaderboard-section" aria-label="Leaderboard">
        <div className="section-header">
          <div>
            <p className="eyebrow">Score Sheet</p>
            <h2>Leaderboard</h2>
          </div>
          <div className="table-controls">
            <label>
              <span>Sort</span>
              <select
                aria-label="Sort leaderboard"
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
              >
                <option value="rank">Rank</option>
                <option value="draft">Draft order</option>
                <option value="return">Return</option>
                <option value="value">Value</option>
                <option value="topUp">Pay in</option>
                <option value="ticker">Ticker</option>
              </select>
            </label>
            <label className="switch">
              <input
                checked={topFiveOnly}
                onChange={(event) => setTopFiveOnly(event.target.checked)}
                type="checkbox"
              />
              <span>Top 5</span>
            </label>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Horse</th>
                <th>Player</th>
                <th>Ticker</th>
                <th>Shares</th>
                <th>Return</th>
                <th>Value</th>
                <th>Pay In</th>
                <th>Payout</th>
              </tr>
            </thead>
            <tbody>
              {sortedStandings.map((standing) => (
                <tr
                  className={[
                    standing.isTopFive ? 'row--top' : '',
                    standing.isLast ? 'row--last' : '',
                    standing.topUpOwed > 0 ? 'row--negative' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  key={standing.id}
                >
                  <td>{ordinal(standing.rank)}</td>
                  <td>
                    <span className="horse-number">{standing.draftOrder}</span>
                  </td>
                  <td>{standing.name}</td>
                  <td>
                    <span className="ticker-badge">{standing.ticker}</span>
                  </td>
                  <td>{number.format(standing.shares)}</td>
                  <td className={standing.returnPct >= 0 ? 'positive' : 'negative'}>
                    {percent.format(standing.returnPct)}%
                  </td>
                  <td>{money.format(standing.value)}</td>
                  <td>{money.format(standing.topUpOwed)}</td>
                  <td>{standing.projectedPayout ? money.format(standing.projectedPayout) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function EmptyState({ warnings }: { warnings: Warning[] }) {
  return (
    <main className="app-shell">
      <section className="scoreboard">
        <div className="scoreboard__content">
          <div>
            <p className="eyebrow">2026 Stock Draft Competition</p>
            <h1>Stock Draft Derby</h1>
            <p className="empty-copy">No race snapshots are loaded yet.</p>
          </div>
        </div>
      </section>
      <section className="data-panel data-panel--empty">
        <p className="eyebrow">Data Board</p>
        <h2>Refresh Needed</h2>
        {warnings.map((warning) => (
          <p key={`${warning.ticker}-${warning.message}`}>
            <strong>{warning.ticker}</strong> {warning.message}
          </p>
        ))}
      </section>
    </main>
  );
}

function StatCard({
  accentLabel,
  accentValue,
  detail,
  icon,
  label,
  tone,
  value,
}: {
  accentLabel?: string;
  accentValue?: string;
  detail: string;
  icon: React.ReactNode;
  label: string;
  tone: 'gold' | 'green' | 'ink' | 'red';
  value: string;
}) {
  return (
    <article className={`stat-card stat-card--${tone} ${accentValue ? 'stat-card--split' : ''}`}>
      <div className="stat-card__main">
        <div className="stat-card__icon" aria-hidden="true">
          {icon}
        </div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      {accentValue && (
        <div className="stat-card__accent">
          <span>{accentLabel}</span>
          <strong>{accentValue}</strong>
        </div>
      )}
    </article>
  );
}

function MoverCard({
  detail,
  icon,
  mover,
  title,
  tone,
}: {
  detail: string;
  icon: React.ReactNode;
  mover: Mover | null;
  title: string;
  tone: 'green' | 'red';
}) {
  const sourceLabel = mover?.note?.sourceLabel ?? `Research ${mover?.ticker ?? 'this ticker'} news`;
  const sourceUrl =
    mover?.note?.sourceUrl ??
    `https://finance.yahoo.com/quote/${encodeURIComponent(mover?.ticker ?? '')}/news/`;

  return (
    <article className={`mover-card mover-card--${tone}`}>
      <div className="mover-card__topline">
        <div className="stat-card__icon" aria-hidden="true">
          {icon}
        </div>
        <div>
          <span>{title}</span>
          <small>{detail}</small>
        </div>
      </div>
      {mover ? (
        <>
          <div className="mover-card__score">
            <div>
              <strong>
                {mover.draftOrder}. {mover.name}
              </strong>
              <small>{mover.ticker}</small>
            </div>
            <b>{formatPointMove(mover.delta)}</b>
          </div>
          <p>
            <strong>{mover.note?.headline ?? 'Research note pending'}.</strong>{' '}
            {mover.note?.summary ?? 'This split has a calculated mover, but a sourced market note has not been added yet.'}
          </p>
          <a href={sourceUrl} rel="noreferrer" target="_blank">
            {sourceLabel}
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        </>
      ) : (
        <p>No prior Friday split yet. The first mover board appears once the race leaves the gate.</p>
      )}
    </article>
  );
}

function HorseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 64 36" focusable="false">
      <path d="M13 23c4-7 12-11 22-10l8 1 5-7 8 4-3 6 5 5-5 5-9-1-7 6-5-3-8 2-4-4-8 4-3-3Z" />
      <path d="M21 27l-3 8M31 28l1 7M43 25l4 9" />
      <circle cx="53" cy="13" r="1.7" />
    </svg>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function getOvalPoint(progress: number, index: number) {
  const lane = index % 6;
  const radiusX = 42 - lane * 1.85;
  const radiusY = 35 - lane * 1.25;
  const angle = -Math.PI / 2 - progress * Math.PI * 2;
  return {
    x: 50 + Math.cos(angle) * radiusX,
    y: 50 + Math.sin(angle) * radiusY,
  };
}

function formatPointMove(value: number) {
  return `${percent.format(value)} pts`;
}

function ordinal(value: number) {
  const suffix = value % 10 === 1 && value % 100 !== 11 ? 'st' : value % 10 === 2 && value % 100 !== 12 ? 'nd' : value % 10 === 3 && value % 100 !== 13 ? 'rd' : 'th';
  return `${value}${suffix}`;
}

export default App;
