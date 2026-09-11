// Single-user cookie session. Token = HMAC-SHA256(DASH_PASS, "wallet-tracker:" + DASH_USER), hex.
// Works in both the Edge middleware and Node server actions (Web Crypto only).
export const COOKIE = "wt_session";

export function creds() {
  return { user: (process.env.DASH_USER ?? "").trim(), pass: (process.env.DASH_PASS ?? "").trim() };
}

export async function expectedToken(): Promise<string | null> {
  const { user, pass } = creds();
  if (!user || !pass) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("wallet-tracker:" + user));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
