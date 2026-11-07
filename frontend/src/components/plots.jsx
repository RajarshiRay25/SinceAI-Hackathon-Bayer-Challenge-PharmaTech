// Hand-drawn plot pieces shared by the symptom and condition charts.
import { C } from "../lib/chart.js";
import { fmtOR } from "../lib/format.js";

export const SIGNAL = { higher: C.pos, lower: C.neg, ns: C.ns };
export const SIGNAL_LABEL = { higher: "Higher odds", lower: "Lower odds", ns: "Not significant" };
export const OR_TICKS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];

export const tint = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
export const fmtX = (v) => (v == null ? "–" : `${fmtOR(v)}×`);
export const fmtOrTick = (v) => (v < 1 ? v : `${v}×`);

/** Log scale (0–100%) covering every interval, always including 0.5–2 around "no link". */
export function oddsScale(rows) {
  const lo = Math.min(0.5, ...rows.map((s) => s.ci_low).filter((v) => v > 0)) * 0.85;
  const hi = Math.max(2, ...rows.map((s) => s.ci_high)) * 1.15;
  const x = (v) => Math.min(100, Math.max(0, ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * 100));
  return { x, ticks: OR_TICKS.filter((t) => t >= lo && t <= hi) };
}

/** Background for an odds plot: blue on the "lower" side of 1, orange on the "higher" side. */
export const oddsZones = (one) =>
  `linear-gradient(90deg, ${tint(C.neg, 9)} 0%, ${tint(C.neg, 2)} ${one}%, ${tint(C.pos, 2)} ${one}%, ${tint(C.pos, 11)} 100%)`;

/**
 * Gridlines, tinted zones, a reference line and axis ticks, drawn once behind all rows.
 * `row` is the grid template the rows use; the plot is always its second column.
 */
export function PlotFrame({ row, x, ticks, fmt, zones, refValue, refLabel, bodyClass = "grid gap-0.5", bodyStyle, children }) {
  return (
    <div className="relative">
      <div aria-hidden="true" className={`pointer-events-none absolute inset-0 ${row}`}>
        <span />
        <div className="relative h-full" style={zones ? { background: zones } : undefined}>
          {ticks.map((t) => (
            <div key={t} className="absolute inset-y-0 w-px bg-line" style={{ left: `${x(t)}%` }} />
          ))}
          {refValue != null && (
            <>
              <div className="absolute inset-y-0 border-l-2 border-dashed border-ink-3/60" style={{ left: `${x(refValue)}%` }} />
              <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-full bg-surface px-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3 ring-1 ring-line"
                style={{ left: `${x(refValue)}%` }}>{refLabel}</span>
            </>
          )}
        </div>
      </div>
      <div className="relative pt-6">
        <div className={`relative ${bodyClass}`} style={bodyStyle}>{children}</div>
      </div>
      <div aria-hidden="true" className={`${row} mt-1`}>
        <span />
        <div className="relative h-4">
          {ticks.map((t) => (
            <span key={t} className="num absolute -translate-x-1/2 text-[11px] text-ink-3" style={{ left: `${x(t)}%` }}>{fmt(t)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Interval capsule plus point estimate for one row of an odds plot; grows out from "no link" on first paint. */
export function OddsMark({ s, x, mounted, active, delay = 0 }) {
  const color = SIGNAL[s.signal];
  const one = x(1);
  return (
    <>
      <span className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full transition-all duration-700 ease-out-soft"
        style={{
          left: `${mounted ? x(s.ci_low) : one}%`, right: `${100 - (mounted ? x(s.ci_high) : one)}%`,
          background: `linear-gradient(90deg, ${tint(color, 25)}, ${tint(color, 55)})`, transitionDelay: `${delay}ms`,
        }} />
      <span className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-surface transition-all duration-700 ease-out-soft group-hover:scale-125"
        style={{
          left: `${mounted ? x(s.or) : one}%`, background: color, transitionDelay: `${delay}ms`,
          boxShadow: active ? `0 0 0 5px ${tint(color, 25)}` : "none",
        }} />
    </>
  );
}

export const OrPill = ({ s, active }) => (
  <span className="num inline-block rounded-full px-2 py-0.5 text-[12px] font-bold text-ink"
    style={{ background: tint(SIGNAL[s.signal], active ? 34 : 20) }}>{fmtX(s.or)}</span>
);
