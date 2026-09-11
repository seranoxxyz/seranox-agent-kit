import type { Equity, Pair, RiskScan, TrackedWallet } from "@seranox/sdk";

/** What a strategy may ask for. The kit builds routes; it never signs — the `signer` you pass to the runner does. */
export type Action =
  | { type: "buy"; pair: string; amountIn: string; slippageBps?: number; reason?: string }
  | { type: "sell"; pair: string; amountIn: string; slippageBps?: number; reason?: string }
  | { type: "alert"; message: string }
  | { type: "scan"; pair: string };

export interface StrategyContext {
  /** Wall-clock at dispatch (ms). */
  now: number;
  /** Risk scans this tick already paid for, keyed by pair id. */
  scans: Map<string, RiskScan>;
  /** Strategy-private state persisted across ticks. */
  memory: Map<string, unknown>;
}

export interface Strategy {
  name: string;
  version?: string;
  description?: string;
  /** Called once per pair the runner has not seen before. */
  onNewPair?: (pair: Pair, ctx: StrategyContext) => Action[] | Promise<Action[]>;
  /** Called when a tracked wallet's 30d stats change between ticks. */
  onWalletUpdate?: (wallet: TrackedWallet, prev: TrackedWallet | undefined, ctx: StrategyContext) => Action[] | Promise<Action[]>;
  /** Called for each tokenized equity whose |spread| crosses `dislocationThresholdPct`. */
  onDislocation?: (equity: Equity, ctx: StrategyContext) => Action[] | Promise<Action[]>;
  /** Minimum |spread %| before `onDislocation` fires (default 2). */
  dislocationThresholdPct?: number;
}

export function defineStrategy(s: Strategy): Strategy {
  if (!s.name.trim()) throw new Error("Strategy needs a name.");
  return { version: "0.1.0", dislocationThresholdPct: 2, ...s };
}
