import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, creds, expectedToken } from "@/lib/auth";
export const dynamic = "force-dynamic";

async function login(fd: FormData) {
  "use server";
  const { user, pass } = creds();
  const u = String(fd.get("user") ?? "").trim();
  const p = String(fd.get("pass") ?? "").trim();
  const next = String(fd.get("next") ?? "/");
  const token = await expectedToken();
  if (!token) redirect("/login?e=unconfigured");
  if (u !== user || p !== pass) redirect("/login?e=bad");
  (await cookies()).set(COOKIE, token!, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  redirect(next.startsWith("/") ? next : "/");
}

export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string; next?: string }> }) {
  const { e, next } = await searchParams;
  const { user, pass } = creds();
  return (
    <div className="max-w-xs mx-auto mt-16 card">
      <h1 className="mb-1">Sign in</h1>
      <p className="muted text-xs mb-3">The username and password you set as DASH_USER and DASH_PASS.</p>
      {!user || !pass ? <p className="err mb-2">DASH_USER and DASH_PASS are not set. Add both to .env.local (local) or your host&apos;s environment variables (deployed), then restart or redeploy. Until then nobody can sign in, by design.</p> : null}
      {e === "bad" && <p className="err mb-2">Wrong username or password. Check .env.local or your host&apos;s environment variables.</p>}
      {e === "unconfigured" && <p className="err mb-2">DASH_USER and DASH_PASS are not set on the server.</p>}
      <form action={login} className="flex flex-col gap-2">
        <input type="hidden" name="next" value={next ?? "/"} />
        <input name="user" placeholder="Username" autoComplete="username" required autoFocus />
        <input name="pass" type="password" placeholder="Password" autoComplete="current-password" required />
        <button>Sign in</button>
      </form>
    </div>
  );
}
