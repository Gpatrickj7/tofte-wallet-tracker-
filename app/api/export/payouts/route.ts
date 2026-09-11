import { listPayouts } from "@/lib/pool";
import { csv } from "@/lib/csv";
import { fromBase, fmtTs } from "@/lib/units";
export const dynamic = "force-dynamic";
export async function GET() {
  return csv(["date_utc", "asset", "quantity", "usd_price_at_receipt", "usd_income", "tx", "price_error"],
    (await listPayouts()).map((p) => [fmtTs(p.ts), p.asset, fromBase(p.amount_base, p.decimals), p.usd_price, p.usd_value, p.id, p.price_error]),
    "mining-income.csv");
}
