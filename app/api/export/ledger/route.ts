import { payouts, purchases } from "@/lib/db";
import { buildLedger } from "@/lib/ledger";
import { csv } from "@/lib/csv";
export const dynamic = "force-dynamic";
export async function GET() {
  const [ps, ms] = await Promise.all([purchases.list(), payouts.list()]);
  const rows = buildLedger(ps, ms);
  return csv(["date", "type", "asset", "quantity", "usd", "fees_usd", "via", "ref", "note"],
    rows.map((e) => [e.date, e.kind, e.asset, e.qty, e.usd, e.fees, e.via, e.ref, e.note]), "ledger.csv");
}
