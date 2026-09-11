import { revalidatePath } from "next/cache";
import { fetchAllChains } from "@/lib/chains";
import { spotPrices } from "@/lib/prices";
import { payouts, purchases, snapshots, swaps, type Payout, type Purchase, type Snapshot, type Swap } from "@/lib/db";
import { buildLedger, byAsset, compare, composition, monthly, type Holding } from "@/lib/ledger";
import { fmtQty, fmtUsd } from "@/lib/units";
import { HBars, Paired, RangeLine, StackedArea } from "@/lib/charts";
import { config } from "@/config";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const pct = (n: number | null) => (n == null ? "" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`);
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${fmtUsd(Math.abs(n))}`;
const qty = (n: number) => fmtQty(n.toFixed(8).replace(/\.?0+$/, ""));

async function addSwap(fd: FormData) {
  "use server";
  const g = (k: string) => String(fd.get(k) ?? "").trim();
  if (!g("date") || !g("from_asset") || !g("from_qty") || !g("to_asset") || !g("to_qty") || !g("usd_value") || !g("venue")) return;
  await swaps.insert({
    date: g("date"), from_asset: g("from_asset").toUpperCase(), from_qty: g("from_qty"), to_asset: g("to_asset").toUpperCase(), to_qty: g("to_qty"),
    usd_value: g("usd_value"), fees: g("fees") || "0", venue: g("venue"), notes: g("notes") || null, created_at: Math.floor(Date.now() / 1000),
  });
  revalidatePath("/ledger");
}

export default async function Ledger() {
  if (!process.env.MONGODB_URI) return <NeedsStorage />;

  let ps: Purchase[] = [], ms: Payout[] = [], ss: Swap[] = [], snaps: Snapshot[] = [];
  let dbError: string | null = null;
  try { [ps, ms, ss, snaps] = await Promise.all([purchases.list(), payouts.list(), swaps.list(), snapshots.list()]); }
  catch (e) { dbError = (e as Error).message; }

  const events = buildLedger(ps, ms, ss);
  const assets = byAsset(events);

  // What the tracked wallets hold right now, priced. Only assets that are
  // both in the ledger and in a wallet get a gain or loss; the rest are
  // listed so nothing is silently dropped.
  let now: Holding[] = [];
  let priceError: string | null = null;
  if (Object.values(config.wallets).some(Boolean)) {
    try {
      const chains = await fetchAllChains(false);
      const positions = chains.flatMap((c) => c.positions).filter((p) => p.quantity !== "0" && !(p.kind === "token" && p.note));
      const { prices, error } = await spotPrices(positions.map((p) => p.priceSymbol));
      priceError = error;
      now = positions.filter((p) => prices[p.priceSymbol] != null).map((p) => ({ asset: p.asset, qty: Number(p.quantity), value: Number(p.quantity) * prices[p.priceSymbol] }));
    } catch (e) { priceError = (e as Error).message; }
  }
  const rows = compare(assets, now);

  // Dollars in is new money or new value: purchases and mining. Swaps move
  // value between assets and are not counted here.
  const inflows = events.filter((e) => e.kind !== "swap");
  const dollarsIn = inflows.reduce((s, e) => s + e.usd + e.fees, 0);
  const purchased = inflows.filter((e) => e.kind === "purchase").reduce((s, e) => s + e.usd, 0);
  const mined = inflows.filter((e) => e.kind === "mining").reduce((s, e) => s + e.usd, 0);
  const basis = rows.reduce((s, r) => s + r.usdIn, 0);
  const realized = assets.reduce((s, a) => s + a.realized, 0);
  const swapCount = events.filter((e) => e.kind === "swap").length;
  const valueNow = rows.reduce((s, r) => s + r.valueNow, 0);
  const pnl = valueNow - basis;
  const months = monthly(events).map((m) => ({ label: m.label, a: m.purchased, b: m.mined }));
  const comp = composition(snaps);
  const history = snaps.map((s) => ({ day: s.day, value: s.total }));
  const withBasis = rows.filter((r) => r.usdIn > 0);
  const newest = [...events].reverse();

  return (
    <>
      <div className="flex items-baseline justify-between mb-4">
        <h1>Ledger</h1>
        <div className="text-xs muted">{events.length} events · {assets.length} asset{assets.length === 1 ? "" : "s"} · {snaps.length} day{snaps.length === 1 ? "" : "s"} of history · <a href="/api/export/ledger">Export CSV</a></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="tile"><div className="k">Dollars in</div><div className="v">{fmtUsd(dollarsIn)}</div><div className="s">{fmtUsd(purchased)} bought · {fmtUsd(mined)} mined</div></div>
        <div className="tile"><div className="k">Value now</div><div className="v">{now.length ? fmtUsd(valueNow) : "—"}</div><div className="s">{now.length ? `against ${fmtUsd(basis)} basis` : "add wallet addresses to compare"}</div></div>
        <div className="tile"><div className="k">Unrealized</div><div className={"v " + (now.length ? (pnl >= 0 ? "ok" : "err") : "")}>{now.length ? signed(pnl) : "—"}</div><div className="s">{now.length && basis > 0 ? `${pct((pnl / basis) * 100)} on basis` : ""}</div></div>
        <div className="tile"><div className="k">Realized</div><div className={"v " + (swapCount ? (realized >= 0 ? "ok" : "err") : "")}>{swapCount ? signed(realized) : "—"}</div><div className="s">{swapCount ? `across ${swapCount} swap${swapCount === 1 ? "" : "s"}, average cost` : "no swaps logged"}</div></div>
      </div>
      {dbError && <p className="err text-xs mb-2">Database: {dbError}</p>}
      {priceError && <p className="err text-xs mb-2">Prices: {priceError}</p>}

      {history.length >= 2 && (
        <>
          <h2>Portfolio value over time</h2>
          <div className="card"><RangeLine title="Portfolio value by day" data={history} /></div>
        </>
      )}
      {comp.labels.length >= 2 && (
        <>
          <h2>Composition over time</h2>
          <div className="card"><StackedArea title="Portfolio value by asset by day" labels={comp.labels} series={comp.series} /></div>
        </>
      )}
      {history.length < 2 && <p className="muted text-xs mb-4">Value and composition over time appear once the holdings page has been opened on two different days.</p>}

      {withBasis.length > 0 && now.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4">
          <div><h2>Cost basis vs value now</h2><div className="card"><Paired title="Cost basis beside current value, by asset" aLabel="Basis" bLabel="Value now" data={withBasis.map((r) => ({ label: r.asset, a: r.usdIn, b: r.valueNow }))} /></div></div>
          <div><h2>Unrealized by asset</h2><div className="card"><HBars title="Unrealized gain or loss by asset" data={withBasis.map((r) => ({ label: r.asset, sub: pct(r.pnlPct), value: r.pnl }))} /></div></div>
        </div>
      )}
      {months.length > 0 && (
        <>
          <h2>Dollars in by month</h2>
          <div className="card"><Paired title="Dollars in by month, purchased beside mined" aLabel="Purchased" bLabel="Mined" data={months} /></div>
        </>
      )}

      {rows.length > 0 && (
        <>
          <h2>By asset</h2>
          <div className="tablewrap"><table>
            <thead><tr><th>Asset</th><th className="num sm-hide">Units in</th><th className="num">Basis</th><th className="num sm-hide">Units held</th><th className="num">Value now</th><th className="num">Unrealized</th><th className="num sm-hide">Realized</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.asset}>
                <td className="text-neutral-100">{r.asset}</td>
                <td className="num muted sm-hide">{qty(r.qtyIn)}</td>
                <td className="num">{fmtUsd(r.usdIn)}</td>
                <td className="num muted sm-hide">{now.length ? qty(r.qtyNow) : "—"}</td>
                <td className="num">{now.length ? fmtUsd(r.valueNow) : "—"}</td>
                <td className={"num " + (!now.length || r.usdIn <= 0 ? "muted" : r.pnl >= 0 ? "ok" : "err")}>{!now.length ? "—" : r.usdIn <= 0 ? "no basis" : `${signed(r.pnl)} ${pct(r.pnlPct)}`}</td>
                <td className={"num sm-hide " + (r.realized === 0 ? "muted" : r.realized > 0 ? "ok" : "err")}>{r.realized === 0 ? "—" : signed(r.realized)}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <p className="muted text-xs mt-2">Value now counts only what the tracked wallets hold. Anything bought and left on an exchange shows basis with no value against it. Basis follows average cost: a swap takes the average cost of the units given up with it, and the units received arrive at the swap&apos;s dollar value.</p>
        </>
      )}

      <h2>Log a swap</h2>
      <form action={addSwap} className="card grid grid-cols-2 md:grid-cols-5 gap-3 mb-2">
        <div><label>Date</label><input name="date" type="date" required className="w-full" /></div>
        <div><label>From asset</label><input name="from_asset" placeholder="ETC" required className="w-full" /></div>
        <div><label>From quantity</label><input name="from_qty" placeholder="1.25" required inputMode="decimal" className="w-full" /></div>
        <div><label>To asset</label><input name="to_asset" placeholder="SOL" required className="w-full" /></div>
        <div><label>To quantity</label><input name="to_qty" placeholder="0.31" required inputMode="decimal" className="w-full" /></div>
        <div><label>USD value at swap</label><input name="usd_value" placeholder="62.40" required inputMode="decimal" className="w-full" /></div>
        <div><label>Fees (USD)</label><input name="fees" placeholder="0" inputMode="decimal" className="w-full" /></div>
        <div><label>Venue</label><input name="venue" placeholder="Jupiter, Kraken…" required className="w-full" /></div>
        <div><label>Notes</label><input name="notes" className="w-full" /></div>
        <div className="flex items-end"><button className="w-full">Add swap</button></div>
      </form>
      <p className="muted text-xs mb-6">Purchases are logged on the <a href="/purchases">purchases page</a>; mining payouts arrive on their own. A swap is what you gave up, what you got, and what it was worth in dollars at the time.</p>

      <h2>Every event</h2>
      <div className="tablewrap"><table>
        <thead><tr><th>Date (UTC)</th><th>Type</th><th>Asset</th><th className="num">Qty</th><th className="num">USD</th><th className="num sm-hide">Fees</th><th className="sm-hide">Via</th><th className="sm-hide">Ref</th></tr></thead>
        <tbody>{newest.map((e) => (
          <tr key={e.kind + e.ref}>
            <td className="muted">{e.date}</td>
            <td><span className={`badge badge-${e.kind}`}>{e.kind}</span></td>
            <td className="text-neutral-100">{e.from ? <>{e.from.asset} <span className="muted">→</span> {e.asset}</> : e.asset}</td>
            <td className="num">{qty(e.qty)}{e.from && <div className="muted text-xs">for {qty(e.from.qty)} {e.from.asset}</div>}</td>
            <td className="num">{e.note === "unpriced" ? <span className="err">unpriced</span> : fmtUsd(e.usd)}</td>
            <td className="num muted sm-hide">{e.fees ? fmtUsd(e.fees) : "—"}</td>
            <td className="muted sm-hide">{e.via}</td>
            <td className="muted sm-hide">{e.kind === "mining" ? <a className="muted" href={`https://etc.blockscout.com/tx/${e.ref}`}>{e.ref.slice(0, 10)}…</a> : e.note ?? "—"}</td>
          </tr>
        ))}</tbody>
      </table>
      {!dbError && events.length === 0 && <p className="muted p-4">Nothing yet. Log a purchase or a swap, or let a mining payout land, and it appears here.</p>}</div>
    </>
  );
}

function NeedsStorage() {
  return (
    <div className="max-w-lg mx-auto mt-10 card">
      <h1 className="mb-2">The ledger needs storage</h1>
      <p className="muted">This page reads your purchase log, swaps, mining payouts, and daily snapshots, so it needs a database. Set <code className="text-neutral-100">MONGODB_URI</code> to a MongoDB connection string (the free Atlas tier works) and it will switch on. Holdings work without it.</p>
    </div>
  );
}
