import { purchases } from "@/lib/db";
import { csv } from "@/lib/csv";
export const dynamic = "force-dynamic";
export async function GET() {
  const rows = (await purchases.list()).reverse();
  return csv(["date", "asset", "quantity", "usd_total", "fees_usd", "rail", "notes"],
    rows.map((r) => [r.date, r.asset, r.quantity, r.usd_total, r.fees, r.rail, r.notes]), "purchases.csv");
}
