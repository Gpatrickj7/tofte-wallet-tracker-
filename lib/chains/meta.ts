// Asking a contract what it is, instead of trusting a table.
//
// A contract address written into source from memory or copied from a forum is a guess.
// A wrong one that happens to point at a real token returns a real balance under the
// wrong name, which is worse than no balance at all. Every ERC-20 answers symbol() and
// decimals() for free, so ask.
import { cache } from "../db";

const TIMEOUT = 6000;
const TTL = 30 * 24 * 3600;

export type TokenMeta = { symbol: string; decimals: number };

// Without a database there is nowhere to remember an answer between requests, and the
// README is clear that holdings work without one. A process-local memo keeps a keyless
// deployment from re-asking the same contract on every page load.
const memo = new Map<string, TokenMeta | null>();

async function call(url: string, method: string, params: unknown[]): Promise<string | null> {
  try {
    const r = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store", signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.error ? null : (j.result as string);
  } catch { return null; }
}

async function firstResult(rpcs: string[], params: unknown[]): Promise<string | null> {
  for (const u of rpcs) { const v = await call(u, "eth_call", params); if (v != null) return v; }
  return null;
}

// symbol() is usually an ABI dynamic string. Tokens deployed before that convention
// settled return a raw bytes32 instead. Anything that is neither must decode to nothing:
// a plausible-looking ticker invented from garbage is the exact failure being avoided.
export function decodeSymbol(hex: string): string | null {
  if (!hex || hex === "0x") return null;
  const body = hex.slice(2);
  const ascii = (h: string) =>
    h.replace(/(00)+$/, "").match(/.{2}/g)?.map((b) => String.fromCharCode(parseInt(b, 16))).join("") ?? "";
  const clean = (s: string) => (/^[\x20-\x7e]{1,32}$/.test(s) ? s : null);
  if (body.length === 64) return clean(ascii(body).trim());
  try {
    const off = parseInt(body.slice(0, 64), 16) * 2;
    const len = parseInt(body.slice(off, off + 64), 16) * 2;
    if (!Number.isFinite(len) || len <= 0 || len > 128) return null;
    return clean(ascii(body.slice(off + 64, off + 64 + len)).trim());
  } catch { return null; }
}

/**
 * Read symbol() and decimals() off a contract.
 *
 * Returns null when the address is not a responsive ERC-20 -- which is exactly what a
 * mistyped or stale address looks like from the outside, so the caller can drop the row
 * rather than invent a holding.
 */
export async function tokenMeta(rpcs: string[], contract: string): Promise<TokenMeta | null> {
  const key = contract.toLowerCase();
  if (memo.has(key)) return memo.get(key)!;

  const now = Math.floor(Date.now() / 1000);
  const hit = await cache.get("tokenmeta:" + key);
  if (hit && now - Number(hit.fetched_at) < TTL) {
    const v = hit.value ? (JSON.parse(hit.value) as TokenMeta) : null;
    memo.set(key, v);
    return v;
  }

  const [symRaw, decRaw] = await Promise.all([
    firstResult(rpcs, [{ to: contract, data: "0x95d89b41" }, "latest"]),  // symbol()
    firstResult(rpcs, [{ to: contract, data: "0x313ce567" }, "latest"]),  // decimals()
  ]);
  const symbol = symRaw ? decodeSymbol(symRaw) : null;
  const decimals = decRaw && decRaw !== "0x" ? parseInt(decRaw, 16) : NaN;
  const meta =
    symbol != null && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36
      ? { symbol, decimals }
      : null;

  memo.set(key, meta);
  await cache.set("tokenmeta:" + key, meta ? JSON.stringify(meta) : "", now);
  return meta;
}
