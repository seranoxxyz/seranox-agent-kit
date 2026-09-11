import { z } from "zod";
import type { SeranoxClient } from "@seranox/sdk";

/**
 * Framework-neutral tool definitions: `{ name, description, parameters (zod), execute }`.
 * - Vercel AI SDK: `tool({ description, parameters, execute })` per entry.
 * - LangChain: `new DynamicStructuredTool({ name, description, schema: parameters, func: execute })`.
 * - MCP: see `@seranox/mcp-server` for the stdio server.
 * Reads only, plus `build_route` which returns an UNSIGNED tx — the agent must hand it to a signer.
 */
export function seranoxTools(client: SeranoxClient) {
  const wrap = async <T>(p: Promise<{ data: T; cost: { seraBurned: number } }>) => {
    const r = await p;
    return { data: r.data, cost: r.cost };
  };
  return {
    list_pairs: {
      name: "seranox_list_pairs",
      description: "New memecoin pairs on Robinhood Chain with liquidity, change, holders, and a risk verdict. Burns 1 SERA.",
      parameters: z.object({ sort: z.enum(["new", "liq"]).default("new"), risk: z.array(z.enum(["clean", "caution", "danger"])).optional(), limit: z.number().int().min(1).max(50).default(20) }),
      execute: async ({ sort, risk, limit }: { sort: "new" | "liq"; risk?: Array<"clean" | "caution" | "danger">; limit: number }) => {
        const r = await client.pairs.list({ sort });
        return { data: r.data.filter((p) => !risk || risk.includes(p.risk)).slice(0, limit), cost: r.cost };
      },
    },
    risk_scan: {
      name: "seranox_risk_scan",
      description: "Contract risk scan for a pair (honeypot, mint authority, LP lock, deployer, concentration). Burns 5 SERA.",
      parameters: z.object({ pair: z.string() }),
      execute: ({ pair }: { pair: string }) => wrap(client.pairs.risk(pair)),
    },
    wallet_flow: {
      name: "seranox_wallet_flow",
      description: "Intel for a tracked wallet by address or label. Burns 2 SERA.",
      parameters: z.object({ wallet: z.string() }),
      execute: ({ wallet }: { wallet: string }) => wrap(client.wallets.flow(wallet)),
    },
    equities_dislocation: {
      name: "seranox_equities_dislocation",
      description: "Tokenized equities: on-chain print vs last exchange close, flow, accumulators vs distributors. Read-only. Burns 1 SERA.",
      parameters: z.object({ ticker: z.string().optional() }),
      execute: ({ ticker }: { ticker?: string }) => wrap(client.equities.dislocation(ticker ? { ticker } : {})),
    },
    build_route: {
      name: "seranox_build_route",
      description: "Build an UNSIGNED swap through the Seranox router. Never signs. Requires a staked-account API key.",
      parameters: z.object({ pair: z.string(), side: z.enum(["buy", "sell"]), amountIn: z.string().regex(/^\d+$/), slippageBps: z.number().int().min(1).max(5000).default(100) }),
      execute: (args: { pair: string; side: "buy" | "sell"; amountIn: string; slippageBps: number }) => wrap(client.route.build(args)),
    },
  };
}

export type SeranoxTools = ReturnType<typeof seranoxTools>;
