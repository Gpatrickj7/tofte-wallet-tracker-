import { dbStatus } from "@/lib/db";
import { config } from "@/config";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function probe(name: string, url: string) {
  const t = Date.now();
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    return { name, ok: r.ok, ms: Date.now() - t, note: r.ok ? "" : `HTTP ${r.status}` };
  } catch (e) { return { name, ok: false, ms: Date.now() - t, note: (e as Error).message }; }
}

export default async function Status() {
  const set = (v: string) => (v ? "set" : "missing");
  const [db, ...apis] = await Promise.all([
    dbStatus(),
    probe("CoinGecko", "https://api.coingecko.com/api/v3/ping"),
    probe("Coinbase (price fallback)", "https://api.coinbase.com/v2/prices/BTC-USD/spot"),
    probe("Kraken (history fallback)", "https://api.kraken.com/0/public/Time"),
    probe("mempool.space", "https://mempool.space/api/blocks/tip/height"),
    probe("Blockscout ETC", "https://etc.blockscout.com/api?module=block&action=eth_block_number"),
    probe("2Miners", "https://etc.2miners.com/api/stats"),
    probe("Blockscout ETH", "https://eth.blockscout.com/api?module=block&action=eth_block_number"),
    probe("BSC RPC", "https://bsc-rpc.publicnode.com/"),
    probe("Linea RPC", "https://rpc.linea.build/"),
    probe("TronGrid", "https://api.trongrid.io/wallet/getnowblock"),
    probe("Solana RPC", "https://api.mainnet-beta.solana.com/health"),
    probe("Solana RPC (fallback)", "https://solana-rpc.publicnode.com/health"),
  ]);
  const Row = ({ k, v, ok }: { k: string; v: string; ok: boolean }) => (
    <tr><td><span className={`inline-block w-2 h-2 rounded-full mr-2 ${ok ? "bg-emerald-400" : "bg-red-500"}`} />{k}</td><td className={ok ? "ok" : "err"}>{v}</td></tr>
  );
  return (
    <>
      <h1 className="mb-4">Status</h1>
      <div className="tablewrap"><table><tbody>
        <Row k="MongoDB" v={db.ok ? `ok (${db.ms} ms)` : `FAIL after ${db.ms} ms: ${db.error}`} ok={db.ok} />
        {apis.map((a) => <Row key={a.name} k={a.name} v={a.ok ? `ok (${a.ms} ms)` : `FAIL ${a.note} (${a.ms} ms)`} ok={a.ok} />)}
        <Row k="MONGODB_URI" v={set(process.env.MONGODB_URI ?? "")} ok={!!process.env.MONGODB_URI} />
        <Row k="DASH_USER / DASH_PASS" v={set(process.env.DASH_USER ?? "") + " / " + set(process.env.DASH_PASS ?? "")} ok={!!process.env.DASH_USER && !!process.env.DASH_PASS} />
        <Row k="Wallets" v={Object.entries(config.wallets).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"} ok={true} />
        <Row k="Pool" v={`${config.pool.name} ${config.pool.address ? "(address set)" : "(no address)"}`} ok={!!config.pool.address} />
      </tbody></table></div>
    </>
  );
}
