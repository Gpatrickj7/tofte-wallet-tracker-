import { config } from "@/config";
import { payouts, type Payout } from "./db";
import { historicalPrice } from "./prices";
import { fromBase } from "./units";

export type PoolStatus = {
  hashrate: number; unpaidBase: string; thresholdBase: string; avgHashrate24h: number;
  etaHours: number | null; error: string | null;
};

// 2Miners ETC. Amounts are in wei-ish "shannon"? No: 2miners returns balances in 1e-9 units (gwei) for ETC.
const UNIT_DECIMALS = 9;

export async function fetchPool(): Promise<PoolStatus> {
  const empty: PoolStatus = { hashrate: 0, unpaidBase: "0", thresholdBase: "0", avgHashrate24h: 0, etaHours: null, error: null };
  if (config.pool.name !== "2miners") return { ...empty, error: `pool "${config.pool.name}" not supported (only 2miners)` };
  if (!config.pool.address) return { ...empty, error: "POOL_ADDRESS not set" };
  try {
    const r = await fetch(`https://etc.2miners.com/api/accounts/${config.pool.address}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`2miners ${r.status}`);
    const j = await r.json();
    const unpaid = String(j.stats?.balance ?? 0);
    const threshold = String(j.config?.minPayout ?? 0);
    // Daily earnings estimate from sumrewards (24h) if present
    const day = (j.sumrewards ?? []).find((x: { name: string }) => x.name === "Last 24 hours");
    let etaHours: number | null = null;
    if (day?.reward > 0) {
      const remaining = BigInt(threshold) - BigInt(unpaid);
      etaHours = remaining <= 0n ? 0 : Number(remaining) / Number(day.reward) * 24;
    }
    // Record pool payouts (chain backfill below is authoritative for amounts; this tags the source)
    for (const p of j.payments ?? []) {
      const id = String(p.tx);
      if (!(await payouts.get(id))) await payouts.insert({ id, ts: Number(p.timestamp), asset: "ETC", amount_base: String(p.amount), decimals: UNIT_DECIMALS, usd_price: null, usd_value: null, price_error: null, source: "2miners" });
      else await payouts.setSource(id, "2miners");
    }
    return { hashrate: Number(j.currentHashrate ?? 0), avgHashrate24h: Number(j.hashrate ?? 0), unpaidBase: unpaid, thresholdBase: threshold, etaHours, error: null };
  } catch (e) {
    return { ...empty, error: (e as Error).message };
  }
}

// Every incoming native ETC transfer to the mining address, from Blockscout. Idempotent.
export async function backfillFromChain(): Promise<string | null> {
  const addr = config.wallets.etc.toLowerCase();
  if (!addr) return "ETC_ADDRESS not set";
  try {
    for (let page = 1; page <= 10; page++) {
      const r = await fetch(`https://etc.blockscout.com/api?module=account&action=txlist&address=${addr}&page=${page}&offset=500&sort=asc`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`blockscout ${r.status}`);
      const j = await r.json();
      const txs: { hash: string; to: string; from: string; value: string; timeStamp: string; isError: string }[] = Array.isArray(j.result) ? j.result : [];
      for (const t of txs) {
        if (t.to?.toLowerCase() !== addr || t.value === "0" || t.isError === "1") continue;
        if (!(await payouts.get(t.hash))) await payouts.insert({ id: t.hash, ts: Number(t.timeStamp), asset: "ETC", amount_base: t.value, decimals: 18, usd_price: null, usd_value: null, price_error: null, source: t.from.slice(0, 8) + "…" });
      }
      if (txs.length < 500) break;
    }
    return null;
  } catch (e) { return (e as Error).message; }
}

// Price up to `limit` unpriced payouts (oldest first). CoinGecko free tier rate-limits, so batches are small.
export async function priceUnpaid(limit: number): Promise<number> {
  const rows = await payouts.unpriced(limit);
  let n = 0;
  for (const p of rows) {
    const { price, error } = await historicalPrice("ETC", p.ts);
    const value = price == null ? null : (Number(fromBase(p.amount_base, p.decimals)) * price).toFixed(2);
    await payouts.setPrice(p.id, price == null ? null : String(price), value, error);
    if (price != null) n++;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return n;
}

export async function listPayouts(): Promise<Payout[]> {
  return payouts.list();
}
