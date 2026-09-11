import { describe, expect, it, vi } from "vitest";
import { SeranoxClient, type Pair, type Candle, type RouteQuote } from "@seranox/sdk";

import { backtest, buildManifest, defineStrategy, minimumBond, runStrategy, seranoxTools, verifyManifest } from "../src/index.js";

const pair = (id: string, over: Partial<Pair> = {}): Pair => ({
  id, symbol: id.toUpperCase(), name: id, address: `0x${id}`, deployer: "0xd", ageMin: 5, priceUsd: 1, change5m: 0, change1h: 0, change24h: 0,
  liquidityUsd: 100_000, mcapUsd: 1e6, volume24hUsd: 5e5, holders: 100, top10Pct: 15, risk: "clean", riskFlags: [], ...over,
});
const candles = (closes: number[]): Candle[] => closes.map((c, i) => ({ t: i, o: c, h: c, l: c, c, v: 1 }));

/** Fake API that can grow its pair list between ticks. */
function fakeClient(state: { pairs: Pair[] }) {
  const f: typeof fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace("/v1", "");
    const j = (data: unknown, burned = 1, status = 200) => Promise.resolve(new Response(JSON.stringify({ data }), { status, headers: { "x-sera-burned": String(burned) } }));
    if (path === "/pairs") return j(state.pairs);
    if (path.endsWith("/risk")) return j({ verdict: "clean", checks: [] }, 5);
    if (path === "/wallets") return j([]);
    if (path === "/equities/dislocation") return j([{ ticker: "TSLA", spreadPct: 3.1 }, { ticker: "HOOD", spreadPct: 0.4 }]);
    if (path === "/route") return j({ unsignedTx: { to: "0xRouter", data: "0x", value: "0" }, quote: { feeBps: 60, side: (JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { side: string }).side } }, 0);
    return Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
  };
  return new SeranoxClient({ baseUrl: "https://api.test/v1", apiKey: "k", fetch: f });
}

const sniper = defineStrategy({
  name: "sniper",
  onNewPair: (p) => (p.risk === "clean" && p.liquidityUsd >= 50_000 ? [{ type: "scan", pair: p.id }, { type: "buy", pair: p.address, amountIn: "100000000", reason: "clean" }] : []),
  onDislocation: (e) => [{ type: "alert", message: `${e.ticker} ${e.spreadPct}%` }],
});

describe("backtest", () => {
  it("simulates buys with fees and hashes the report deterministically", async () => {
    const input = { pairs: [pair("a"), pair("b", { risk: "danger" }), pair("c")], candles: { a: candles([1, 1.1, 1.2, 1.5]), c: candles([2, 1.8, 1.6]) }, holdCandles: 2, feeBps: 100 };
    const r1 = await backtest(sniper, input);
    const r2 = await backtest(sniper, input);
    expect(r1.trades.map((t) => t.symbol)).toEqual(["A", "C"]);
    expect(r1.wins).toBe(1);
    expect(r1.losses).toBe(1);
    expect(r1.trades[0]!.pnlPct).toBeCloseTo((1.2 * 0.99) / (1 * 1.01) * 100 - 100, 5);
    expect(r1.seraBurnedEstimate).toBe(2 * 5 + 3);
    expect(r1.hash).toBe(r2.hash);
  });
});

describe("listing manifest", () => {
  it("binds the bond to the report hash and rejects underfunded bonds", async () => {
    const report = await backtest(sniper, { pairs: [pair("a")], candles: { a: candles([1, 2, 3]) } });
    const m = buildManifest(sniper, report, { author: "0xme", now: new Date(0) });
    expect(m.bondSera).toBe(minimumBond(report));
    expect(m.performance.reportHash).toBe(report.hash);
    expect(verifyManifest(m, report)).toBe(true);
    expect(verifyManifest({ ...m, performance: { ...m.performance, winRate: 99 } }, report)).toBe(false);
    expect(() => buildManifest(sniper, report, { author: "0xme", bondSera: 1 })).toThrow(/below the minimum/);
  });
});

describe("runStrategy", () => {
  it("warms up on the first tick, then fires on new pairs and routes through the signer", async () => {
    const state = { pairs: [pair("old")] };
    const client = fakeClient(state);
    const signer = vi.fn((q: RouteQuote) => Promise.resolve(`0xtxhash:${q.unsignedTx.to}`));
    const actions: string[] = [];
    const run = runStrategy({ client, strategy: sniper, signer, intervalMs: 1, maxTicks: 1, onAction: (a, r) => actions.push(`${a.type}${r?.txHash ? ":" + r.txHash : ""}`) });
    await run.done; // tick 1: warm-up (old pair ignored) + dislocation alert
    expect(actions).toEqual(["alert"]);
    state.pairs = [pair("fresh"), pair("old")];
    const out = await run.tick();
    expect(out.map((a) => a.type)).toEqual(["scan", "buy", "alert"]);
    expect(signer).toHaveBeenCalledTimes(1);
    expect(actions).toContain("buy:0xtxhash:0xRouter");
    expect(client.usage.seraBurned).toBeGreaterThanOrEqual(5);
  });

  it("dry-runs without a signer", async () => {
    const state = { pairs: [] as Pair[] };
    const client = fakeClient(state);
    const log: string[] = [];
    const run = runStrategy({ client, strategy: sniper, maxTicks: 1, intervalMs: 1, log: (m) => log.push(m) });
    await run.done;
    state.pairs = [pair("x")];
    await run.tick();
    expect(log.some((l) => l.startsWith("dry-run buy"))).toBe(true);
  });
});

describe("seranoxTools", () => {
  it("exposes framework-neutral tools that report cost", async () => {
    const client = fakeClient({ pairs: [pair("a"), pair("b", { risk: "danger" })] });
    const tools = seranoxTools(client);
    expect(Object.values(tools).map((t) => t.name)).toContain("seranox_build_route");
    const r = await tools.list_pairs.execute({ sort: "new", risk: ["clean"], limit: 10 });
    expect(r.data.map((p) => p.symbol)).toEqual(["A"]);
    expect(r.cost.seraBurned).toBe(1);
    expect(tools.risk_scan.parameters.safeParse({ pair: "x" }).success).toBe(true);
  });
});
