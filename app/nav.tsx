"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items: [string, string, string][] = [
  ["/", "Holdings", "M3 3h18v4H3zM3 10h18v4H3zM3 17h18v4H3z"],
  ["/mining", "Mining", "M12 2l9 5v10l-9 5-9-5V7z"],
  ["/purchases", "Purchases", "M6 6h15l-1.5 9h-12zM6 6L5 3H2M9 20a1 1 0 100-2 1 1 0 000 2zM18 20a1 1 0 100-2 1 1 0 000 2z"],
  ["/ledger", "Ledger", "M5 3h14v18H5zM9 3v18M12 8h4M12 12h4M12 16h4"],
  ["/status", "Status", "M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v5M12 16h.01"],
  ["/setup", "Setup", "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"],
];

/** Header links, shown on tablet and desktop. Nothing to navigate to
 *  before signing in, so the login page shows none of this. */
export function Nav() {
  const p = usePathname();
  if (p === "/login") return null;
  return (
    <div className="nav flex items-center gap-1">
      {items.map(([href, label]) => <Link key={href} href={href} className={p === href ? "active" : ""}>{label}</Link>)}
      <a href="/logout" className="ml-2 text-neutral-600 hover:text-neutral-300 text-xs">Sign out</a>
    </div>
  );
}

/** The phone header has no nav, so it carries its own sign-out link. */
export function PhoneSignOut() {
  const p = usePathname();
  if (p === "/login") return null;
  return <a href="/logout" className="sm:hidden text-xs text-neutral-500">Sign out</a>;
}

/** Bottom tab bar, shown on phones. Rendered outside the header on purpose:
 *  the header's backdrop blur would otherwise become this bar's containing
 *  block and pin it to the top of the page instead of the bottom. */
export function TabBar() {
  const p = usePathname();
  if (p === "/login") return null;
  // Five tabs is what fits at 390px without crowding. Setup stays in the
  // header nav and is linked from the welcome banner, which is where someone
  // who needs it actually is.
  const shown = items.filter(([href]) => href !== "/setup" || p === "/setup");
  return (
    <nav className="tabbar" aria-label="Sections">
      {shown.map(([href, label, d]) => (
        <Link key={href} href={href} className={p === href ? "active" : ""} aria-current={p === href ? "page" : undefined}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
