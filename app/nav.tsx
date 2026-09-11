"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
const items = [["/", "Holdings"], ["/mining", "Mining"], ["/purchases", "Purchases"], ["/status", "Status"]];
export function Nav() {
  const p = usePathname();
  return (
    <div className="nav flex items-center gap-1">
      {items.map(([href, label]) => <Link key={href} href={href} className={p === href ? "active" : ""}>{label}</Link>)}
      <a href="/logout" className="ml-2 text-neutral-600 hover:text-neutral-300 text-xs">Sign out</a>
    </div>
  );
}
