// Sample data so the dashboard can be seen before any address is configured.
// Only served when DEMO_MODE=1; otherwise this route does not exist.
import { notFound } from "next/navigation";
import { Columns, HBars, Line, Meter, Stacked } from "@/lib/charts";
export const dynamic = "force-dynamic";

const months = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const income = [310, 420, 380, 510, 470, 620, 590, 710, 680, 820, 760, 430];
const monthly = months.map((label, i) => ({ label, value: income[i] }));
let run = 0;
const cumulative = monthly.map((m) => ({ label: m.label.slice(5), sub: m.label, value: (run += m.value) }));
const allocation = [
  ["BTC", "Bitcoin", 14200], ["ETH", "Ethereum", 6100], ["SOL", "Solana", 2400],
  ["ETC", "Ethereum Classic", 1900], ["BNB", "BNB Chain", 640], ["TRX", "TRON", 210],
].map(([label, sub, value]) => ({ label: label as string, sub: sub as string, value: value as number }));
const chains = [["Bitcoin", 14200], ["Ethereum", 6800], ["Solana", 2400], ["Ethereum Classic", 1900], ["BNB Chain", 640], ["TRON", 210]]
  .map(([label, value]) => ({ label: label as string, value: value as number }));
const total = allocation.reduce((s, a) => s + a.value, 0);
let v = 21000;
const history = Array.from({ length: 45 }, (_, i) => {
  v += (Math.sin(i / 4) * 400) + 120;
  const d = new Date(Date.UTC(2026, 6, 28 + i)).toISOString().slice(0, 10);
  return { label: d.slice(5), sub: d, value: Math.round(v) };
});

export default function Demo() {
  if (process.env.DEMO_MODE !== "1") notFound();
  return (
    <>
      <div className="flex items-baseline justify-between mb-4">
        <h1>Holdings <span className="badge badge-token ml-2 align-middle">demo data</span></h1>
        <div className="text-xs muted">Sample numbers. Nothing here is real.</div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="tile"><div className="k">Portfolio value</div><div className="v">${total.toLocaleString()}</div><div className="s">priced positions only</div></div>
        <div className="tile"><div className="k">Positions</div><div className="v">{allocation.length}</div><div className="s">6 of 6 chains responding</div></div>
        <div className="tile"><div className="k">Largest</div><div className="v">BTC</div><div className="s">{((14200 / total) * 100).toFixed(1)}% of book</div></div>
        <div className="tile"><div className="k">Unpaid mining</div><div className="v">0.0412 ETC</div><Meter value={0.0412} max={0.1} label="Progress to next payout" /><div className="s">41% of 0.1 ETC threshold</div></div>
      </div>
      <h2>Portfolio value over time</h2>
      <div className="card"><Line title="Portfolio value by day" data={history} /></div>
      <div className="grid md:grid-cols-2 gap-4">
        <div><h2>Allocation</h2><div className="card"><HBars title="Allocation by asset" data={allocation} total={total} /></div></div>
        <div><h2>By chain</h2><div className="card"><Stacked title="Holdings by chain" data={chains} /></div></div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div><h2>Mining income by month</h2><div className="card"><Columns title="Mining income by month" data={monthly} /></div></div>
        <div><h2>Cumulative income</h2><div className="card"><Line title="Cumulative mining income" data={cumulative} /></div></div>
      </div>
      <p className="muted text-xs mt-6">To see your own numbers, add wallet addresses to your environment and turn DEMO_MODE off. See the README.</p>
    </>
  );
}
