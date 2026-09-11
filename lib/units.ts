// Base-unit integer string -> decimal string. No floats.
export function fromBase(amount: string, decimals: number): string {
  const neg = amount.startsWith("-");
  let s = neg ? amount.slice(1) : amount;
  s = s.padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  let frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return (neg ? "-" : "") + int + (frac ? "." + frac : "");
}
// decimal string * decimal price -> USD number (display only)
export function usd(qty: string, price: number | null): number | null {
  if (price == null) return null;
  return Number(qty) * price;
}
export const fmtUsd = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
export const fmtQty = (s: string) => {
  const [i, f] = s.split(".");
  return Number(i).toLocaleString("en-US") + (f ? "." + f.slice(0, 8) : "");
};
export const fmtTs = (ts: number) => new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16) + "Z";
