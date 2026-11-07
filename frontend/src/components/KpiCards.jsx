import { useState } from "react";
import { AnimatedNumber, ELEVATE } from "./ui.jsx";
import { fmtInt, fmtPct, fmtWeek } from "../lib/format.js";
import { useMounted } from "../lib/motion.js";

// Decorative tile colours (static class strings so Tailwind can see them).
const TONES = {
  blue: { tint: "from-hue-blue-soft", stripe: "from-hue-blue to-accent-2", badge: "bg-hue-blue" },
  coral: { tint: "from-hue-coral-soft", stripe: "from-hue-coral to-[#f6a23a]", badge: "bg-hue-coral" },
  violet: { tint: "from-hue-violet-soft", stripe: "from-hue-violet to-hue-blue", badge: "bg-hue-violet" },
  teal: { tint: "from-hue-teal-soft", stripe: "from-hue-teal to-neg", badge: "bg-hue-teal" },
};

const ICONS = {
  pct: <path d="M5 15 15 5M6.5 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm7 7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />,
  tests: <path d="M8 3h4M9 3v5.5L5 15.5A1.5 1.5 0 0 0 6.3 17.5h7.4a1.5 1.5 0 0 0 1.3-2L11 8.5V3M6.5 12.5h7" />,
  pos: <path d="M10 5v10M5 10h10" />,
  sym: <path d="M3 10h3l2-4 4 8 2-4h3" />,
};

function Stat({ label, value, visual, children, delay = 0, tone = "blue", icon }) {
  const t = TONES[tone];
  return (
    <div
      className={`group relative min-w-0 animate-rise overflow-hidden rounded-2xl border border-line bg-linear-to-br ${t.tint} to-surface to-60% p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-line-strong sm:p-5 ${ELEVATE}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={`absolute inset-x-0 top-0 h-1 bg-linear-to-r ${t.stripe}`} />
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`grid h-7 w-7 place-items-center rounded-lg text-white shadow-sm transition-transform duration-300 group-hover:rotate-[-6deg] group-hover:scale-110 ${t.badge}`}>
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[icon]}</svg>
          </span>
          <div className="text-[12px] font-bold uppercase tracking-wider text-ink-3">{label}</div>
        </div>
        {visual?.corner}
      </div>
      <div className="mt-2.5 text-[30px] font-bold leading-none tracking-tight tabular-nums sm:text-[34px]">{value}</div>
      {visual?.below}
      {children && <div className="mt-2 text-[13px] text-ink-2">{children}</div>}
    </div>
  );
}

const COMPARE = {
  above: { text: "Above all tests", cls: "bg-pos-soft text-ink", arrow: "▲" },
  below: { text: "Below all tests", cls: "bg-neg-soft text-ink", arrow: "▼" },
  same: { text: "In line with all tests", cls: "bg-accent-soft text-accent", arrow: "●" },
};

/** Positivity on a 0–max track: shaded 95% CI, a dot for the estimate, a tick for all tests. */
function CiGauge({ k }) {
  const max = Math.max(k.ci_high ?? 0, k.overall_pct ?? 0) * 1.3 || 1;
  const x = (v) => `${Math.min(100, ((v ?? 0) / max) * 100)}%`;
  return (
    <div className="relative mt-3 h-2 rounded-full bg-surface ring-1 ring-line" title={`95% CI ${fmtPct(k.ci_low)}–${fmtPct(k.ci_high)}`}>
      <div className="absolute inset-y-0 rounded-full bg-pos-soft transition-all duration-500 ease-out-soft" style={{ left: x(k.ci_low), right: `calc(100% - ${x(k.ci_high)})` }} />
      <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-pos transition-all duration-500 ease-out-soft group-hover:scale-125" style={{ left: x(k.pct) }} />
      <div className="absolute -top-1 h-4 w-px bg-ink-3" style={{ left: x(k.overall_pct) }} title={`All tests ${fmtPct(k.overall_pct)}`} />
    </div>
  );
}

/** Weekly test volume as a hoverable sparkline. */
function Sparkline({ weekly }) {
  const [hover, setHover] = useState(null);
  const pts = weekly.filter((w) => w.tests > 0);
  if (pts.length < 2) return null;
  const W = 100, H = 28, max = Math.max(...pts.map((w) => w.tests));
  const xy = pts.map((w, i) => [(i / (pts.length - 1)) * W, H - (w.tests / max) * (H - 3) - 1.5]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join("");
  const h = hover == null ? null : pts[hover];
  return (
    <div className="relative mt-3">
      <svg
        viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-7 w-full overflow-visible"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1)));
        }}
        onMouseLeave={() => setHover(null)}
        role="img" aria-label="Tests per week"
      >
        <defs>
          <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--neg)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--neg)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line}L${W},${H}L0,${H}Z`} fill="url(#spark-fill)" />
        <path d={line} fill="none" stroke="var(--neg)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        {hover != null && <line x1={xy[hover][0]} x2={xy[hover][0]} y1="0" y2={H} stroke="var(--ink-3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
      {h && (
        <div style={{ left: `${Math.min(80, Math.max(20, xy[hover][0]))}%` }} className="pointer-events-none absolute -top-7 -translate-x-1/2 animate-fade-in whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[11px] text-bg">
          {fmtWeek(h.week)} · <span className="num">{fmtInt(h.tests)}</span>
        </div>
      )}
    </div>
  );
}

/** Positive vs negative share as one split bar that grows in. */
function SplitBar({ pos, neg }) {
  const mounted = useMounted();
  const share = pos + neg ? (pos / (pos + neg)) * 100 : 0;
  return (
    <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full bg-surface" title={`${fmtPct(share)} positive`}>
      <div className="rounded-full bg-pos transition-[width] duration-700 ease-out-soft" style={{ width: mounted ? `${Math.max(share, 1.5)}%` : 0 }} />
      <div className="flex-1 rounded-full bg-neg-soft" />
    </div>
  );
}

/** Small ring that fills to a percentage. */
function Ring({ pct }) {
  const mounted = useMounted();
  const r = 13, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 32 32" className="-mt-1 h-9 w-9 -rotate-90 transition-transform duration-300 group-hover:scale-110" aria-hidden="true">
      <circle cx="16" cy="16" r={r} fill="none" stroke="var(--line)" strokeWidth="4" />
      <circle cx="16" cy="16" r={r} fill="none" stroke="var(--hue-teal)" strokeWidth="4" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={mounted ? c * (1 - (pct ?? 0) / 100) : c}
        className="transition-[stroke-dashoffset] duration-700 ease-out-soft" />
    </svg>
  );
}

