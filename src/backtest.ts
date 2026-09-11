import { createHash } from "node:crypto";
import type { Candle, Pair } from "@seranox/sdk";
import type { Action, Strategy, StrategyContext } from "./strategy.js";

export interface BacktestInput {
  /** Pairs in the order they "launched". */
  pairs: Pair[];
  /** Candles per pair id, oldest first. Buys fill at the first close after the signal; exits at `holdCandles` later. */
  candles: Record<string, Candle[]>;
  /** How many candles a position is held (default 12 = 1h of 5m candles). */
  holdCandles?: number;
  /** Fee in bps applied on entry and exit (default 60 = Tier 2). */
  feeBps?: number;
}

export interface Trade {
  pair: string;
  symbol: string;
  amountIn: number;
  entry: number;
  exit: number;
  pnlPct: number;
  pnlUsd: number;
  reason?: string | undefined;
}

export interface BacktestReport {
  strategy: { name: string; version: string };
  trades: Trade[];
  wins: number;
  losses: number;
  winRate: number;
  totalPnlUsd: number;
  avgPnlPct: number;
  maxDrawdownPct: number;
  seraBurnedEstimate: number;
  /** Deterministic hash of the inputs + trades — the listing bond binds to this. */
  hash: string;
}

/**
 * Local strategy simulation over historical candles (whitepaper utility #20).
 * Only `onNewPair` buys are simulated; sells/alerts/scans are counted but not priced.
 */
export async function backtest(strategy: Strategy, input: BacktestInput): Promise<BacktestReport> {
  const hold = input.holdCandles ?? 12;
  const fee = (input.feeBps ?? 60) / 10_000;
  const trades: Trade[] = [];
  let scans = 0;
  const memory = new Map<string, unknown>();
  for (const pair of input.pairs) {
    if (!strategy.onNewPair) break;
    const ctx: StrategyContext = { now: 0, scans: new Map(), memory };
    const actions: Action[] = await strategy.onNewPair(pair, ctx);
    scans += actions.filter((a) => a.type === "scan").length;
    const series = input.candles[pair.id] ?? [];
    for (const a of actions) {
      if (a.type !== "buy" || series.length < 2) continue;
      const entryIdx = 0;
      const exitIdx = Math.min(series.length - 1, entryIdx + hold);
      const entry = series[entryIdx]!.c * (1 + fee);
      const exit = series[exitIdx]!.c * (1 - fee);
      const amountIn = Number(a.amountIn) / 1e6; // USDC 6dp → USD
      const pnlPct = (exit / entry - 1) * 100;
      trades.push({ pair: pair.id, symbol: pair.symbol, amountIn, entry, exit, pnlPct, pnlUsd: amountIn * (pnlPct / 100), reason: a.reason });
    }
  }
  const wins = trades.filter((t) => t.pnlUsd > 0).length;
  let peak = 0, equity = 0, maxDd = 0;
  for (const t of trades) {
    equity += t.pnlUsd;
    peak = Math.max(peak, equity);
    if (peak > 0) maxDd = Math.max(maxDd, ((peak - equity) / peak) * 100);
  }
  const report: Omit<BacktestReport, "hash"> = {
    strategy: { name: strategy.name, version: strategy.version ?? "0.1.0" },
    trades,
    wins,
    losses: trades.length - wins,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    totalPnlUsd: trades.reduce((s, t) => s + t.pnlUsd, 0),
    avgPnlPct: trades.length ? trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length : 0,
    maxDrawdownPct: maxDd,
    seraBurnedEstimate: scans * 5 + input.pairs.length * 1,
  };
  const hash = createHash("sha256").update(JSON.stringify({ report, pairs: input.pairs.map((p) => p.id), hold, fee })).digest("hex");
  return { ...report, hash };
}
