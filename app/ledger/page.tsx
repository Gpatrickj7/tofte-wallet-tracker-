import { fetchAllChains } from "@/lib/chains";
import { spotPrices } from "@/lib/prices";
import { payouts, purchases, snapshots, type Payout, type Purchase, type Snapshot } from "@/lib/db";
import { buildLedger, byAsset, compare, composition, monthly, type Holding } from "@/lib/ledger";
import { fmtQty, fmtUsd } from "@/lib/units";
import { HBars, Paired, RangeLine, StackedArea } from "@/lib/charts";
import { config } from "@/config";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const pct = (n: number | null) => (n == null ? "" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`);
const qty = (n: number) => fmtQty(n.toFixed(8).replace(/\.?0+$/, ""));

export default async function Ledger() {
  if (!process.env.MONGODB_URI) return <NeedsStorage />;

  let ps: Purchase[] = [], ms: Payout[] = [], snaps: Snapshot[] = [];
  let dbError: string | null = null;
  try { [ps, ms, snaps] = await Promise.all([purchases.list(), payouts.list(), snapshots.list()]); }
  catch (e) { dbError = (e as Error).message; }

  const events = buildLedger(ps, ms);
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

  const dollarsIn = events.reduce((s, e) => s + e.usd + e.fees, 0);
  const purchased = events.filter((e) => e.kind === "purchase").reduce((s, e) => s + e.usd, 0);
  const mined = events.filter((e) => e.kind === "mining").reduce((s, e) => s + e.usd, 0);
  const fees = events.reduce((s, e) => s + e.fees, 0);
  const valueNow = rows.reduce((s, r) => s + r.valueNow, 0);
  const pnl = valueNow - dollarsIn;
  const months = monthly(events).map((m) => ({ label: m.label, a: m.purchased, b: m.mined }));
  const comp = composition(snaps);
  const history = snaps.map((s) => ({ day: s.day, value: s.total }));
  const withBasis = rows.filter((r) => r.usdIn > 0);
  const newest = [...events].reverse();

  return (
    <>
      <div className="flex items-baseline justify-between mb-4">
        <h1>Ledger</h1>
        <a href="/api/export/ledger" className="text-xs">Export CSV</a>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="tile"><div className="k">Dollars in</div><div className="v">{fmtUsd(dollarsIn)}</div><div className="s">{fmtUsd(purchased)} bought · {fmtUsd(mined)} mined · {fmtUsd(fees)} fees</div></div>
        <div className="tile"><div className="k">Value now</div><div className="v">{now.length ? fmtUsd(valueNow) : "—"}</div><div className="s">{now.length ? "what the tracked wallets hold" : "add wallet addresses to compare"}</div></div>
        <div className="tile"><div className="k">Unrealized</div><div className={"v " + (now.length ? (pnl >= 0 ? "ok" : "err") : "")}>{now.length ? `${pnl >= 0 ? "+" : "−"}${fmtUsd(Math.abs(pnl))}` : "—"}</div><div className="s">{now.length && dollarsIn > 0 ? `${pct((pnl / dollarsIn) * 100)} on dollars in` : ""}</div></div>
        <div className="tile"><div className="k">History</div><div className="v">{snaps.length} day{snaps.length === 1 ? "" : "s"}</div><div className="s">{events.length} ledger events across {assets.length} asset{assets.length === 1 ? "" : "s"}</div></div>
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
          <div><h2>Cost basis vs value now</h2><div className="card"><Paired title="Cost basis beside current value, by asset" aLabel="Dollars in" bLabel="Value now" data={withBasis.map((r) => ({ label: r.asset, a: r.usdIn, b: r.valueNow }))} /></div></div>
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
            <thead><tr><th>Asset</th><th className="num sm-hide">Units in</th><th className="num">Dollars in</th><th className="num sm-hide">Units held</th><th className="num">Value now</th><th className="num">Unrealized</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.asset}>
                <td className="text-neutral-100">{r.asset}</td>
                <td className="num muted sm-hide">{qty(r.qtyIn)}</td>
                <td className="num">{fmtUsd(r.usdIn)}</td>
                <td className="num muted sm-hide">{now.length ? qty(r.qtyNow) : "—"}</td>
                <td className="num">{now.length ? fmtUsd(r.valueNow) : "—"}</td>
                <td className={"num " + (!now.length || r.usdIn <= 0 ? "muted" : r.pnl >= 0 ? "ok" : "err")}>{!now.length ? "—" : r.usdIn <= 0 ? "no basis" : `${r.pnl >= 0 ? "+" : "−"}${fmtUsd(Math.abs(r.pnl))} ${pct(r.pnlPct)}`}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <p className="muted text-xs mt-2">Value now counts only what the tracked wallets hold. Anything bought and left on an exchange shows dollars in with no value against it.</p>
        </>
      )}

      <h2>Every event</h2>
      <div className="tablewrap"><table>
        <thead><tr><th>Date (UTC)</th><th>Type</th><th>Asset</th><th className="num">Qty</th><th className="num">USD</th><th className="num sm-hide">Fees</th><th className="sm-hide">Via</th><th className="sm-hide">Ref</th></tr></thead>
        <tbody>{newest.map((e) => (
          <tr key={e.kind + e.ref}>
            <td className="muted">{e.date}</td>
            <td><span className={`badge badge-${e.kind}`}>{e.kind}</span></td>
            <td className="text-neutral-100">{e.asset}</td>
            <td className="num">{qty(e.qty)}</td>
            <td className="num">{e.note === "unpriced" ? <span className="err">unpriced</span> : fmtUsd(e.usd)}</td>
            <td className="num muted sm-hide">{e.fees ? fmtUsd(e.fees) : "—"}</td>
            <td className="muted sm-hide">{e.via}</td>
            <td className="muted sm-hide">{e.kind === "mining" ? <a className="muted" href={`https://etc.blockscout.com/tx/${e.ref}`}>{e.ref.slice(0, 10)}…</a> : e.note ?? "—"}</td>
          </tr>
        ))}</tbody>
      </table>
      {!dbError && events.length === 0 && <p className="muted p-4">Nothing yet. Log a purchase, or let a mining payout land, and it appears here.</p>}</div>
    </>
  );
}

function NeedsStorage() {
  return (
    <div className="max-w-lg mx-auto mt-10 card">
      <h1 className="mb-2">The ledger needs storage</h1>
      <p className="muted">This page reads your purchase log, mining payouts, and daily snapshots, so it needs a database. Set <code className="text-neutral-100">MONGODB_URI</code> to a MongoDB connection string (the free Atlas tier works) and it will switch on. Holdings work without it.</p>
    </div>
  );
}
