# @seranox/agent-kit

Build, backtest, and publish trading agents for **Seranox** on Robinhood Chain.

- **`defineStrategy`** — typed hooks: `onNewPair`, `onWalletUpdate`, `onDislocation`. Hooks return actions (`buy`, `sell`, `scan`, `alert`); they never touch keys.
- **`runStrategy`** — polling runner that diffs pairs / wallets / equities between ticks, warms up on history, builds **unsigned** routes via the SDK and hands them to *your* `signer`. No signer = dry run.
- **`backtest`** — local simulation over candles (utility #20) with fees, drawdown, a SERA-burn estimate, and a deterministic `hash`.
- **`buildManifest`** — listing manifest for the agent marketplace (utility #27) with a **posted bond** (utility #30) that scales with the performance claim and binds to the backtest hash; `verifyManifest` recomputes it.
- **`seranoxTools`** — framework-neutral tools (`name`, `description`, zod `parameters`, `execute`) for Vercel AI SDK, LangChain, or your own loop. For MCP use `@seranox/mcp-server`.

```bash
pnpm add @seranox/agent-kit @seranox/sdk
```

```ts
import { SeranoxClient } from "@seranox/sdk";
import { defineStrategy, runStrategy, backtest, buildManifest } from "@seranox/agent-kit";

const sniper = defineStrategy({
  name: "clean-launch-sniper",
  onNewPair: (p) =>
    p.risk === "clean" && p.liquidityUsd >= 50_000 && p.top10Pct <= 20
      ? [{ type: "scan", pair: p.id }, { type: "buy", pair: p.address, amountIn: "100000000", reason: "clean launch" }]
      : [],
  onDislocation: (e) => [{ type: "alert", message: `${e.ticker} ${e.spreadPct.toFixed(2)}% vs close` }],
});

const client = new SeranoxClient({ apiKey: process.env.SERANOX_API_KEY, budget: { maxSera: 100 } });

const report = await backtest(sniper, { pairs, candles });           // utility #20
const manifest = buildManifest(sniper, report, { author: "0xYou" }); // bond ≥ minimumBond(report)

runStrategy({
  client,
  strategy: sniper,
  signer: async (quote) => walletClient.sendTransaction(toTxRequest(quote)), // you sign
  intervalMs: 15_000,
  maxTradesPerTick: 2,
});
```

Run the bundled example against a local `seranox-dapp` API:

```bash
SERANOX_API_URL=http://localhost:5173/api/v1 SERANOX_API_KEY=demo pnpm example
```

### Vercel AI SDK / LangChain

```ts
import { tool } from "ai";
const t = seranoxTools(client);
const tools = { listPairs: tool({ description: t.list_pairs.description, parameters: t.list_pairs.parameters, execute: t.list_pairs.execute }) };
```

## Develop

Depends on `@seranox/sdk` via `file:../seranox-sdk` — clone the SDK as a sibling folder and `pnpm build` it first (CI does the same).

```bash
pnpm install && pnpm test && pnpm lint && pnpm typecheck && pnpm build
```

MIT.
