import { SeranoxClient } from "@seranox/sdk";
import { defineStrategy, runStrategy, backtest, buildManifest } from "../src/index.js";

/**
 * Buys $100 of every clean launch with ≥ $50K liquidity and < 20% top-10 concentration.
 * Dry run unless you pass a `signer` — the kit never signs.
 */
const sniper = defineStrategy({
  name: "clean-launch-sniper",
  description: "Clean, liquid launches only. One scan, one buy, no chasing.",
  onNewPair: (p) => {
    if (p.risk !== "clean" || p.liquidityUsd < 50_000 || p.top10Pct > 20) return [];
    return [
      { type: "scan", pair: p.id },
      { type: "buy", pair: p.address, amountIn: "100000000", reason: `clean · liq ${p.liquidityUsd} · top10 ${p.top10Pct}%` },
    ];
  },
});

const client = new SeranoxClient({ baseUrl: process.env.SERANOX_API_URL ?? "http://localhost:5173/api/v1", apiKey: process.env.SERANOX_API_KEY, budget: { maxSera: 50 } });

// 1) backtest on the pairs the API knows about
const pairs = (await client.pairs.list({ sort: "new" })).data;
const candles = Object.fromEntries(await Promise.all(pairs.map(async (p) => [p.id, (await client.pairs.candles(p.id, 48)).data] as const)));
const report = await backtest(sniper, { pairs, candles });
console.log(`backtest: ${report.trades.length} trades, win ${report.winRate.toFixed(0)}%, pnl $${report.totalPnlUsd.toFixed(0)}, hash ${report.hash.slice(0, 12)}`);

// 2) listing manifest with the minimum bond for this claim
const manifest = buildManifest(sniper, report, { author: "0xYourWallet" });
console.log(`listing bond: ${manifest.bondSera} SERA · digest ${manifest.digest.slice(0, 12)}`);

// 3) run live (dry run: no signer)
const run = runStrategy({ client, strategy: sniper, maxTicks: 2, intervalMs: 2000, log: console.log });
await run.done;
console.log("burned", client.usage.seraBurned, "SERA");
