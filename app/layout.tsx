import "./globals.css";
import { Nav } from "./nav";
export const metadata = { title: "Wallet Tracker", description: "Read-only crypto holdings, mining income, and purchase log.", robots: "noindex, nofollow" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body>
      <header className="border-b border-neutral-800 bg-neutral-950/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 min-h-12 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex items-center gap-2 font-semibold text-neutral-100 whitespace-nowrap"><span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--series-1)" }} />Wallet Tracker <span className="muted font-normal hidden sm:inline">· read-only</span></div>
          <Nav />
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </body></html>
  );
}
