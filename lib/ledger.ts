// Pure ledger math. No database, no framework, no imports, so the page, the
// CSV export, the demo, and the unit tests all run the same code.
//
// The ledger is every event that changed what the portfolio holds:
//
//   purchase  dollars out, units in
//   mining    units in, valued in dollars at the moment they arrived
//   swap      units of one asset out, units of another in, at a dollar value
//
// Purchases and mining are "dollars in": new money or new value entering the
// book. A swap is not; it moves value from one asset to another. Its basis
// accounting is average cost: the units given up leave at their average
// cost, the difference between that and the swap's dollar value is realized,
// and the units received arrive with the swap's dollar value as their basis.
// That is the same treatment most tax regimes apply to a crypto-to-crypto
// trade, and it is the only one that keeps "basis" meaning what it says.

export type Kind = "purchase" | "mining" | "swap";

export type LedgerEvent = {
  ts: number;                 // unix seconds
  seq: number;                // tie-break within a day
  date: string;               // YYYY-MM-DD, UTC
  kind: Kind;
  asset: string;              // upper-case symbol; for a swap, the asset received
  qty: number;                // units in; for a swap, units received
  usd: number;                // purchase total, income at receipt, or swap value
  fees: number;
  via: string;                // rail, pool, or venue
  note: string | null;
  ref: string;                // purchase id, tx hash, or swap id
  from?: { asset: string; qty: number };   // swap only: what was given up
};

export type PurchaseLike = { id: string; date: string; asset: string; quantity: string; usd_total: string; fees: string; rail: string; notes: string | null; created_at: number };
export type PayoutLike = { id: string; ts: number; asset: string; amount_base: string; decimals: number; usd_value: string | null; source?: string };
export type SwapLike = { id: string; date: string; from_asset: string; from_qty: string; to_asset: string; to_qty: string; usd_value: string; fees: string; venue: string; notes: string | null; created_at: number };

/** "ETH (Linea)" and "eth" both become "ETH", so a purchase matches a holding. */
export const sym = (asset: string) => asset.trim().split(" ")[0].toUpperCase();

function fromBase(amount: string, decimals: number): number {
  const s = amount.padStart(decimals + 1, "0");
  return Number(s.slice(0, s.length - decimals) + "." + s.slice(s.length - decimals));
}
const num = (s: string | number | null | undefined) => { const n = Number(s); return Number.isFinite(n) ? n : 0; };
const dayTs = (date: string) => Math.floor(Date.parse(date + "T00:00:00Z") / 1000);

export function buildLedger(purchases: PurchaseLike[], payouts: PayoutLike[], swaps: SwapLike[] = []): LedgerEvent[] {
  const p: LedgerEvent[] = purchases.map((r) => ({
    ts: dayTs(r.date) || r.created_at,
    seq: r.created_at, date: r.date, kind: "purchase", asset: sym(r.asset),
    qty: num(r.quantity), usd: num(r.usd_total), fees: num(r.fees), via: r.rail, note: r.notes, ref: r.id,
  }));
  const m: LedgerEvent[] = payouts.map((r) => ({
    ts: r.ts, seq: r.ts, date: new Date(r.ts * 1000).toISOString().slice(0, 10), kind: "mining", asset: sym(r.asset),
    qty: fromBase(r.amount_base, r.decimals), usd: r.usd_value == null ? 0 : num(r.usd_value), fees: 0,
    via: r.source ?? "pool", note: r.usd_value == null ? "unpriced" : null, ref: r.id,
  }));
  const s: LedgerEvent[] = swaps.map((r) => ({
    ts: dayTs(r.date) || r.created_at,
    seq: r.created_at, date: r.date, kind: "swap", asset: sym(r.to_asset),
    qty: num(r.to_qty), usd: num(r.usd_value), fees: num(r.fees), via: r.venue, note: r.notes, ref: r.id,
    from: { asset: sym(r.from_asset), qty: num(r.from_qty) },
  }));
  return [...p, ...m, ...s].sort((a, b) => a.ts - b.ts || a.seq - b.seq || a.ref.localeCompare(b.ref));
}

export type AssetSummary = {
  asset: string;
  qty: number;        // units currently attributable to the ledger
  usd: number;        // basis, excluding fees
  fees: number;       // basis, fees part
  purchased: number;  // dollars in by purchase
  mined: number;      // dollars in by mining
  swappedIn: number;  // value received by swap
  swappedOut: number; // value given up by swap
  realized: number;   // swap value minus the basis that left with it
  count: number;
  first: string;
  last: string;
};

/** Units and basis per asset after every event, largest basis first.
 *  Events must be chronological, which buildLedger guarantees, because a
 *  swap's average cost depends on what was held at that moment. */
export function byAsset(events: LedgerEvent[]): AssetSummary[] {
  const m = new Map<string, AssetSummary>();
  const get = (asset: string, date: string) => {
    let s = m.get(asset);
    if (!s) { s = { asset, qty: 0, usd: 0, fees: 0, purchased: 0, mined: 0, swappedIn: 0, swappedOut: 0, realized: 0, count: 0, first: date, last: date }; m.set(asset, s); }
    if (date < s.first) s.first = date;
    if (date > s.last) s.last = date;
    s.count += 1;
    return s;
  };
  for (const e of events) {
    if (e.kind === "swap" && e.from) {
      const f = get(e.from.asset, e.date);
      // The units given up take their average cost with them, capped at
      // what is actually held so a swap of untracked coins cannot drive
      // the basis negative.
      const basis = f.usd + f.fees;
      const units = Math.min(e.from.qty, f.qty);
      const removed = f.qty > 0 ? Math.min(basis, (basis / f.qty) * units) : 0;
      const share = basis > 0 ? removed / basis : 0;
      f.usd -= f.usd * share;
      f.fees -= f.fees * share;
      f.qty = Math.max(0, f.qty - e.from.qty);
      f.swappedOut += e.usd;
      f.realized += e.usd - removed;
      const t = get(e.asset, e.date);
      t.qty += e.qty; t.usd += e.usd; t.fees += e.fees; t.swappedIn += e.usd;
      continue;
    }
    const s = get(e.asset, e.date);
    s.qty += e.qty; s.usd += e.usd; s.fees += e.fees;
    if (e.kind === "purchase") s.purchased += e.usd; else s.mined += e.usd;
  }
  return [...m.values()].sort((a, b) => (b.usd + b.fees) - (a.usd + a.fees) || a.asset.localeCompare(b.asset));
}

