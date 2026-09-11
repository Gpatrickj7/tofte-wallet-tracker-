// Pure ledger math. No database, no framework, no imports, so the page, the
// CSV export, the demo, and the unit tests all run the same code.
//
// The ledger is every event that put value into the portfolio: a purchase
// you logged, or a mining payout that landed on chain. Each carries the
// dollars it cost or was worth at the time. Summed per asset, that is the
// cost basis; against the current value of what the tracked wallets hold,
// that is the unrealized gain or loss.

export type LedgerEvent = {
  ts: number;                 // unix seconds
  seq: number;                // tie-break within a day
  date: string;               // YYYY-MM-DD, UTC
  kind: "purchase" | "mining";
  asset: string;              // upper-case symbol
  qty: number;
  usd: number;                // dollars in: purchase total, or income at receipt
  fees: number;
  via: string;                // rail or pool
  note: string | null;
  ref: string;                // purchase id or tx hash
};

export type PurchaseLike = { id: string; date: string; asset: string; quantity: string; usd_total: string; fees: string; rail: string; notes: string | null; created_at: number };
export type PayoutLike = { id: string; ts: number; asset: string; amount_base: string; decimals: number; usd_value: string | null; source?: string };

/** "ETH (Linea)" and "eth" both become "ETH", so a purchase matches a holding. */
export const sym = (asset: string) => asset.trim().split(" ")[0].toUpperCase();

function fromBase(amount: string, decimals: number): number {
  const s = amount.padStart(decimals + 1, "0");
  return Number(s.slice(0, s.length - decimals) + "." + s.slice(s.length - decimals));
}
const num = (s: string | number | null | undefined) => { const n = Number(s); return Number.isFinite(n) ? n : 0; };

export function buildLedger(purchases: PurchaseLike[], payouts: PayoutLike[]): LedgerEvent[] {
  const p: LedgerEvent[] = purchases.map((r) => ({
    ts: Math.floor(Date.parse(r.date + "T00:00:00Z") / 1000) || r.created_at,
    seq: r.created_at, date: r.date, kind: "purchase", asset: sym(r.asset),
    qty: num(r.quantity), usd: num(r.usd_total), fees: num(r.fees), via: r.rail, note: r.notes, ref: r.id,
  }));
  const m: LedgerEvent[] = payouts.map((r) => ({
    ts: r.ts, seq: r.ts, date: new Date(r.ts * 1000).toISOString().slice(0, 10), kind: "mining", asset: sym(r.asset),
    qty: fromBase(r.amount_base, r.decimals), usd: r.usd_value == null ? 0 : num(r.usd_value), fees: 0,
    via: r.source ?? "pool", note: r.usd_value == null ? "unpriced" : null, ref: r.id,
  }));
  return [...p, ...m].sort((a, b) => a.ts - b.ts || a.seq - b.seq || a.ref.localeCompare(b.ref));
}

export type AssetSummary = { asset: string; qty: number; usd: number; fees: number; purchased: number; mined: number; count: number; first: string; last: string };

/** Dollars in and units in, per asset, largest first. */
export function byAsset(events: LedgerEvent[]): AssetSummary[] {
  const m = new Map<string, AssetSummary>();
  for (const e of events) {
    const s = m.get(e.asset) ?? { asset: e.asset, qty: 0, usd: 0, fees: 0, purchased: 0, mined: 0, count: 0, first: e.date, last: e.date };
    s.qty += e.qty; s.usd += e.usd; s.fees += e.fees; s.count += 1;
    if (e.kind === "purchase") s.purchased += e.usd; else s.mined += e.usd;
    if (e.date < s.first) s.first = e.date;
    if (e.date > s.last) s.last = e.date;
    m.set(e.asset, s);
  }
  return [...m.values()].sort((a, b) => b.usd - a.usd || a.asset.localeCompare(b.asset));
}

export type Holding = { asset: string; qty: number; value: number };
export type Comparison = { asset: string; qtyIn: number; usdIn: number; qtyNow: number; valueNow: number; pnl: number; pnlPct: number | null };

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
    out.push({ asset: s.asset, qtyIn: s.qty, usdIn: basis, qtyNow: c.qty, valueNow: c.value, pnl: c.value - basis, pnlPct: basis > 0 ? ((c.value - basis) / basis) * 100 : null });
  }
  for (const [asset, c] of cur) out.push({ asset, qtyIn: 0, usdIn: 0, qtyNow: c.qty, valueNow: c.value, pnl: c.value, pnlPct: null });
  return out.sort((a, b) => b.valueNow - a.valueNow || b.usdIn - a.usdIn || a.asset.localeCompare(b.asset));
}

export type MonthRow = { label: string; purchased: number; mined: number };

/** Dollars in by calendar month, split by kind. Last `keep` months present. */
export function monthly(events: LedgerEvent[], keep = 24): MonthRow[] {
  const m = new Map<string, MonthRow>();
  for (const e of events) {
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
