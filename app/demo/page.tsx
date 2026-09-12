// Sample data, on its own URL.
//
// Served when DEMO_MODE=1, and also when no wallet addresses are configured,
// because in that case there is no real dashboard for it to be confused with.
// A deployment that is watching real wallets keeps this route hidden unless
// its owner turns it on deliberately.
import { notFound } from "next/navigation";
import { config } from "@/config";
import Sample from "../sample";
export const dynamic = "force-dynamic";

const configured = Object.values(config.wallets).some(Boolean);

export default function Demo() {
  if (process.env.DEMO_MODE !== "1" && configured) notFound();
  return <Sample />;
}