export type Holding = { asset: string; qty: number; value: number };
export type Comparison = { asset: string; qtyIn: number; usdIn: number; qtyNow: number; valueNow: number; pnl: number; pnlPct: number | null; realized: number };

/** Basis against what the wallets hold now. Assets with no basis still
 *  appear (pnlPct null) so nothing held is silently left out. */
export function compare(summaries: AssetSummary[], now: Holding[]): Comparison[] {
  const cur = new Map<string, { qty: number; value: number }>();
  for (const h of now) { const k = sym(h.asset); const c = cur.get(k) ?? { qty: 0, value: 0 }; c.qty += h.qty; c.value += h.value; cur.set(k, c); }
  const out: Comparison[] = [];
  for (const s of summaries) {
    const c = cur.get(s.asset) ?? { qty: 0, value: 0 };
    cur.delete(s.asset);
    const basis = s.usd + s.fees;
    out.push({ asset: s.asset, qtyIn: s.qty, usdIn: basis, qtyNow: c.qty, valueNow: c.value, pnl: c.value - basis, pnlPct: basis > 0 ? ((c.value - basis) / basis) * 100 : null, realized: s.realized });
  }
  for (const [asset, c] of cur) out.push({ asset, qtyIn: 0, usdIn: 0, qtyNow: c.qty, valueNow: c.value, pnl: c.value, pnlPct: null, realized: 0 });
  return out.sort((a, b) => b.valueNow - a.valueNow || b.usdIn - a.usdIn || a.asset.localeCompare(b.asset));
}

export type MonthRow = { label: string; purchased: number; mined: number };

/** Dollars in by calendar month, split by kind. Swaps are not dollars in
 *  and are left out. Last `keep` months present. */
export function monthly(events: LedgerEvent[], keep = 24): MonthRow[] {
  const m = new Map<string, MonthRow>();
  for (const e of events) {
    if (e.kind === "swap") continue;
    const k = e.date.slice(0, 7);
    const r = m.get(k) ?? { label: k, purchased: 0, mined: 0 };
    if (e.kind === "purchase") r.purchased += e.usd; else r.mined += e.usd;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label)).slice(-keep);
}

export type SnapLike = { day: string; total: number; positions?: { asset: string; value: number }[] };
export type Series = { name: string; values: number[] };

/** Value per asset per day, for the composition chart. Ranked by the
 *  latest day; past `max` assets the rest fold into Other so no ninth
 *  color is ever needed. Days without position detail are skipped. */
export function composition(snaps: SnapLike[], max = 7): { labels: string[]; series: Series[] } {
  const days = snaps.filter((s) => Array.isArray(s.positions) && s.positions.length);
  if (days.length < 2) return { labels: [], series: [] };
  const perDay = days.map((d) => { const m = new Map<string, number>(); for (const p of d.positions!) m.set(sym(p.asset), (m.get(sym(p.asset)) ?? 0) + Math.max(0, p.value)); return m; });
  const latest = perDay[perDay.length - 1];
  const ranked = [...latest].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  // Assets held earlier but gone today still need a home: they rank after today's.
  for (const m of perDay) for (const k of m.keys()) if (!ranked.includes(k)) ranked.push(k);
  const top = ranked.slice(0, max), rest = new Set(ranked.slice(max));
  const series: Series[] = top.map((name) => ({ name, values: perDay.map((m) => m.get(name) ?? 0) }));
  if (rest.size) series.push({ name: "Other", values: perDay.map((m) => [...m].filter(([k]) => rest.has(k)).reduce((s, [, v]) => s + v, 0)) });
  return { labels: days.map((d) => d.day), series: series.filter((s) => s.values.some((v) => v > 0)) };
}

/** The trailing `days` of a day-keyed series, anchored on its last day
 *  rather than today so a stale or sample history still slices sensibly.
 *  null means everything. */
export function rangeOf<T extends { day: string }>(rows: T[], days: number | null): T[] {
  if (days == null || !rows.length) return rows;
  const last = Date.parse(rows[rows.length - 1].day + "T00:00:00Z");
  const from = new Date(last - days * 86400000).toISOString().slice(0, 10);
  return rows.filter((r) => r.day >= from);
}

/** First to last: absolute and percent change, and the span in days. */
export function change(rows: { day: string; value: number }[]): { abs: number; pct: number | null; days: number } {
  if (rows.length < 2) return { abs: 0, pct: null, days: 0 };
  const a = rows[0], b = rows[rows.length - 1];
  const abs = b.value - a.value;
  const days = Math.round((Date.parse(b.day + "T00:00:00Z") - Date.parse(a.day + "T00:00:00Z")) / 86400000);
  return { abs, pct: a.value > 0 ? (abs / a.value) * 100 : null, days };
}
