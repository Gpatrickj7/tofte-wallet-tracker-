// Ledger math, run with plain node: `npm test`. No database, no browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLedger, byAsset, compare, composition, monthly, rangeOf, change, sym } from "../lib/ledger.ts";

const purchases = [
  { id: "p1", date: "2026-01-10", asset: "btc", quantity: "0.01", usd_total: "900", fees: "9", rail: "Kraken", notes: null, created_at: 1 },
  { id: "p2", date: "2026-02-03", asset: "ETH", quantity: "0.5", usd_total: "1500", fees: "0", rail: "Cash App", notes: "dip", created_at: 2 },
  { id: "p3", date: "2026-01-10", asset: "BTC", quantity: "0.02", usd_total: "1800", fees: "18", rail: "Kraken", notes: null, created_at: 0 },
];
const payouts = [
  { id: "0xaaa", ts: Date.UTC(2026, 0, 20) / 1000, asset: "ETC", amount_base: "125000000", decimals: 9, usd_value: "2.5", source: "chain" },
  { id: "0xbbb", ts: Date.UTC(2026, 1, 15) / 1000, asset: "ETC", amount_base: "100000000", decimals: 9, usd_value: null },
];

test("sym normalizes the symbol and drops chain suffixes", () => {
  assert.equal(sym("btc"), "BTC");
  assert.equal(sym("ETH (Linea)"), "ETH");
  assert.equal(sym("  sol "), "SOL");
});

test("buildLedger merges both sources oldest first with ties by creation order", () => {
  const l = buildLedger(purchases, payouts);
  assert.deepEqual(l.map((e) => e.ref), ["p3", "p1", "0xaaa", "p2", "0xbbb"]);
  const mined = l.find((e) => e.ref === "0xaaa");
  assert.equal(mined.kind, "mining");
  assert.equal(mined.qty, 0.125);
  assert.equal(mined.usd, 2.5);
  assert.equal(mined.date, "2026-01-20");
  const unpriced = l.find((e) => e.ref === "0xbbb");
  assert.equal(unpriced.usd, 0);
  assert.equal(unpriced.note, "unpriced");
});

test("byAsset sums units, dollars, and fees per symbol, largest first", () => {
  const a = byAsset(buildLedger(purchases, payouts));
  assert.deepEqual(a.map((s) => s.asset), ["BTC", "ETH", "ETC"]);
  const btc = a[0];
  assert.equal(btc.qty, 0.03);
  assert.equal(btc.usd, 2700);
  assert.equal(btc.fees, 27);
  assert.equal(btc.count, 2);
  assert.equal(btc.first, "2026-01-10");
  const etc = a[2];
  assert.equal(etc.mined, 2.5);
  assert.equal(etc.purchased, 0);
});

test("compare puts basis against value now and keeps unmatched holdings", () => {
  const rows = compare(byAsset(buildLedger(purchases, payouts)), [
    { asset: "BTC", qty: 0.03, value: 3000 },
    { asset: "ETH (Linea)", qty: 0.1, value: 200 },
    { asset: "ETH", qty: 0.4, value: 800 },
    { asset: "SOL", qty: 2, value: 300 },
  ]);
  const btc = rows.find((r) => r.asset === "BTC");
  assert.equal(btc.usdIn, 2727);          // fees count toward basis
  assert.equal(btc.pnl, 273);
  assert.ok(Math.abs(btc.pnlPct - 10.01) < 0.01);
  const eth = rows.find((r) => r.asset === "ETH");
  assert.equal(eth.qtyNow, 0.5);          // both ETH lines merged
  assert.equal(eth.valueNow, 1000);
  assert.equal(eth.pnl, -500);
  const sol = rows.find((r) => r.asset === "SOL");
  assert.equal(sol.usdIn, 0);
  assert.equal(sol.pnlPct, null);         // held, never logged: no basis to compare
  const etc = rows.find((r) => r.asset === "ETC");
  assert.equal(etc.valueNow, 0);          // in the ledger, not in a wallet
  assert.equal(rows[0].asset, "BTC");     // sorted by value now
});

test("monthly splits dollars in by kind and keeps the last N months", () => {
  const m = monthly(buildLedger(purchases, payouts));
  assert.deepEqual(m, [
    { label: "2026-01", purchased: 2700, mined: 2.5 },
    { label: "2026-02", purchased: 1500, mined: 0 },
  ]);
  assert.equal(monthly(buildLedger(purchases, payouts), 1).length, 1);
});

