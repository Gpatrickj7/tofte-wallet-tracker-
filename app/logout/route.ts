import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth";
export async function GET(req: Request) {
  (await cookies()).set(COOKIE, "", { path: "/", maxAge: 0 });
  return NextResponse.redirect(new URL("/login", req.url));
}
