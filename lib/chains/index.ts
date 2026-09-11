import { config } from "@/config";
import { fromBase } from "../units";
import { cache } from "../db";

export type Position = {
  asset: string; priceSymbol: string; chain: string;
  kind: "native" | "token" | "bridged" | "wrapped";
  quantity: string; note?: string;
};
export type ChainResult = { chain: string; positions: Position[]; error: string | null };

const T = 8000;
async function j(url: string) {
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(T) });
  if (!r.ok) throw new Error(`${r.status} ${new URL(url).host}`);
  return r.json();
}
async function rpc(url: string, method: string, params: unknown[]) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), cache: "no-store", signal: AbortSignal.timeout(T) });
  if (!r.ok) throw new Error(`${r.status} ${new URL(url).host}`);
  const x = await r.json();
  if (x.error) throw new Error(`${x.error.message} (${new URL(url).host})`);
  return x.result;
}
// Try providers in order; surface all failures if none work.
async function firstOk<X>(attempts: (() => Promise<X>)[]): Promise<X> {
  const errs: string[] = [];
  for (const a of attempts) { try { return await a(); } catch (e) { errs.push((e as Error).message); } }
  throw new Error(errs.join(" · "));
}
const ETC_NOTE = "not in MetaMask's popular networks; add ETC network (chain 61) to see it there";
const MIMIC = /^(ETC|ETH|BTC|BNB|SOL|USDT|USDC|TRX)$/i;
const SCAM = "token contract impersonating a native coin. Almost certainly a scam airdrop. Do not visit any URL in its name or sign anything to 'claim' it.";

