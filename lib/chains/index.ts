import { config } from "@/config";
import { fromBase } from "../units";
import { cache } from "../db";
import { tokenPosition, MIMIC, SCAM, type Position } from "./token";
import { tokenMeta } from "./meta";

export type { Position };
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
const nativeRow = (c: Evm, key: string, base: string): Position => ({
  asset: c.native + (key === "linea" ? " (Linea)" : ""), priceSymbol: c.native,
  chain: c.chain, kind: "native", quantity: fromBase(base, 18), note: c.note,
});

// Legacy Etherscan-compatible dialect: ?module=account&action=balance | tokenlist.
async function scoutV1(c: Evm, key: string, addr: string): Promise<Position[]> {
  const b = await j(`${c.blockscout}?module=account&action=balance&address=${addr}`);
  if (b.status !== "1") throw new Error(b.message ?? "explorer error");
  const out = [nativeRow(c, key, b.result)];
  const t = await j(`${c.blockscout}?module=account&action=tokenlist&address=${addr}`).catch(() => ({ result: [] }));
  for (const tk of Array.isArray(t.result) ? t.result : []) {
    if (tk.type && !/ERC-20/i.test(String(tk.type))) continue;
    const p = tokenPosition({ chain: c.chain, platform: c.platform, contract: String(tk.contractAddress ?? ""), rawValue: String(tk.balance ?? "0"), symbol: tk.symbol, decimals: tk.decimals });
    if (p) out.push(p);
  }
  return out;
}

// Blockscout v2 REST: keyless, and on instances that have retired the legacy dialect it
// is the difference between token discovery and a native-only RPC read.
async function scoutV2(c: Evm, key: string, addr: string): Promise<Position[]> {
  const root = String(c.blockscout).replace(/\/api$/, "");
  const a = await j(`${root}/api/v2/addresses/${addr}`);
  if (a?.coin_balance == null) throw new Error("v2: no coin_balance");
  const out = [nativeRow(c, key, String(a.coin_balance))];
  const t = await j(`${root}/api/v2/addresses/${addr}/token-balances`).catch(() => null);
  // Some releases return a bare array, others paginate under items. Accept both.
  for (const it of Array.isArray(t) ? t : Array.isArray(t?.items) ? t.items : []) {
    const tok = it?.token ?? {};
    if (!/ERC-20/i.test(String(tok.type ?? "ERC-20"))) continue;
    const p = tokenPosition({ chain: c.chain, platform: c.platform, contract: String(tok.address ?? tok.address_hash ?? ""), rawValue: String(it?.value ?? "0"), symbol: tok.symbol, decimals: tok.decimals });
    if (p) out.push(p);
  }
  return out;
}

async function evm(key: keyof typeof EVM, addr: string): Promise<Position[]> {
  const c = EVM[key];
  const out: Position[] = [];
  let tokensDone = false;
  // Prefer Blockscout (native + token discovery); fall back to RPC (native only).
  // A Blockscout host speaks two dialects. The legacy Etherscan-compatible one is being
  // moved behind a paid key and newer instances serve only the keyless v2 REST API, so
  // try both before giving up on token discovery -- same provider, second way in.
  if (c.blockscout) {
    for (const read of [scoutV1, scoutV2]) {
      try { out.push(...(await read(c, key, addr))); tokensDone = true; break; }
      catch { /* try the next dialect, then RPC */ }
    }
  }
  if (!out.length) {
    const bal = await evmNativeRpc(c, addr);
    out.push({ asset: c.native + (key === "linea" ? " (Linea)" : ""), priceSymbol: c.native, chain: c.chain, kind: "native", quantity: fromBase(bal, 18), note: c.note });
  }
  if (key === "bsc" && !tokensDone) {
    const extra = (process.env.BSC_TOKENS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    for (const ca of [BSC_PEG_ETC, ...extra]) {
      const q = await evmTokenRpc(c, addr, ca).catch(() => 0n);
      if (q === 0n) continue;
      // The address is a guess until the contract confirms it, and the decimals were
      // previously assumed to be 18 for anything a user put in BSC_TOKENS. A token that
      // uses 8 was then reported ten billion times too small.
      const meta = await tokenMeta(c.rpcs, ca);
      if (!meta) continue;
      const peg = ca === BSC_PEG_ETC;
      const p = tokenPosition({
        chain: c.chain, platform: c.platform, contract: ca, rawValue: q.toString(),
        symbol: meta.symbol.replace(/^Binance-Peg\s*/i, "").trim() || meta.symbol,
        decimals: meta.decimals, kind: peg ? "bridged" : "token",
        note: peg ? "bridged claim on ETC, not the native coin" : undefined,
      });
      // A Binance-Peg claim tracks ETC's price; anything else is priced by contract.
      if (p) out.push(peg ? { ...p, priceSymbol: "ETC" } : p);
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
// TRX itself is always 6 decimals -- that is the chain's own unit, not a per-token guess.
const TRX_DECIMALS = 6;

async function tron(addr: string): Promise<Position[]> {
  return firstOk([
    // Tronscan goes first because it reports each token's own decimals and ticker.
    // TronGrid's account endpoint reports neither, and a TRC-20 balance scaled by an
    // assumed 6 is a guess that happens to be right for USDT and wrong for the rest.
    async () => {
      const a = await j(`https://apilist.tronscanapi.com/api/accountv2?address=${addr}`);
      const out: Position[] = [{ asset: "TRX", priceSymbol: "TRX", chain: "TRON", kind: "native", quantity: fromBase(String(a.balance ?? 0), TRX_DECIMALS) }];
      for (const t of a.withPriceTokens ?? []) {
        if (t.tokenId === "_" || !t.balance || t.balance === "0") continue;
        const decimals = Number(t.tokenDecimal);
        if (!Number.isInteger(decimals)) continue;   // unknown scale: skip, never assume
        const sym = String(t.tokenAbbr ?? t.tokenName ?? t.tokenId).slice(0, 12);
        const mimic = MIMIC.test(sym.trim());
        out.push({
          asset: mimic ? `"${sym}" (token, NOT native ${sym.toUpperCase()})` : sym,
          priceSymbol: `cg:tron:${t.tokenId}`, chain: "TRON", kind: "token",
          quantity: fromBase(String(t.balance), decimals), note: mimic ? SCAM : undefined,
        });
      }
      return out;
    },
    // Fallback: native TRX only. TronGrid answers when Tronscan does not, but it cannot
    // say what scale a token uses, and a balance at the wrong scale looks exactly like a
    // real one. Showing TRX and saying so beats showing a number that might be wrong.
    async () => {
      const a = await j(`https://api.trongrid.io/v1/accounts/${addr}`);
      const acct = a.data?.[0];
      const held = (acct?.trc20 ?? []).flatMap((e: Record<string, string>) => Object.values(e)).filter((b: string) => b && b !== "0").length;
      return [{
        asset: "TRX", priceSymbol: "TRX", chain: "TRON", kind: "native",
        quantity: fromBase(String(acct?.balance ?? 0), TRX_DECIMALS),
        note: held ? `${held} TRC-20 balance${held === 1 ? "" : "s"} not shown: the fallback provider does not report token decimals` : undefined,
      }];
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