test("composition ranks by the latest day, folds the tail into Other, and skips v1 rows", () => {
  const snaps = [
    { day: "2026-03-01", total: 100 },   // v1 row without positions
    { day: "2026-03-02", total: 100, positions: [{ asset: "A", value: 50 }, { asset: "B", value: 30 }, { asset: "C", value: 20 }, { asset: "D", value: 0 }] },
    { day: "2026-03-03", total: 120, positions: [{ asset: "B", value: 60 }, { asset: "A", value: 40 }, { asset: "C", value: 10 }, { asset: "D", value: 10 }] },
  ];
  const c = composition(snaps, 2);
  assert.deepEqual(c.labels, ["2026-03-02", "2026-03-03"]);
  assert.deepEqual(c.series.map((s) => s.name), ["B", "A", "Other"]);
  assert.deepEqual(c.series[2].values, [20, 20]);
  assert.deepEqual(composition(snaps.slice(0, 2)).series, []);
});

const swap = (over) => ({ id: "s1", date: "2026-03-01", from_asset: "btc", from_qty: "0.01", to_asset: "sol", to_qty: "5", usd_value: "1000", fees: "0", venue: "Jupiter", notes: null, created_at: 9, ...over });

test("a swap moves average-cost basis out of one asset and into another", () => {
  // BTC basis before the swap: 2727 across 0.03 units, so 909 per 0.01.
  const a = byAsset(buildLedger(purchases, [], [swap()]));
  const btc = a.find((s) => s.asset === "BTC"), sol = a.find((s) => s.asset === "SOL");
  assert.ok(Math.abs(btc.qty - 0.02) < 1e-12);
  assert.ok(Math.abs(btc.usd + btc.fees - 1818) < 1e-9);
  assert.ok(Math.abs(btc.fees - 18) < 1e-9);              // fees leave proportionally
  assert.equal(btc.swappedOut, 1000);
  assert.ok(Math.abs(btc.realized - 91) < 1e-9);          // 1000 received minus 909 of basis
  assert.equal(sol.qty, 5);
  assert.equal(sol.usd, 1000);                            // arrives at the swap's dollar value
  assert.equal(sol.swappedIn, 1000);
  assert.equal(sol.purchased, 0);
});

test("a swap out of an asset with no basis realizes the whole value", () => {
  const unpriced = [{ id: "0xccc", ts: Date.UTC(2026, 1, 1) / 1000, asset: "ETC", amount_base: "2000000000", decimals: 9, usd_value: null }];
  const a = byAsset(buildLedger([], unpriced, [swap({ from_asset: "ETC", from_qty: "2", to_asset: "SOL", to_qty: "1", usd_value: "40" })]));
  const etc = a.find((s) => s.asset === "ETC");
  assert.equal(etc.qty, 0);
  assert.equal(etc.realized, 40);
});

test("a swap of more than is held cannot drive units or basis negative", () => {
  const a = byAsset(buildLedger(purchases, [], [swap({ from_qty: "1" })]));
  const btc = a.find((s) => s.asset === "BTC");
  assert.equal(btc.qty, 0);
  assert.ok(Math.abs(btc.usd + btc.fees) < 1e-9);
  assert.ok(Math.abs(btc.realized - (1000 - 2727)) < 1e-9);
});

test("swaps are ordered with the day's events, are not dollars in, and reach compare", () => {
  const l = buildLedger(purchases, payouts, [swap({ date: "2026-01-10", created_at: 5 })]);
  assert.deepEqual(l.map((e) => e.ref), ["p3", "p1", "s1", "0xaaa", "p2", "0xbbb"]);
  assert.deepEqual(l[2].from, { asset: "BTC", qty: 0.01 });
  assert.deepEqual(monthly(l).map((m) => m.purchased), [2700, 1500]);
  const rows = compare(byAsset(l), [{ asset: "SOL", qty: 5, value: 1200 }]);
  const sol = rows.find((r) => r.asset === "SOL");
  assert.equal(sol.usdIn, 1000);
  assert.equal(sol.pnl, 200);
  assert.equal(rows.find((r) => r.asset === "BTC").realized, 91);
});

test("rangeOf anchors on the last day and change reports the span", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ day: `2026-04-${String(i + 1).padStart(2, "0")}`, value: 100 + i * 10 }));
  assert.equal(rangeOf(rows, null).length, 10);
  assert.deepEqual(rangeOf(rows, 3).map((r) => r.day), ["2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10"]);
  const c = change(rows);
  assert.equal(c.abs, 90);
  assert.equal(c.pct, 90);
  assert.equal(c.days, 9);
  assert.deepEqual(change([]), { abs: 0, pct: null, days: 0 });
});
