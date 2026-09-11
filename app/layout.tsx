import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Nav, TabBar } from "./nav";

export const metadata: Metadata = {
  title: "Wallet Tracker",
  description: "Read-only crypto holdings, mining income, and purchase log.",
  robots: "noindex, nofollow",
  manifest: "/manifest.webmanifest",
  // Installable on iPhone and iPad from Share → Add to Home Screen. Opens
  // full-screen with its own icon, no browser chrome.
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Wallet" },
  icons: { icon: "/icon.svg", apple: "/apple-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  // Lets the layout extend under the notch and home indicator; the CSS then
  // pads with env(safe-area-inset-*) so nothing hides behind them.
  viewportFit: "cover",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body>
      <header className="border-b border-neutral-800 bg-neutral-950/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 min-h-12 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex items-center gap-2 font-semibold text-neutral-100 whitespace-nowrap"><span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--series-1)" }} />Wallet Tracker <span className="muted font-normal hidden sm:inline">· read-only</span></div>
          <Nav />
          {/* The header nav (and its sign-out) hides on phones; keep a way out. */}
          <a href="/logout" className="sm:hidden text-xs text-neutral-500">Sign out</a>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
      <TabBar />
    </body></html>
  );
}
