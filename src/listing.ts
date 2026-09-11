import { createHash } from "node:crypto";
import type { BacktestReport } from "./backtest.js";
import type { Strategy } from "./strategy.js";

export interface ListingManifest {
  schema: "seranox.listing/1";
  name: string;
  version: string;
  description?: string | undefined;
  author: string;
  /** $SERA bond posted with the listing (whitepaper utility #30). Forfeited on misreported performance. */
  bondSera: number;
  performance: {
    trades: number;
    winRate: number;
    totalPnlUsd: number;
    maxDrawdownPct: number;
    /** sha256 of the full backtest report — verifiers recompute it from the same inputs. */
    reportHash: string;
  };
  /** sha256 over everything above; sign this with the author wallet when publishing. */
  digest: string;
  createdAt: string;
}

/** Minimum bond scales with claimed performance so bigger claims cost more to fake. */
export function minimumBond(report: BacktestReport): number {
  const base = 5_000;
  const perfFactor = Math.max(0, report.winRate - 50) * 100 + Math.max(0, report.totalPnlUsd) * 0.05;
  return Math.round(base + perfFactor);
}

export function buildManifest(strategy: Strategy, report: BacktestReport, opts: { author: string; bondSera?: number; now?: Date }): ListingManifest {
  const bond = opts.bondSera ?? minimumBond(report);
  if (bond < minimumBond(report)) throw new Error(`Bond ${bond} SERA is below the minimum ${minimumBond(report)} SERA for this performance claim.`);
  const body = {
    schema: "seranox.listing/1" as const,
    name: strategy.name,
    version: strategy.version ?? "0.1.0",
    description: strategy.description,
    author: opts.author,
    bondSera: bond,
    performance: {
      trades: report.trades.length,
      winRate: Number(report.winRate.toFixed(2)),
      totalPnlUsd: Number(report.totalPnlUsd.toFixed(2)),
      maxDrawdownPct: Number(report.maxDrawdownPct.toFixed(2)),
      reportHash: report.hash,
    },
    createdAt: (opts.now ?? new Date()).toISOString(),
  };
  const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return { ...body, digest };
}

/** True when a manifest's performance block still matches the report it claims to summarize. */
export function verifyManifest(m: ListingManifest, report: BacktestReport): boolean {
  return m.performance.reportHash === report.hash && m.performance.trades === report.trades.length && Math.abs(m.performance.winRate - report.winRate) < 0.01;
}