// ---- EVM ----------------------------------------------------------------
type Evm = { chain: string; native: string; platform: string; blockscout?: string; rpcs: string[]; note?: string };
const EVM: Record<string, Evm> = {
  etc:   { chain: "Ethereum Classic", native: "ETC", platform: "ethereum-classic", blockscout: "https://etc.blockscout.com/api", rpcs: ["https://etc.rivet.link", "https://etc.etcdesktop.com", "https://besu-at.etc-network.info"], note: ETC_NOTE },
  eth:   { chain: "Ethereum", native: "ETH", platform: "ethereum", blockscout: "https://eth.blockscout.com/api", rpcs: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com", "https://rpc.ankr.com/eth"] },
  linea: { chain: "Linea", native: "ETH", platform: "linea", rpcs: ["https://rpc.linea.build", "https://linea-rpc.publicnode.com"] },
  bsc:   { chain: "BNB Chain", native: "BNB", platform: "binance-smart-chain", rpcs: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org", "https://binance.llamarpc.com", "https://rpc.ankr.com/bsc"] },
};
const BSC_PEG_ETC = "0x3d6545b08693dae087e957cb1180ee38b9e3c25e";

async function evmNativeRpc(c: Evm, addr: string): Promise<string> {
  return firstOk(c.rpcs.map((u) => async () => BigInt(await rpc(u, "eth_getBalance", [addr, "latest"])).toString()));
}
async function evmTokenRpc(c: Evm, addr: string, ca: string): Promise<bigint> {
  const data = "0x70a08231" + addr.toLowerCase().replace("0x", "").padStart(64, "0");
  return firstOk(c.rpcs.map((u) => async () => BigInt((await rpc(u, "eth_call", [{ to: ca, data }, "latest"])) || "0x0")));
}
async function evm(key: keyof typeof EVM, addr: string): Promise<Position[]> {
  const c = EVM[key];
  const out: Position[] = [];
  let tokensDone = false;
  // Prefer Blockscout (native + token discovery); fall back to RPC (native only).
  if (c.blockscout) {
    try {
      const b = await j(`${c.blockscout}?module=account&action=balance&address=${addr}`);
      if (b.status !== "1") throw new Error(b.message ?? "blockscout error");
      out.push({ asset: c.native + (key === "linea" ? " (Linea)" : ""), priceSymbol: c.native, chain: c.chain, kind: "native", quantity: fromBase(b.result, 18), note: c.note });
      const t = await j(`${c.blockscout}?module=account&action=tokenlist&address=${addr}`).catch(() => ({ result: [] }));
      for (const tk of Array.isArray(t.result) ? t.result : []) {
        if (tk.balance === "0" || (tk.type && !/ERC-20/i.test(tk.type))) continue;
        const ca = String(tk.contractAddress ?? "").toLowerCase();
        const sym = String(tk.symbol || ca.slice(0, 8));
        const mimic = MIMIC.test(sym.trim());
        out.push({ asset: mimic ? `"${sym}" (token, NOT native ${sym.toUpperCase()})` : sym, priceSymbol: `cg:${c.platform}:${ca}`, chain: c.chain, kind: "token", quantity: fromBase(tk.balance, Number(tk.decimals || 18)), note: mimic ? SCAM : undefined });
      }
      tokensDone = true;
    } catch { /* fall through to RPC */ }
  }
  if (!out.length) {
    const bal = await evmNativeRpc(c, addr);
    out.push({ asset: c.native + (key === "linea" ? " (Linea)" : ""), priceSymbol: c.native, chain: c.chain, kind: "native", quantity: fromBase(bal, 18), note: c.note });
  }
  if (key === "bsc" && !tokensDone) {
    const tokens: [string, string][] = [[BSC_PEG_ETC, "ETC (bridged, Binance-Peg)"]];
    for (const x of (process.env.BSC_TOKENS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) tokens.push([x.toLowerCase(), x.slice(0, 8) + "…"]);
    for (const [ca, label] of tokens) {
      const q = await evmTokenRpc(c, addr, ca).catch(() => 0n);
      if (q === 0n) continue;
      const peg = ca === BSC_PEG_ETC;
      out.push({ asset: label, priceSymbol: peg ? "ETC" : `cg:${c.platform}:${ca}`, chain: c.chain, kind: peg ? "bridged" : "token", quantity: fromBase(q.toString(), 18) });
    }
  }
  return out;
}

// ---- Solana -------------------------------------------------------------
const SOL_RPCS = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com", "https://rpc.ankr.com/solana"];
async function splMeta(mint: string): Promise<{ symbol: string; name: string } | null> {
  const key = "spl:" + mint;
  const hit = await cache.get(key);
  if (hit) return JSON.parse(hit.value);
  try {
    const r = await fetch(`https://lite-api.jup.ag/tokens/v1/token/${mint}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const t = await r.json();
    const meta = { symbol: String(t.symbol ?? ""), name: String(t.name ?? "") };
    if (meta.symbol) await cache.set(key, JSON.stringify(meta), Math.floor(Date.now() / 1000));
    return meta;
  } catch { return null; }
}
async function sol(addr: string): Promise<Position[]> {
  const lamports = await firstOk(SOL_RPCS.map((u) => async () => (await rpc(u, "getBalance", [addr])).value as number));
  const out: Position[] = [{ asset: "SOL", priceSymbol: "SOL", chain: "Solana", kind: "native", quantity: fromBase(String(lamports), 9) }];
  const accts = await firstOk(SOL_RPCS.map((u) => async () =>
    (await rpc(u, "getTokenAccountsByOwner", [addr, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }])).value as { account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } } } }[]
  )).catch(() => []);
  for (const a of accts) {
    const info = a.account.data.parsed.info;
    if (info.tokenAmount.amount === "0") continue;
    const mint = info.mint;
    const wsol = mint === "So11111111111111111111111111111111111111112";
    const meta = wsol ? null : await splMeta(mint);
    const mimic = !!meta?.symbol && MIMIC.test(meta.symbol.trim());
    out.push({
      asset: wsol ? "wSOL (wrapped)" : mimic ? `"${meta!.symbol}" (token, NOT native)` : meta?.symbol ? `${meta.symbol}${meta.name && meta.name !== meta.symbol ? ` (${meta.name})` : ""}` : mint.slice(0, 4) + "…" + mint.slice(-4),
      priceSymbol: wsol ? "WSOL" : `cg:solana:${mint}`,
      chain: "Solana", kind: wsol ? "wrapped" : "token",
      quantity: fromBase(info.tokenAmount.amount, info.tokenAmount.decimals),
      note: mimic ? SCAM : undefined,
    });
  }
  return out;
}

// ---- Bitcoin ------------------------------------------------------------
async function btc(addr: string): Promise<Position[]> {
  const a = await firstOk([`https://mempool.space/api/address/${addr}`, `https://blockstream.info/api/address/${addr}`].map((u) => () => j(u)));
  const sats = BigInt(a.chain_stats.funded_txo_sum) - BigInt(a.chain_stats.spent_txo_sum);
  return [{ asset: "BTC", priceSymbol: "BTC", chain: "Bitcoin", kind: "native", quantity: fromBase(sats.toString(), 8) }];
}

// ---- TRON ---------------------------------------------------------------
async function tron(addr: string): Promise<Position[]> {
  return firstOk([
    async () => {
      const a = await j(`https://api.trongrid.io/v1/accounts/${addr}`);
      const acct = a.data?.[0];
      const out: Position[] = [{ asset: "TRX", priceSymbol: "TRX", chain: "TRON", kind: "native", quantity: fromBase(String(acct?.balance ?? 0), 6) }];
      for (const entry of acct?.trc20 ?? []) for (const [ca, bal] of Object.entries(entry as Record<string, string>)) {
        if (bal === "0") continue;
        out.push({ asset: ca.slice(0, 6) + "…", priceSymbol: `cg:tron:${ca}`, chain: "TRON", kind: "token", quantity: fromBase(bal, 6) });
      }
      return out;
    },
    async () => {
      const a = await j(`https://apilist.tronscanapi.com/api/accountv2?address=${addr}`);
      const out: Position[] = [{ asset: "TRX", priceSymbol: "TRX", chain: "TRON", kind: "native", quantity: fromBase(String(a.balance ?? 0), 6) }];
      for (const t of a.withPriceTokens ?? []) {
        if (t.tokenId === "_" || !t.balance || t.balance === "0") continue;
        out.push({ asset: String(t.tokenAbbr ?? t.tokenName ?? t.tokenId).slice(0, 12), priceSymbol: `cg:tron:${t.tokenId}`, chain: "TRON", kind: "token", quantity: fromBase(String(t.balance), Number(t.tokenDecimal ?? 6)) });
      }
      return out;
    },
  ]);
}

export async function fetchAllChains(fresh = false): Promise<ChainResult[]> {
  const key = "chains:v1";
  const now = Math.floor(Date.now() / 1000);
  if (!fresh) {
    const hit = await cache.get(key);
    if (hit && now - Number(hit.fetched_at) < 60) return JSON.parse(hit.value);
  }
  const results = await fetchAllChainsLive();
  if (results.some((r) => !r.error)) await cache.set(key, JSON.stringify(results), now);
  return results;
}

async function fetchAllChainsLive(): Promise<ChainResult[]> {
  const w = config.wallets;
  const tasks: [string, () => Promise<Position[]>][] = [];
  if (w.etc) tasks.push(["Ethereum Classic", () => evm("etc", w.etc)]);
  if (w.bsc) tasks.push(["BNB Chain", () => evm("bsc", w.bsc)]);
  if (w.eth) tasks.push(["Ethereum", () => evm("eth", w.eth)], ["Linea", () => evm("linea", w.eth)]);
  if (w.sol) tasks.push(["Solana", () => sol(w.sol)]);
  if (w.btc) tasks.push(["Bitcoin", () => btc(w.btc)]);
  if (w.trx) tasks.push(["TRON", () => tron(w.trx)]);
  return Promise.all(tasks.map(async ([chain, fn]) => {
    try { return { chain, positions: await fn(), error: null }; }
    catch (e) { return { chain, positions: [], error: (e as Error).message }; }
  }));
}
