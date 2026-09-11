import { revalidatePath } from "next/cache";
import { purchases } from "@/lib/db";
import { fmtQty, fmtUsd } from "@/lib/units";
import { Columns, HBars, Line } from "@/lib/charts";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function add(fd: FormData) {
  "use server";
  const g = (k: string) => String(fd.get(k) ?? "").trim();
  if (!g("date") || !g("asset") || !g("quantity") || !g("usd_total") || !g("rail")) return;
  await purchases.insert({ date: g("date"), asset: g("asset").toUpperCase(), quantity: g("quantity"), usd_total: g("usd_total"), fees: g("fees") || "0", rail: g("rail"), notes: g("notes") || null, created_at: Math.floor(Date.now() / 1000) });
  revalidatePath("/purchases");
}

export default async function Purchases() {
  if (!process.env.MONGODB_URI) {
    return (
      <div className="max-w-lg mx-auto mt-10 card">
        <h1 className="mb-2">Purchases need storage</h1>
        <p className="muted">This page keeps a log, so it needs a database. Set <code className="text-neutral-100">MONGODB_URI</code> to a MongoDB connection string (the free Atlas tier works) and it will switch on. Holdings work without it.</p>
      </div>
    );
  }
  let rows: Awaited<ReturnType<typeof purchases.list>> = [];
  let dbError: string | null = null;
  try { rows = await purchases.list(); } catch (e) { dbError = (e as Error).message; }
  const deployed = rows.reduce((a, r) => a + Number(r.usd_total), 0);
  const fees = rows.reduce((a, r) => a + Number(r.fees), 0);

  const byRail = new Map<string, { usd: number; fees: number }>();
  for (const r of rows) { const b = byRail.get(r.rail) ?? { usd: 0, fees: 0 }; b.usd += Number(r.usd_total); b.fees += Number(r.fees); byRail.set(r.rail, b); }
  const railData = [...byRail].sort((a, b) => b[1].usd - a[1].usd).map(([label, b]) => ({ label, sub: b.usd ? (b.fees / b.usd * 100).toFixed(2) + "% fees" : undefined, value: b.usd }));

  // Oldest first for the time charts; the table stays newest first.
  const chrono = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.created_at - b.created_at);
  const byMonth = new Map<string, number>();
  for (const r of chrono) { const k = r.date.slice(0, 7); byMonth.set(k, (byMonth.get(k) ?? 0) + Number(r.usd_total)); }
  const monthly = [...byMonth].slice(-24).map(([label, value]) => ({ label, value }));
  let run = 0;
  const cumulative = chrono.map((r) => { run += Number(r.usd_total); return { label: r.date.slice(5), sub: `${r.date} · ${r.asset}`, value: run }; });

  return (
    <>
      <div className="flex items-baseline justify-between mb-4"><h1>Purchases</h1><a href="/api/export/purchases" className="text-xs">Export CSV</a></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="tile"><div className="k">Dollars deployed</div><div className="v">{fmtUsd(deployed)}</div><div className="s">{rows.length} purchases</div></div>
        <div className="tile"><div className="k">Fees paid</div><div className="v">{fmtUsd(fees)}</div><div className="s">{deployed ? (fees / deployed * 100).toFixed(2) + "% of deployed" : ""}</div></div>
        {[...byRail].slice(0, 2).map(([rail, b]) => <div key={rail} className="tile"><div className="k">{rail}</div><div className="v">{b.usd ? (b.fees / b.usd * 100).toFixed(2) : "0.00"}%</div><div className="s">{fmtUsd(b.fees)} fees on {fmtUsd(b.usd)}</div></div>)}
      </div>

      {rows.length > 0 && (
        <>
          <div className="grid md:grid-cols-2 gap-4">
            <div><h2>Deployed by month</h2><div className="card"><Columns title="Dollars deployed by month" data={monthly} /></div></div>
            <div><h2>Cumulative deployed</h2><div className="card"><Line title="Cumulative dollars deployed" data={cumulative} /></div></div>
          </div>
          <h2>By rail</h2>
          <div className="card"><HBars title="Dollars deployed by rail" data={railData} total={deployed} /></div>
        </>
      )}

      <h2>Log a purchase</h2>
      <form action={add} className="card grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div><label>Date</label><input name="date" type="date" required className="w-full" /></div>
        <div><label>Asset</label><input name="asset" placeholder="BTC" required className="w-full" /></div>
        <div><label>Quantity</label><input name="quantity" placeholder="0.0125" required inputMode="decimal" className="w-full" /></div>
        <div><label>USD total</label><input name="usd_total" placeholder="812.50" required inputMode="decimal" className="w-full" /></div>
        <div><label>Fees (USD)</label><input name="fees" placeholder="0" inputMode="decimal" className="w-full" /></div>
        <div><label>Rail / venue</label><input name="rail" placeholder="Kraken, Cash App…" required className="w-full" /></div>
        <div><label>Notes</label><input name="notes" className="w-full" /></div>
        <div className="flex items-end"><button className="w-full">Add purchase</button></div>
      </form>
      {dbError && <p className="err text-xs mb-2">Database: {dbError}</p>}
      <h2>History</h2>
      <div className="tablewrap"><table><thead><tr><th>Date</th><th>Asset</th><th className="num">Qty</th><th className="num">USD total</th><th className="num sm-hide">Fees</th><th className="num sm-hide">Fee %</th><th>Rail</th><th className="sm-hide">Notes</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id}><td className="muted">{r.date}</td><td className="text-neutral-100">{r.asset}</td><td className="num">{fmtQty(r.quantity)}</td><td className="num">{fmtUsd(Number(r.usd_total))}</td>
          <td className="num muted sm-hide">{fmtUsd(Number(r.fees))}</td><td className="num muted sm-hide">{Number(r.usd_total) ? (Number(r.fees) / Number(r.usd_total) * 100).toFixed(2) + "%" : "—"}</td>
          <td>{r.rail}</td><td className="muted sm-hide">{r.notes}</td></tr>
      ))}</tbody></table>
      {!dbError && rows.length === 0 && <p className="muted p-4">No purchases logged yet. Add one above.</p>}</div>
    </>
  );
}