export default function KpiCards({ k, weekly = [], filtered }) {
  const c = COMPARE[k.compare] ?? COMPARE.same;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      <Stat label="Positivity" tone="blue" icon="pct" value={<AnimatedNumber value={k.pct} format={(v) => fmtPct(v)} />} visual={{ below: <CiGauge k={k} /> }}>
        <span className="num text-[12px]">95% CI {fmtPct(k.ci_low)}–{fmtPct(k.ci_high)}</span>
        {filtered && (
          <span key={k.compare} className={`mt-1.5 flex w-fit animate-fade-in items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold ${c.cls}`}>
            <span aria-hidden="true" className="text-[9px]">{c.arrow}</span>
            {c.text} ({fmtPct(k.overall_pct)})
          </span>
        )}
      </Stat>
      <Stat label="Tests" tone="violet" icon="tests" delay={60} value={<AnimatedNumber value={k.tests} format={fmtInt} />} visual={{ below: <Sparkline weekly={weekly} /> }}>
        over {k.weeks} report weeks
      </Stat>
      <Stat label="Positive" tone="coral" icon="pos" delay={120} value={<AnimatedNumber value={k.positives} format={fmtInt} />} visual={{ below: <SplitBar pos={k.positives} neg={k.negatives} /> }}>
        {fmtInt(k.negatives)} negative
      </Stat>
      <Stat label="Symptomatic" tone="teal" icon="sym" delay={180} value={<AnimatedNumber value={k.symptomatic_pct} format={(v) => fmtPct(v, 1)} />} visual={{ corner: <Ring pct={k.symptomatic_pct} /> }}>
        of patients at testing
      </Stat>
    </div>
  );
}
