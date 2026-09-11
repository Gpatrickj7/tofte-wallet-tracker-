import { cache } from "./db";

const CG = "https://api.coingecko.com/api/v3";
export const COINGECKO_IDS: Record<string, string> = {
  ETC: "ethereum-classic", BNB: "binancecoin", SOL: "solana", BTC: "bitcoin", ETH: "ethereum",
  USDT: "tether", USDC: "usd-coin", WSOL: "wrapped-solana", TRX: "tron", MON: "monad",
};

export type SpotResult = { prices: Record<string, number>; asOf: number; error: string | null };

// Current spot prices; cached 5 min. Failure is surfaced, never masked.
export async function spotPrices(symbols: string[]): Promise<SpotResult> {
  const ids = [...new Set(symbols.map((s) => COINGECKO_IDS[s]).filter(Boolean))].sort();
  const contracts: Record<string, string[]> = {};
  for (const s of symbols) if (s.startsWith("cg:")) { const [, plat, ca] = s.split(":"); (contracts[plat] ??= []).push(ca); }
  const key = "spot:" + ids.join(",") + "|" + Object.entries(contracts).map(([p, c]) => p + "=" + c.sort().join(",")).join(";");
  const now = Math.floor(Date.now() / 1000);
  const row = await cache.get(key);
  if (row && now - Number(row.fetched_at) < 300) return { prices: JSON.parse(row.value), asOf: Number(row.fetched_at), error: null };
  const prices: Record<string, number> = {};
  let cgError: string | null = null;
  try {
    const r = await fetch(`${CG}/simple/price?ids=${ids.join(",")}&vs_currencies=usd`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
    const j = (await r.json()) as Record<string, { usd: number }>;
    for (const [sym, id] of Object.entries(COINGECKO_IDS)) if (j[id]?.usd != null) prices[sym] = j[id].usd;
  } catch (e) { cgError = (e as Error).message; }
  // Fallback for majors: Coinbase public spot (no key, no geo-block).
  const wantSyms = [...new Set(symbols.filter((s) => COINGECKO_IDS[s] && prices[s] == null))];
  await Promise.all(wantSyms.map(async (sym) => {
    const pair = sym === "WSOL" ? "SOL" : sym;
    try {
      const r = await fetch(`https://api.coinbase.com/v2/prices/${pair}-USD/spot`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
      if (!r.ok) return;
      const x = await r.json();
      const p = Number(x?.data?.amount);
      if (p > 0) prices[sym] = p;
    } catch { /* leave unpriced */ }
  }));
  try {
    for (const [plat, cas] of Object.entries(contracts)) {
      const tr = await fetch(`${CG}/simple/token_price/${plat}?contract_addresses=${cas.join(",")}&vs_currencies=usd`, { cache: "no-store", signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (!tr) continue;
      if (!tr.ok) continue; // unpriced tokens show "no price"; native prices still valid
      const tj = (await tr.json()) as Record<string, { usd: number }>;
      for (const [ca, v] of Object.entries(tj)) if (v?.usd != null) prices[`cg:${plat}:${ca.toLowerCase()}`] = v.usd;
      for (const ca of cas) { const hit = prices[`cg:${plat}:${ca.toLowerCase()}`]; if (hit != null) prices[`cg:${plat}:${ca}`] = hit; }
    }
    // Fallback: DexScreener for anything CoinGecko doesn't list.
    const DEX: Record<string, string> = { ethereum: "ethereum", "binance-smart-chain": "bsc", solana: "solana", tron: "tron", linea: "linea", "ethereum-classic": "ethereumclassic" };
    for (const [plat, cas] of Object.entries(contracts)) {
      const missing = cas.filter((ca) => prices[`cg:${plat}:${ca}`] == null);
      if (!missing.length || !DEX[plat]) continue;
      const dr = await fetch(`https://api.dexscreener.com/tokens/v1/${DEX[plat]}/${missing.slice(0, 30).join(",")}`, { cache: "no-store", signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (!dr?.ok) continue;
      const pairs = (await dr.json()) as { baseToken: { address: string }; priceUsd?: string; liquidity?: { usd?: number } }[];
      for (const ca of missing) {
        const best = pairs.filter((p) => p.baseToken.address.toLowerCase() === ca.toLowerCase() && p.priceUsd).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
        if (best) prices[`cg:${plat}:${ca}`] = Number(best.priceUsd);
      }
    }
    await cache.set(key, JSON.stringify(prices), now);
    const missingMajors = wantSyms.filter((s) => prices[s] == null);
    return { prices, asOf: now, error: missingMajors.length ? `${cgError ?? "CoinGecko incomplete"}; no fallback price for ${missingMajors.join(", ")}` : null };
  } catch (e) {
    return { prices, asOf: Object.keys(prices).length ? now : 0, error: (e as Error).message };
  }
}

// Historical price at a date (UTC). Cached forever once fetched.
export async function historicalPrice(symbol: string, ts: number): Promise<{ price: number | null; error: string | null }> {
  const id = COINGECKO_IDS[symbol];
  if (!id) return { price: null, error: `no coingecko id for ${symbol}` };
  const d = new Date(ts * 1000);
  const date = `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
  const key = `hist:${id}:${date}`;
  const row = await cache.get(key);
  if (row) return { price: Number(row.value), error: null };
  const errs: string[] = [];
  try {
    const r = await fetch(`${CG}/coins/${id}/history?date=${date}&localization=false`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
    const j = await r.json();
    const p = j?.market_data?.current_price?.usd;
    if (typeof p !== "number") throw new Error("no usd price in response");
    await cache.set(key, String(p), Math.floor(Date.now() / 1000));
    return { price: p, error: null };
  } catch (e) { errs.push((e as Error).message); }
  // Fallback: Kraken daily OHLC close for that UTC day.
  try {
    const day = Math.floor(ts / 86400) * 86400;
    const r = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${symbol}USD&interval=1440&since=${day - 86400}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Kraken ${r.status}`);
    const j = await r.json();
    const series = Object.entries(j.result ?? {}).find(([k]) => k !== "last")?.[1] as (string | number)[][] | undefined;
    const row = series?.find((c) => Number(c[0]) === day) ?? series?.[0];
    const p = row ? Number(row[4]) : NaN;
    if (!(p > 0)) throw new Error("no candle");
    await cache.set(key, String(p), Math.floor(Date.now() / 1000));
    return { price: p, error: null };
  } catch (e) { errs.push((e as Error).message); }
  return { price: null, error: errs.join(" · ") };
}
