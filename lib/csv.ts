export function csv(headers: string[], rows: (string | number | null)[][], name: string) {
  const esc = (v: string | number | null) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const body = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  return new Response(body, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${name}"` } });
}
