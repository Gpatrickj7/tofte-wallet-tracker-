import { NextRequest, NextResponse } from "next/server";
import { COOKIE, creds, expectedToken } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login") return NextResponse.next();

  const expected = await expectedToken();
  if (!expected) return new NextResponse("DASH_USER / DASH_PASS are not set on the server.", { status: 500 });

  // Cookie session (browser) or Basic auth (curl / scripts).
  if (req.cookies.get(COOKIE)?.value === expected) return NextResponse.next();
  const h = req.headers.get("authorization") ?? "";
  if (h.startsWith("Basic ")) {
    const d = atob(h.slice(6)); const i = d.indexOf(":");
    const { user, pass } = creds();
    if (d.slice(0, i).trim() === user && d.slice(i + 1).trim() === pass) return NextResponse.next();
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}
// The manifest and icons are fetched by the browser without a session when
// the app is installed to a home screen, so they stay public. Everything
// else needs a login.
export const config = {
  matcher: ["/((?!_vercel|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.svg|icon-192.png|icon-512.png|apple-icon.png).*)"],
};
