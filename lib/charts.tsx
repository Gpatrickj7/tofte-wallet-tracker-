"use client";
// Inline SVG charts, no dependencies. Every chart ships a hover tooltip, a
// keyboard-reachable equivalent, and a table view, so nothing is readable only
// by pointer or only by color.
//
// Marks follow one spec: bars at most 24px thick with a 4px rounded data-end and
// a square baseline, 2px lines, hairline solid gridlines, and text always in the
// text tokens (never the series color). Colors come from CSS variables set in
// globals.css so the whole palette lives in one place.
import { useId, useState, type ReactNode } from "react";

export type Point = { label: string; value: number; sub?: string };
type Fmt = (n: number) => string;

// ── shared ────────────────────────────────────────────────────────────────

/** Clean tick values: 0 and four rounded steps that cover the max. */
function ticks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  // The top tick must sit at or above the max, or the tallest mark and its
  // label run past the plot and get clipped.
  const out: number[] = [];
  for (let v = 0; v < max; v += step) out.push(v);
  out.push(out.length ? out[out.length - 1] + step : step);
  return out;
}
const compact = (n: number) => Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + "M" : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "K" : n.toFixed(0);
export const fmtCompactUsd: Fmt = (n) => "$" + compact(n);

function Tooltip({ x, y, w, children }: { x: number; y: number; w: number; children: ReactNode }) {
  // Flip to the left half when near the right edge so it never leaves the card.
  const left = x > w * 0.6;
  return (
    <div className="chart-tip" style={{ left: `${x}%`, top: `${y}%`, transform: left ? "translate(-100%, -100%) translateX(-8px)" : "translate(8px, -100%)" }} role="status">
      {children}
    </div>
  );
}

function TableView({ caption, rows, fmt }: { caption: string; rows: Point[]; fmt: Fmt }) {
  return (
    <details className="chart-table">
      <summary>Table view</summary>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead><tr><th>Label</th><th className="num">Value</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td>{r.label}{r.sub ? <span className="muted"> · {r.sub}</span> : null}</td><td className="num">{fmt(r.value)}</td></tr>)}</tbody>
      </table>
    </details>
  );
}

// ── Columns: a value per period, e.g. income by month ─────────────────────

