import { revalidatePath } from "next/cache";
import { backfillFromChain, fetchPool, listPayouts, priceUnpaid } from "@/lib/pool";
import { Columns, Line, Meter } from "@/lib/charts";
import { fmtQty, fmtTs, fmtUsd, fromBase } from "@/lib/units";
import { config } from "@/config";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const hr = (h: number) => (h / 1e6).toFixed(2) + " MH/s";

async function fillPrices() { "use server"; await priceUnpaid(20); revalidatePath("/mining"); }

export default async function Mining() {
  if (!config.pool.address) {
    return (
      <div className="max-w-lg mx-auto mt-10 card">
        <h1 className="mb-2">Mining is not set up</h1>
        <p className="muted">Set <code className="text-neutral-100">POOL_ADDRESS</code> to the payout address you registered with your pool and this page will fill in. Only 2miners is supported in v1.</p>
      </div>
    );
  }
  const s = await fetchPool();
  const backfillError = await backfillFromChain();
  await priceUnpaid(3).catch(() => 0);
  let payouts: Awaited<ReturnType<typeof listPayouts>> = [];
  let dbError: string | null = null;
  try { payouts = await listPayouts(); } catch (e) { dbError = (e as Error).message; }
  const unpaid = fromBase(s.unpaidBase, 9), thr = fromBase(s.thresholdBase, 9);
  const pct = Number(thr) ? Math.min(100, Number(unpaid) / Number(thr) * 100) : 0;
  const totalEtc = payouts.reduce((a, p) => a + Number(fromBase(p.amount_base, p.decimals)), 0);
  const totalUsd = payouts.reduce((a, p) => a + Number(p.usd_value ?? 0), 0);
  const unpriced = payouts.filter((p) => p.usd_price == null).length;

  // Monthly income, and the running total across every priced payout.
  const byMonth = new Map<string, number>();
  const priced = payouts.filter((p) => p.usd_value != null).sort((a, b) => a.ts - b.ts);
  for (const p of priced) { const k = fmtTs(p.ts).slice(0, 7); byMonth.set(k, (byMonth.get(k) ?? 0) + Number(p.usd_value)); }
  const monthly = [...byMonth].sort().slice(-24).map(([label, value]) => ({ label, value }));
  let run = 0;
  const cumulative = priced.map((p) => { run += Number(p.usd_value); return { label: fmtTs(p.ts).slice(5, 10), sub: fmtTs(p.ts).slice(0, 10), value: run }; });
  const eta = s.etaHours == null ? "—" : s.etaHours < 1 ? "<1 h" : s.etaHours < 48 ? s.etaHours.toFixed(0) + " h" : (s.etaHours / 24).toFixed(1) + " d";

  return (
    <>
      <div className="flex items-baseline justify-between mb-4"><h1>Mining</h1><div className="text-xs muted">{config.pool.name} · payouts read from chain</div></div>
      {s.error && <p className="err text-xs mb-3">Pool: {s.error}</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="tile"><div className="k">Hashrate</div><div className="v">{hr(s.hashrate)}</div><div className="s">24h avg {hr(s.avgHashrate24h)}</div></div>
        <div className="tile"><div className="k">Unpaid</div><div className="v">{fmtQty(unpaid)} ETC</div><Meter value={Number(unpaid)} max={Number(thr)} label="Progress to next payout" /><div className="s">{pct.toFixed(0)}% of {fmtQty(thr)} ETC threshold · next in {eta}</div></div>
        <div className="tile"><div className="k">Lifetime mined</div><div className="v">{totalEtc.toFixed(4)} ETC</div><div className="s">{payouts.length} payouts</div></div>
        <div className="tile"><div className="k">Income at receipt</div><div className="v">{fmtUsd(totalUsd)}</div><div className="s">{unpriced ? `${unpriced} payouts unpriced` : "all payouts priced"}</div></div>
      </div>
      {backfillError && <p className="err text-xs mb-2">Chain backfill: {backfillError}</p>}
      {dbError && <p className="err text-xs mb-2">Database: {dbError}</p>}

      {priced.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4">
          <div><h2>Income by month</h2><div className="card"><Columns title="Mining income by month, USD at receipt" data={monthly} /></div></div>
          <div><h2>Cumulative income</h2><div className="card"><Line title="Cumulative mining income, USD at receipt" data={cumulative} /></div></div>
        </div>
      )}

      <div className="flex items-center justify-between mt-6 mb-2">
        <h2 className="m-0">Payout log</h2>
        <div className="flex items-center gap-3">
          {unpriced > 0 && <form action={fillPrices} className="flex items-center gap-2"><span className="muted text-xs">{unpriced} unpriced</span><button>Fill 20 prices</button></form>}
          <a href="/api/export/payouts" className="text-xs">Export CSV</a>
        </div>
      </div>
      <div className="tablewrap"><table><thead><tr><th>Date (UTC)</th><th>Asset</th><th className="num">Qty</th><th className="num">Price @ receipt</th><th className="num">USD income</th><th>Source</th><th>Tx</th></tr></thead>
      <tbody>{payouts.map((p) => (
        <tr key={p.id}><td className="muted">{fmtTs(p.ts)}</td><td>{p.asset}</td><td className="num">{fmtQty(fromBase(p.amount_base, p.decimals))}</td>
          <td className="num muted">{p.usd_price == null ? <span className="err">{p.price_error ?? "pending"}</span> : fmtUsd(Number(p.usd_price))}</td>
          <td className="num text-neutral-100">{p.usd_value == null ? "—" : fmtUsd(Number(p.usd_value))}</td>
          <td className="muted">{p.source ?? "—"}</td>
          <td><a className="muted" href={`https://etc.blockscout.com/tx/${p.id}`}>{p.id.slice(0, 10)}…</a></td></tr>
      ))}</tbody></table>
      {!dbError && payouts.length === 0 && <p className="muted p-4">No payouts recorded yet.</p>}</div>
    </>
  );
}
