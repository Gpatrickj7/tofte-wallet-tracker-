// Turning a raw on-chain balance into a position, without guessing.
//
// Imports nothing, like ledger.ts, so the app and the unit tests run the same code.
//
// The rule here is that a quantity is only as trustworthy as the decimals used to scale
// it. Most ERC-20s use 18 and some use 8, and the difference between those two is a
// factor of ten billion -- not a rounding error, a different number entirely. So an
// unknown decimals count is never filled in with 18. The row is skipped and the caller
// is expected to have asked the contract first.

// Base-unit integer string -> decimal string. Kept local, like the one in ledger.ts, so
// this module imports nothing and the app and the tests run the same code. No floats:
// a token balance can exceed what a double represents exactly.
function fromBase(amount: string, decimals: number): string {
  const s = amount.padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return int + (frac ? "." + frac : "");
}

export type Position = {
  asset: string; priceSymbol: string; chain: string;
  kind: "native" | "token" | "bridged" | "wrapped";
  quantity: string; note?: string;
};

// A token is free to name itself after a chain's native coin, and scam airdrops do
// exactly that, because a row reading "ETC" next to a real balance is the whole trick.
export const MIMIC = /^(ETC|ETH|BTC|BNB|SOL|USDT|USDC|TRX)$/i;
export const SCAM =
  "token contract impersonating a native coin. Almost certainly a scam airdrop. Do not visit any URL in its name or sign anything to 'claim' it.";

export type TokenInput = {
  chain: string;
  platform: string;       // CoinGecko platform id, for pricing by contract address
  contract: string;
  rawValue: string;       // base units, as the chain reported them
  symbol?: string | null;
  // Explorers report decimals as a number in one dialect and a string in another, so
  // both are accepted -- but only those two. Coercing anything else is how a missing
  // value becomes a confident zero.
  decimals?: number | string | null;
  kind?: Position["kind"]; // "bridged" for a wrapped claim on another chain's coin
  note?: string;
};

const isAddress = (s: string) => /^0x[0-9a-f]{40}$/.test(s);

/**
 * Build one token position, or null if it should not be shown.
 *
 * Returns null when the balance is zero, the contract address is malformed, or the
 * decimals are unknown. That last case is deliberate: a balance shown at the wrong scale
 * is worse than a balance not shown, because it looks exactly like a real one.
 */
export function tokenPosition(t: TokenInput): Position | null {
  const contract = t.contract.toLowerCase();
  if (!isAddress(contract)) return null;
  if (!t.rawValue || !/^\d+$/.test(t.rawValue) || t.rawValue === "0") return null;

  // Number(null) is 0, not NaN, so a missing decimals count would otherwise scale the
  // balance by 10^0 and print the raw base-unit integer as the quantity. Parse strictly.
  const decimals =
    typeof t.decimals === "number" ? t.decimals
    : typeof t.decimals === "string" && /^\d{1,2}$/.test(t.decimals.trim()) ? Number(t.decimals.trim())
    : NaN;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;

  const symbol = String(t.symbol ?? "").trim();
  // No symbol anywhere means the contract would not say and the explorer did not know.
  // A truncated address is an honest placeholder; a made-up ticker would not be.
  const label = symbol || contract.slice(0, 8) + "…";
  const mimic = !!symbol && MIMIC.test(symbol);
  const kind = t.kind ?? "token";

  return {
    asset: mimic ? `"${symbol}" (token, NOT native ${symbol.toUpperCase()})` : label,
    priceSymbol: `cg:${t.platform}:${contract}`,
    chain: t.chain,
    kind,
    quantity: fromBase(t.rawValue, decimals),
    note: mimic ? SCAM : t.note,
  };
}