export function Columns({ data, fmt = fmtCompactUsd, title, height = 180 }: { data: Point[]; fmt?: Fmt; title: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  if (!data.length) return <p className="muted text-xs">No data yet.</p>;
  const W = 640, PAD_L = 44, PAD_R = 12, PAD_T = 18, PAD_B = 28;
  const H = height;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const max = Math.max(...data.map((d) => d.value), 0);
  const tk = ticks(max);
  const top = tk[tk.length - 1] || 1;
  const y = (v: number) => PAD_T + plotH - (v / top) * plotH;
  const slot = plotW / data.length;
  const bw = Math.min(24, slot * 0.6);
  const peak = data.reduce((m, d, i) => (d.value > data[m].value ? i : m), 0);
  // Label every bar when there is room, otherwise every nth.
  const every = Math.max(1, Math.ceil(data.length / 8));
  return (
    <figure className="chart" aria-labelledby={id}>
      <figcaption id={id} className="sr-only">{title}</figcaption>
      <div className="chart-plot" onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-hidden="true">
          {tk.map((t) => (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} className={t === 0 ? "chart-axis" : "chart-grid"} />
              <text x={PAD_L - 6} y={y(t)} className="chart-tick" textAnchor="end" dominantBaseline="middle">{fmt(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = PAD_L + slot * i + slot / 2;
            const h = Math.max(0, (d.value / top) * plotH);
            const x = cx - bw / 2;
            const yTop = y(d.value);
            const r = Math.min(4, h);
            // Rounded at the data end, square at the baseline.
            const path = h <= 0 ? "" : `M${x},${yTop + r} a${r},${r} 0 0 1 ${r},-${r} h${bw - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - r} h-${bw} z`;
            const lit = hover === i;
            return (
              <g key={i} onPointerMove={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${d.label}: ${fmt(d.value)}`}>
                <rect x={PAD_L + slot * i} y={PAD_T} width={slot} height={plotH} fill="transparent" />
                <path d={path} className="chart-bar" style={{ opacity: hover === null || lit ? 1 : 0.55 }} />
                {i === peak && d.value > 0 && <text x={cx} y={yTop - 5} className="chart-label" textAnchor="middle">{fmt(d.value)}</text>}
                {i % every === 0 && <text x={cx} y={H - PAD_B + 16} className="chart-tick" textAnchor="middle">{d.label}</text>}
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <Tooltip x={((PAD_L + slot * hover + slot / 2) / W) * 100} y={(y(data[hover].value) / H) * 100} w={100}>
            <strong>{fmt(data[hover].value)}</strong><span>{data[hover].label}{data[hover].sub ? ` · ${data[hover].sub}` : ""}</span>
          </Tooltip>
        )}
      </div>
      <TableView caption={title} rows={data} fmt={fmt} />
    </figure>
  );
}

// ── Line: a running total over time, e.g. cumulative income ───────────────

export function Line({ data, fmt = fmtCompactUsd, title, height = 180 }: { data: Point[]; fmt?: Fmt; title: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  if (data.length < 2) return <p className="muted text-xs">Needs at least two points.</p>;
  const W = 640, PAD_L = 44, PAD_R = 64, PAD_T = 18, PAD_B = 28;
  const H = height;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const max = Math.max(...data.map((d) => d.value), 0);
  const tk = ticks(max);
  const top = tk[tk.length - 1] || 1;
  const x = (i: number) => PAD_L + (i / (data.length - 1)) * plotW;
  const y = (v: number) => PAD_T + plotH - (v / top) * plotH;
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const area = `M${x(0)},${y(0)} L${pts.replace(/ /g, " L")} L${x(data.length - 1)},${y(0)} Z`;
  const last = data[data.length - 1];
  const every = Math.max(1, Math.ceil(data.length / 6));
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PAD_L) / plotW) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };
  return (
    <figure className="chart" aria-labelledby={id}>
      <figcaption id={id} className="sr-only">{title}</figcaption>
      <div className="chart-plot" onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-hidden="true" onPointerMove={onMove}>
          {tk.map((t) => (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} className={t === 0 ? "chart-axis" : "chart-grid"} />
              <text x={PAD_L - 6} y={y(t)} className="chart-tick" textAnchor="end" dominantBaseline="middle">{fmt(t)}</text>
            </g>
          ))}
          {data.map((d, i) => i % every === 0 && <text key={i} x={x(i)} y={H - PAD_B + 16} className="chart-tick" textAnchor="middle">{d.label}</text>)}
          <path d={area} className="chart-area" />
          <polyline points={pts} className="chart-line" fill="none" />
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + plotH} className="chart-crosshair" />}
          {/* End marker with a surface ring, and the end value as the one direct label. */}
          <circle cx={x(data.length - 1)} cy={y(last.value)} r={6} className="chart-ring" />
          <circle cx={x(data.length - 1)} cy={y(last.value)} r={4} className="chart-dot" />
          <text x={x(data.length - 1) + 10} y={y(last.value)} className="chart-label" dominantBaseline="middle">{fmt(last.value)}</text>
          {hover !== null && <><circle cx={x(hover)} cy={y(data[hover].value)} r={6} className="chart-ring" /><circle cx={x(hover)} cy={y(data[hover].value)} r={4} className="chart-dot" /></>}
        </svg>
        {hover !== null && (
          <Tooltip x={(x(hover) / W) * 100} y={(y(data[hover].value) / H) * 100} w={100}>
            <strong>{fmt(data[hover].value)}</strong><span>{data[hover].label}{data[hover].sub ? ` · ${data[hover].sub}` : ""}</span>
          </Tooltip>
        )}
      </div>
      <TableView caption={title} rows={data} fmt={fmt} />
    </figure>
  );
}

// ── HBars: named things compared by size, e.g. allocation ─────────────────

export function HBars({ data, fmt = fmtCompactUsd, title, total }: { data: Point[]; fmt?: Fmt; title: string; total?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  if (!data.length) return <p className="muted text-xs">No data yet.</p>;
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  return (
    <figure className="chart" aria-labelledby={id}>
      <figcaption id={id} className="sr-only">{title}</figcaption>
      <div className="hbars" onPointerLeave={() => setHover(null)}>
        {data.map((d, i) => {
          const pct = (d.value / max) * 100;
          const share = total ? (d.value / total) * 100 : null;
          return (
            <div key={i} className="hbar-row" onPointerMove={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${d.label}: ${fmt(d.value)}`} style={{ opacity: hover === null || hover === i ? 1 : 0.55 }}>
              <div className="hbar-label">{d.label}{d.sub ? <span className="muted"> {d.sub}</span> : null}</div>
              <div className="hbar-track"><div className="hbar-fill" style={{ width: `${pct}%` }} /></div>
              <div className="hbar-value">{fmt(d.value)}{share != null ? <span className="muted"> {share.toFixed(1)}%</span> : null}</div>
            </div>
          );
        })}
      </div>
      <TableView caption={title} rows={data} fmt={fmt} />
    </figure>
  );
}

// ── Stacked: one bar split by category, e.g. holdings by chain ────────────

export function Stacked({ data, fmt = fmtCompactUsd, title }: { data: Point[]; fmt?: Fmt; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!data.length || total <= 0) return <p className="muted text-xs">No data yet.</p>;
  // Past eight categories fold the tail into Other so no ninth hue is ever needed.
  const shown = data.length > 8 ? [...data.slice(0, 7), { label: "Other", value: data.slice(7).reduce((s, d) => s + d.value, 0) }] : data;
  return (
    <figure className="chart" aria-labelledby={id}>
      <figcaption id={id} className="sr-only">{title}</figcaption>
      <div className="stacked" onPointerLeave={() => setHover(null)}>
        {shown.map((d, i) => (
          <div key={i} className="stacked-seg" data-slot={i + 1} style={{ flexBasis: `${(d.value / total) * 100}%`, opacity: hover === null || hover === i ? 1 : 0.55 }} onPointerMove={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${d.label}: ${fmt(d.value)}`} title={`${d.label}: ${fmt(d.value)}`} />
        ))}
      </div>
      <ul className="legend">
        {shown.map((d, i) => (
          <li key={i} style={{ opacity: hover === null || hover === i ? 1 : 0.55 }}><span className="swatch" data-slot={i + 1} />{d.label} <span className="muted">{((d.value / total) * 100).toFixed(1)}%</span></li>
        ))}
      </ul>
      <TableView caption={title} rows={shown} fmt={fmt} />
    </figure>
  );
}

// ── Meter: progress toward a limit, same-ramp track ───────────────────────

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <div className="meter-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
