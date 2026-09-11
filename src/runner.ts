import type { RouteQuote, SeranoxClient, TrackedWallet } from "@seranox/sdk";
import type { Action, Strategy, StrategyContext } from "./strategy.js";

export interface Signer {
  /** Receives an UNSIGNED route and must sign + broadcast it with the user's own wallet. Return a tx hash. */
  (quote: RouteQuote, action: Extract<Action, { type: "buy" | "sell" }>): Promise<string>;
}

export interface RunnerOptions {
  client: SeranoxClient;
  strategy: Strategy;
  /** Called for buy/sell actions. Omit for dry runs — actions are logged, nothing is routed. */
  signer?: Signer;
  /** Polling interval in ms (default 15s). */
  intervalMs?: number;
  /** Stop after this many ticks (default: run until `stop()`). */
  maxTicks?: number;
  /** Max buy/sell actions the runner will execute per tick (default 2). */
  maxTradesPerTick?: number;
  onAction?: (action: Action, result?: { txHash?: string; error?: string }) => void;
  onError?: (err: unknown) => void;
  log?: (msg: string) => void;
}

export interface RunnerHandle {
  stop: () => void;
  done: Promise<void>;
  /** Run a single tick immediately (useful in tests). */
  tick: () => Promise<Action[]>;
}

/**
 * Polls the Seranox API, diffs pairs / wallets / equities between ticks, and
 * dispatches strategy hooks. Buys and sells go through `client.route.build`
 * (unsigned) and then to your `signer` — the kit never holds keys.
 */
export function runStrategy(opts: RunnerOptions): RunnerHandle {
  const { client, strategy } = opts;
  const log = opts.log ?? (() => {});
  const seenPairs = new Set<string>();
  const lastWallets = new Map<string, TrackedWallet>();
  const memory = new Map<string, unknown>();
  let stopped = false;
  let ticks = 0;
  let first = true;

  const dispatch = async (actions: Action[]): Promise<void> => {
    let trades = 0;
    for (const a of actions) {
      if (a.type === "alert") {
        log(`alert: ${a.message}`);
        opts.onAction?.(a);
        continue;
      }
      if (a.type === "scan") {
        try {
          const res = await client.pairs.risk(a.pair);
          log(`scan ${a.pair}: ${res.data.verdict} (${res.cost.seraBurned} SERA)`);
          opts.onAction?.(a);
        } catch (err) {
          opts.onAction?.(a, { error: String(err) });
        }
        continue;
      }
      if (trades >= (opts.maxTradesPerTick ?? 2)) {
        opts.onAction?.(a, { error: "maxTradesPerTick reached" });
        continue;
      }
      trades += 1;
      if (!opts.signer) {
        log(`dry-run ${a.type} ${a.pair} ${a.amountIn}${a.reason ? ` — ${a.reason}` : ""}`);
        opts.onAction?.(a);
        continue;
      }
      try {
        const q = await client.route.build({ pair: a.pair, side: a.type, amountIn: a.amountIn, slippageBps: a.slippageBps ?? 100 });
        const txHash = await opts.signer(q.data, a);
        log(`${a.type} ${a.pair} signed → ${txHash}`);
        opts.onAction?.(a, { txHash });
      } catch (err) {
        opts.onAction?.(a, { error: String(err) });
      }
    }
  };

  const tick = async (): Promise<Action[]> => {
    ticks += 1;
    const ctx: StrategyContext = { now: Date.now(), scans: new Map(), memory };
    const out: Action[] = [];
    if (strategy.onNewPair) {
      const pairs = (await client.pairs.list({ sort: "new" })).data;
      for (const p of pairs) {
        if (seenPairs.has(p.id)) continue;
        seenPairs.add(p.id);
        if (first) continue; // warm-up: don't fire on history
        out.push(...(await strategy.onNewPair(p, ctx)));
      }
    }
    if (strategy.onWalletUpdate) {
      const wallets = (await client.wallets.list()).data;
      for (const w of wallets) {
        const prev = lastWallets.get(w.address);
        lastWallets.set(w.address, w);
        if (first) continue;
        if (!prev || prev.pnl30dUsd !== w.pnl30dUsd || prev.trades30d !== w.trades30d) out.push(...(await strategy.onWalletUpdate(w, prev, ctx)));
      }
    }
    if (strategy.onDislocation) {
      const eq = (await client.equities.dislocation()).data;
      for (const e of eq) {
        if (Math.abs(e.spreadPct) >= (strategy.dislocationThresholdPct ?? 2)) out.push(...(await strategy.onDislocation(e, ctx)));
      }
    }
    first = false;
    await dispatch(out);
    return out;
  };

  const done = (async () => {
    while (!stopped) {
      try {
        await tick();
      } catch (err) {
        opts.onError?.(err);
      }
      if (opts.maxTicks && ticks >= opts.maxTicks) break;
      await new Promise((r) => setTimeout(r, opts.intervalMs ?? 15_000));
    }
  })();

  return { stop: () => (stopped = true), done, tick };
}
