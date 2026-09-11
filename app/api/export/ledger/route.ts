import { payouts, purchases, swaps } from "@/lib/db";
import { buildLedger } from "@/lib/ledger";
import { csv } from "@/lib/csv";
export const dynamic = "force-dynamic";
export async function GET() {
  const [ps, ms, ss] = await Promise.all([purchases.list(), payouts.list(), swaps.list()]);
  const rows = buildLedger(ps, ms, ss);
  return csv(["date", "type", "asset", "quantity", "usd", "fees_usd", "via", "ref", "note", "from_asset", "from_quantity"],
    rows.map((e) => [e.date, e.kind, e.asset, e.qty, e.usd, e.fees, e.via, e.ref, e.note, e.from?.asset ?? null, e.from?.qty ?? null]), "ledger.csv");
}
