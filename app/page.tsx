import { fetchAllChains } from "@/lib/chains";
import { spotPrices } from "@/lib/prices";
import { snapshots } from "@/lib/db";
import { fmtQty, fmtTs, fmtUsd } from "@/lib/units";
import { HBars, RangeLine, Stacked } from "@/lib/charts";
import { config } from "@/config";
import Sample from "./sample";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const configured = Object.values(config.wallets).some(Boolean);

export default async function Holdings({ searchParams }: { searchParams: Promise<{ fresh?: string }> }) {
  const { fresh } = await searchParams;
  // A fresh deployment has no addresses yet. Showing "nothing to show yet"
  // makes a correct install look broken, so show the sample dashboard with a
  // banner explaining what it is and how to point it at real wallets. Nothing
  // is fetched and nothing is stored until an address exists.
  if (!configured) return <Sample welcome />;
  const chains = await fetchAllChains(fresh === "1");
  const positions = chains.flatMap((c) => c.positions);
  const { prices, asOf, error } = await spotPrices(positions.map((p) => p.priceSymbol));
  const rows = positions
    .filter((p) => p.quantity !== "0")
    .map((p) => ({ ...p, price: prices[p.priceSymbol] ?? null, value: prices[p.priceSymbol] != null ? Number(p.quantity) * prices[p.priceSymbol] : null }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const counted = rows.filter((r) => !(r.kind === "token" && r.note));
  const total = counted.reduce((s, r) => s + (r.value ?? 0), 0);
  const top = counted.find((r) => r.value != null);

  // Remember today's total, then read the history back. Both are best-effort:
  // without a database the page simply has no line to draw.
  if (total > 0 && process.env.MONGODB_URI) {
    await snapshots.record(total, counted.filter((r) => r.value != null).map((r) => ({ asset: r.asset, chain: r.chain, qty: r.quantity, price: r.price, value: r.value! })));
  }
  const history = process.env.MONGODB_URI ? await snapshots.list() : [];

  const byChain = new Map<string, number>();
  for (const r of counted) if (r.value) byChain.set(r.chain, (byChain.get(r.chain) ?? 0) + r.value);
  const chainData = [...byChain].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  const allocation = counted.filter((r) => r.value != null && r.value > 0).slice(0, 10).map((r) => ({ label: r.asset.split(" ")[0], sub: r.chain, value: r.value! }));

  return (
    <>
      <div className="flex items-baseline justify-between mb-4">
        <h1>Holdings</h1>
        <div className="text-xs muted">Prices as of {asOf ? fmtTs(asOf) : "—"}{error && <span className="err"> · {error}</span>} · <a href="/?fresh=1">Refresh</a></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="tile"><div className="k">Portfolio value</div><div className="v">{fmtUsd(total)}</div><div className="s">priced positions only</div></div>
        <div className="tile"><div className="k">Positions</div><div className="v">{counted.length}</div><div className="s">{chains.filter((c) => !c.error).length} of {chains.length} chains responding</div></div>
        <div className="tile"><div className="k">Largest</div><div className="v">{top ? top.asset.split(" ")[0] : "—"}</div><div className="s">{top && total ? (top.value! / total * 100).toFixed(1) + "% of book" : ""}</div></div>
        <div className="tile"><div className="k">Unpriced</div><div className="v">{rows.filter((r) => r.value == null).length}</div><div className="s">shown as no price, counted as $0</div></div>
      </div>
      {chains.filter((c) => c.error).map((c) => <p key={c.chain} className="err text-xs mb-1">{c.chain}: {c.error}</p>)}

      {history.length >= 2 && (
        <>
          <h2>Portfolio value over time</h2>
          <div className="card"><RangeLine title="Portfolio value by day" data={history.map((s) => ({ day: s.day, value: s.total }))} /><p className="muted text-xs mt-3"><a href="/ledger">Composition over time, cost basis, and every event →</a></p></div>
        </>
      )}
      {history.length === 1 && <p className="muted text-xs mb-4">First snapshot saved. The value-over-time chart appears once there is a second day of data.</p>}

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h2>Allocation</h2>
          <div className="card"><HBars title="Allocation by asset" data={allocation} total={total} /></div>
        </div>
        <div>
          <h2>By chain</h2>
          <div className="card"><Stacked title="Holdings by chain" data={chainData} /></div>
        </div>
      </div>

      <h2>Positions</h2>
      <div className="tablewrap"><table><thead><tr><th>Asset</th><th>Chain</th><th className="sm-hide">Type</th><th className="num">Qty</th><th className="num sm-hide">Price</th><th className="num">USD</th><th className="num sm-hide">%</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={i}>
          <td><div className="text-neutral-100">{r.asset}</div>{r.note && <div className={(r.kind === "token" ? "err" : "muted") + " text-xs max-w-md"}>{r.note}</div>}{!r.note && r.kind === "token" && r.value == null && <div className="err text-xs max-w-md">no market price. If you never bought this, it is an unsolicited airdrop; treat as $0 and never interact with it.</div>}</td>
          <td className="muted">{r.chain}</td>
          <td className="sm-hide"><span className={`badge badge-${r.kind}`}>{r.kind}</span></td>
          <td className="num">{fmtQty(r.quantity)}</td>
          <td className="num muted sm-hide">{fmtUsd(r.price)}</td>
          <td className="num text-neutral-100">{r.value == null ? <span className="err">no price</span> : fmtUsd(r.value)}</td>
          <td className="num muted sm-hide">{r.value == null || !total || (r.kind === "token" && r.note) ? "—" : (r.value / total * 100).toFixed(1) + "%"}</td>
        </tr>
      ))}</tbody>
      <tfoot><tr><td colSpan={3} className="sm-hide">Total</td><td colSpan={2} className="sm-only-total">Total</td><td className="num">{fmtUsd(total)}</td><td className="sm-hide" /></tr></tfoot></table></div>
    </>
  );
}
