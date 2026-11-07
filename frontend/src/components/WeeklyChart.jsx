import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area, AreaChart, Bar, Brush, CartesianGrid, Cell, ComposedChart, Customized, Line, ReferenceDot, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AnimatedNumber, Card, Hint, Legend, Segmented, TipBox } from "./ui.jsx";
import { C, axisLine, grid, niceAxis, pctTick, tick } from "../lib/chart.js";
import { fmtCI, fmtInt, fmtPct, fmtWeek, toggle } from "../lib/format.js";
import { useChartAnim, useReducedMotion } from "../lib/motion.js";

// weeks with fewer tests than this are too noisy to call a peak
const PEAK_MIN_TESTS = 50;
const TREND_WEEKS = 3;
const Y_WIDTH = 52;

const K = { line: "Weekly positivity", ci: "95% CI", trend: `${TREND_WEEKS}-week trend`, pos: "Positive", neg: "Negative" };

const hairline = { stroke: "var(--accent)", strokeWidth: 1, strokeDasharray: "3 3" };
const fmtPts = (d) => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d).toFixed(2)} pts`;
const fmtRel = (d) => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d).toFixed(0)}%`;

function WeekTip({ active, payload, mode }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (!d.tests) return <TipBox title={`Week of ${d.label}`} rows={[["Tests", "0"]]} />;
  const pos = [["Positivity", fmtPct(d.pct), C.pos], ["95% CI", fmtCI(d.ci_low, d.ci_high)], [K.trend, fmtPct(d.trend), C.accent]];
  const tests = [["Positive", fmtInt(d.positives), C.pos], ["Negative", fmtInt(d.negatives), C.neg], ["Tests", fmtInt(d.tests)]];
  return <TipBox title={`Week of ${d.label}`} rows={mode === "tests" ? tests : mode === "both" ? [pos[0], ...tests] : pos} />;
}

/**
 * Gradients split at the all-tests line: the positivity line is orange above it and blue below.
 * Rendered through <Customized> so it can read the chart's own y scale.
 */
function SplitDefs({ yAxisMap, offset, value }) {
  const axis = yAxisMap && Object.values(yAxisMap)[0];
  if (!axis?.scale || !offset || value == null) return null;
  const t = Math.min(1, Math.max(0, (axis.scale(value) - offset.top) / offset.height));
  const span = { gradientUnits: "userSpaceOnUse", x1: 0, x2: 0, y1: offset.top, y2: offset.top + offset.height };
  return (
    <defs>
      <linearGradient id="wk-line" {...span}>
        <stop offset={0} stopColor={C.pos} /><stop offset={t} stopColor={C.pos} />
        <stop offset={t} stopColor={C.neg} /><stop offset={1} stopColor={C.neg} />
      </linearGradient>
      <linearGradient id="wk-fill" {...span}>
        <stop offset={0} stopColor={C.pos} stopOpacity={0.34} /><stop offset={t} stopColor={C.pos} stopOpacity={0.08} />
        <stop offset={t} stopColor={C.neg} stopOpacity={0.12} /><stop offset={1} stopColor={C.neg} stopOpacity={0.02} />
      </linearGradient>
    </defs>
  );
}

/** Hovered point: solid dot with a ring that ripples outward. */
function PulseDot({ cx, cy, fill, reduced }) {
  if (cx == null || cy == null) return null;
  return (
    <g>
      {!reduced && (
        <circle cx={cx} cy={cy} r={6} fill={fill} opacity={0.3}>
          <animate attributeName="r" from="6" to="18" dur="1.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.35" to="0" dur="1.2s" repeatCount="indefinite" />
        </circle>
      )}
      <circle cx={cx} cy={cy} r={6.5} fill={fill} stroke="var(--surface)" strokeWidth={2.5} />
    </g>
  );
}

/** Rounded callout that sits above a ReferenceDot. */
function Badge({ viewBox, text, color = "var(--accent)" }) {
  if (!viewBox) return null;
  const x = viewBox.x + (viewBox.width ?? 0) / 2, y = viewBox.y;
  const w = text.length * 6.3 + 16;
  return (
    <g transform={`translate(${x},${y - 8})`} style={{ pointerEvents: "none" }}>
      <rect x={-w / 2} y={-20} width={w} height={19} rx={9.5} fill={color} />
      <path d="M-4 -1.5 0 3 4 -1.5Z" fill={color} />
      <text y={-7} textAnchor="middle" fill="#fff" fontSize={11} fontWeight={700}>{text}</text>
    </g>
  );
}

/** Change vs the prior week. Rising positivity is warm; `neutral` is for measures that are neither good nor bad. */
function Delta({ value, fmt, neutral = false }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-[12px] text-ink-3">no prior week</span>;
  const up = value > 0, flat = Math.abs(value) < 0.005;
  const cls = flat ? "bg-bg text-ink-3" : neutral ? "bg-surface text-accent" : up ? "bg-pos-soft text-ink" : "bg-neg-soft text-ink";
  return (
    <span key={Math.sign(value)} className={`num inline-flex animate-pop items-center gap-1 rounded-full px-1.5 py-0.5 text-[11.5px] font-semibold ${cls}`}>
      <span aria-hidden="true" className="text-[8px]">{flat ? "●" : up ? "▲" : "▼"}</span>
      {fmt(value)}
    </span>
  );
}

/** Live readout for the hovered, pinned or latest week. */
function FocusPanel({ d, prev, state, mode, overallPct, onUnpin }) {
  if (!d) return null;
  const stat = (key, label, value, sub, extra) => (
    <div className={`min-w-0 rounded-xl px-3 py-2 transition-colors duration-300 ${mode === key || (mode === "both" && key) ? "bg-surface shadow-sm ring-1 ring-accent/20" : ""}`}>
      <div className="text-[11px] font-bold uppercase tracking-wider text-ink-3">{label}</div>
      <div className="num mt-0.5 text-[22px] font-bold leading-tight tracking-tight">{value}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">{sub}{extra}</div>
    </div>
  );
  const vsAll = d.pct == null ? null : d.pct - overallPct;
  return (
    <div className="mb-3 grid gap-2 rounded-2xl bg-linear-to-r from-accent-soft via-accent-soft/50 to-transparent p-2 sm:grid-cols-[auto_1fr]">
      <div className="flex items-center gap-2 px-2 sm:flex-col sm:items-start sm:justify-center sm:border-r sm:border-line sm:pr-4">
        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ${
          state === "pinned" ? "bg-accent text-white" : state === "hover" ? "bg-surface text-accent" : "bg-surface text-ink-3"}`}>
          {state === "pinned" ? "Pinned" : state === "hover" ? "Hovering" : "Latest"}
        </span>
        <div key={d.week} className="animate-fade-in">
          <div className="text-[11px] text-ink-3">Week of</div>
          <div className="text-[17px] font-extrabold leading-tight">{d.label}</div>
        </div>
        {state === "pinned" && (
          <button onClick={onUnpin} className="text-[12px] font-semibold text-accent underline underline-offset-2">unpin</button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1 lg:grid-cols-4">
        {stat("positivity", "Positivity", <AnimatedNumber value={d.pct} format={(v) => fmtPct(v)} duration={350} />,
          <Delta value={prev && d.pct != null && prev.pct != null ? d.pct - prev.pct : null} fmt={fmtPts} />)}
        {stat("tests", "Tests", <AnimatedNumber value={d.tests} format={fmtInt} duration={350} />,
          <Delta value={prev?.tests ? ((d.tests - prev.tests) / prev.tests) * 100 : null} fmt={fmtRel} neutral />)}
        {stat(null, "Positive", <AnimatedNumber value={d.positives} format={fmtInt} duration={350} />,
          <span className="text-[12px] text-ink-3">of {fmtInt(d.tests)} tests</span>)}
        {stat(null, "vs all tests", vsAll == null ? "–" : fmtPts(vsAll),
          <span className="text-[12px] text-ink-3">all tests {fmtPct(overallPct)}</span>)}
      </div>
    </div>
  );
}

export default function WeeklyChart({ weekly, weeks, filters, setFilters, overallPct }) {
  const [mode, setMode] = useState("positivity");
  const [hidden, setHidden] = useState([K.trend]);
  const [spot, setSpot] = useState(null);
  const [hoverWeek, setHoverWeek] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [dragging, setDragging] = useState(false);
  const baseAnim = useChartAnim();
  const reduced = useReducedMotion();
  const anim = dragging ? { isAnimationActive: false } : baseAnim;

  // every week appears, even ones with no tests under the current filters
  const data = useMemo(() => {
    const byWeek = Object.fromEntries(weekly.map((w) => [w.week, w]));
    const rows = weeks.map((w) => {
      const r = byWeek[w];
      return r
        ? { ...r, label: fmtWeek(w), band: [r.ci_low, r.ci_high], negatives: r.tests - r.positives }
        : { week: w, label: fmtWeek(w), tests: 0, positives: 0, negatives: 0, pct: null, band: null };
    });
    // pooled trailing trend: positives / tests over the last few weeks (not a mean of weekly rates)
    return rows.map((r, i) => {
      const win = rows.slice(Math.max(0, i - TREND_WEEKS + 1), i + 1);
      const t = win.reduce((s, w) => s + w.tests, 0), p = win.reduce((s, w) => s + w.positives, 0);
      return { ...r, trend: t && r.tests ? (p / t) * 100 : null };
    });
  }, [weekly, weeks]);

  const start = filters.week_from ? Math.max(0, weeks.indexOf(filters.week_from)) : 0;
  const end = filters.week_to ? Math.max(0, weeks.indexOf(filters.week_to)) : weeks.length - 1;
  const view = useMemo(() => data.slice(start, end + 1), [data, start, end]);

  const peaks = useMemo(() => {
    const top = (key, min) => {
      const pool = view.filter((d) => d.tests >= min && d[key] != null);
      return pool.length ? pool.reduce((m, d) => (d[key] > m[key] ? d : m)) : null;
    };
    return { pct: top("pct", PEAK_MIN_TESTS), tests: top("tests", 1) };
  }, [view]);

  const pctAx = niceAxis(Math.max(overallPct, ...view.map((d) => (hidden.includes(K.ci) ? d.pct : d.ci_high) ?? 0)));
  const avgTests = useMemo(() => {
    const w = view.filter((d) => d.tests > 0);
    return w.length ? w.reduce((s, d) => s + d.tests, 0) / w.length : 0;
  }, [view]);

  // focus: pinned week, else hovered, else the latest week with tests in the range
  const withTests = view.filter((d) => d.tests > 0);
  const focusWeek = pinned ?? hoverWeek ?? withTests[withTests.length - 1]?.week;
  const fi = data.findIndex((d) => d.week === focusWeek);
  const focus = data[fi];
  const prev = fi > 0 ? data.slice(0, fi).reverse().find((d) => d.tests > 0) : null;
  const focusState = pinned ? "pinned" : hoverWeek ? "hover" : "latest";
  const pinnedLabel = pinned && data.find((d) => d.week === pinned)?.label;
  const hoverLabel = hoverWeek && data.find((d) => d.week === hoverWeek)?.label;

  // Re-create the brush only when the week range is changed from outside (e.g. "Clear"),
  // never while the user is dragging it.
  const emitted = useRef({ from: filters.week_from, to: filters.week_to });
  const [brushKey, setBrushKey] = useState(0);
  useEffect(() => {
    if (emitted.current.from !== filters.week_from || emitted.current.to !== filters.week_to) {
      emitted.current = { from: filters.week_from, to: filters.week_to };
      setBrushKey((k) => k + 1);
    }
  }, [filters.week_from, filters.week_to]);

  const onBrush = ({ startIndex, endIndex }) => {
    const from = startIndex === 0 ? null : weeks[startIndex];
    const to = endIndex === weeks.length - 1 ? null : weeks[endIndex];
    emitted.current = { from, to };
    setDragging(true);
    setFilters((f) => (f.week_from === from && f.week_to === to ? f : { ...f, week_from: from, week_to: to }));
  };

  const pointer = {
    onMouseMove: (s) => setHoverWeek(s?.isTooltipActive ? s.activePayload?.[0]?.payload?.week ?? null : null),
    onMouseLeave: () => setHoverWeek(null),
    onClick: (s) => {
      const w = s?.activePayload?.[0]?.payload?.week;
      if (w) setPinned((p) => (p === w ? null : w));
    },
    style: { cursor: "pointer" },
  };

  // arrow keys step the pinned week through weeks that have tests
  const onKey = (e) => {
    if (e.key === "Escape") return setPinned(null);
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    if (!withTests.length) return;
    const i = withTests.findIndex((d) => d.week === focusWeek);
    const next = e.key === "ArrowLeft" ? Math.max(0, i - 1) : Math.min(withTests.length - 1, i + 1);
    setPinned(withTests[i < 0 ? withTests.length - 1 : next].week);
  };

  const toggleKey = (l) => setHidden((h) => toggle(h, l));
  const dim = (key) => (spot && spot !== key ? 0.3 : 1);
  const fade = (d) => (hoverWeek == null || d.week === hoverWeek || d.week === pinned ? 1 : 0.45);
  const markers = (
    <>
      {pinnedLabel && <ReferenceLine x={pinnedLabel} stroke="var(--accent)" strokeWidth={1.5} />}
      {mode === "both" && hoverLabel && <ReferenceLine x={hoverLabel} {...hairline} />}
    </>
  );

  const positivityPlot = (height, xAxis = true) => (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={view} margin={{ top: 30, right: 8, left: 0, bottom: 0 }} {...pointer}>
          <Customized component={<SplitDefs value={overallPct} />} />
          <defs>
            <filter id="wk-glow" x="-10%" y="-30%" width="120%" height="160%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <CartesianGrid {...grid} />
          {/* in "Both" the bars below use band spacing, so the line does too and the weeks line up */}
          <XAxis dataKey="label" hide={!xAxis} scale={xAxis ? "auto" : "band"} tick={tick} axisLine={axisLine} tickLine={false} minTickGap={24} />
          <YAxis tick={tick} axisLine={false} tickLine={false} width={Y_WIDTH} tickFormatter={pctTick} domain={pctAx.domain} ticks={pctAx.ticks} />
          <Tooltip content={<WeekTip mode="positivity" />} cursor={hairline} />
          {!hidden.includes(K.ci) && (
            <Area dataKey="band" stroke="none" fill={C.ink3} fillOpacity={0.13 * dim(K.ci)} connectNulls {...anim} tooltipType="none" activeDot={false} />
          )}
          {!hidden.includes(K.line) && (
            <Area dataKey="pct" stroke="none" fill="url(#wk-fill)" fillOpacity={dim(K.line)} connectNulls {...anim} tooltipType="none" activeDot={false} />
          )}
          <ReferenceLine
            y={overallPct} stroke={C.ink3} strokeDasharray="4 4"
            label={{ value: `All tests ${fmtPct(overallPct)}`, position: "insideBottomLeft", fill: "var(--ink-3)", fontSize: 11 }}
          />
          {!hidden.includes(K.trend) && (
            <Line dataKey="trend" stroke={C.accent} strokeWidth={2} strokeDasharray="6 4" strokeOpacity={dim(K.trend)}
              dot={false} activeDot={false} connectNulls {...anim} />
          )}
          {!hidden.includes(K.line) && (
            <Line
              dataKey="pct" stroke="url(#wk-line)" strokeWidth={spot === K.line ? 3.5 : 2.5} strokeOpacity={dim(K.line)}
              connectNulls filter="url(#wk-glow)" {...anim}
              dot={({ cx, cy, payload, index }) =>
                payload.pct == null ? <g key={index} /> : (
                  <circle key={index} cx={cx} cy={cy} r={payload.week === pinned ? 5 : 3}
                    fill={payload.pct > overallPct ? C.pos : C.neg} stroke="var(--surface)" strokeWidth={1.5}
                    opacity={fade(payload) * dim(K.line)} style={{ transition: "opacity .2s" }} />
                )}
              activeDot={(p) => <PulseDot {...p} reduced={reduced} fill={p.payload.pct > overallPct ? C.pos : C.neg} />}
            />
          )}
          {peaks.pct && !hidden.includes(K.line) && (
            <ReferenceDot x={peaks.pct.label} y={peaks.pct.pct} r={0} label={<Badge text={`Peak ${fmtPct(peaks.pct.pct, 1)}`} color={C.pos} />} />
          )}
          {markers}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );

  const testsPlot = (height) => (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={view} margin={{ top: mode === "both" ? 8 : 30, right: 8, left: 0, bottom: 0 }} barCategoryGap="18%" {...pointer}>
          <defs>
            <linearGradient id="wk-neg" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={C.neg} stopOpacity={1} />
              <stop offset="1" stopColor={C.neg} stopOpacity={0.6} />
            </linearGradient>
          </defs>
          <CartesianGrid {...grid} />
          <XAxis dataKey="label" tick={tick} axisLine={axisLine} tickLine={false} minTickGap={24} />
          <YAxis tick={tick} axisLine={false} tickLine={false} width={Y_WIDTH} tickFormatter={(v) => fmtInt(v)} />
          <Tooltip content={<WeekTip mode="tests" />} cursor={{ fill: "var(--accent)", fillOpacity: 0.06 }} />
          <Bar dataKey="positives" stackId="t" fill={C.pos} hide={hidden.includes(K.pos)} {...anim}
            radius={hidden.includes(K.neg) ? [4, 4, 0, 0] : 0}>
            {view.map((d) => <Cell key={d.week} fill={C.pos} fillOpacity={fade(d) * dim(K.pos)} style={{ transition: "fill-opacity .2s" }} />)}
          </Bar>
          <Bar dataKey="negatives" stackId="t" fill="url(#wk-neg)" hide={hidden.includes(K.neg)} radius={[4, 4, 0, 0]} {...anim}>
            {view.map((d) => <Cell key={d.week} fill="url(#wk-neg)" fillOpacity={fade(d) * dim(K.neg)} style={{ transition: "fill-opacity .2s" }} />)}
          </Bar>
          {avgTests > 0 && (
            <ReferenceLine
              y={avgTests} stroke={C.ink3} strokeDasharray="4 4"
              label={{ value: `Avg ${fmtInt(avgTests)} / week`, position: "insideTopLeft", fill: "var(--ink-3)", fontSize: 11 }}
            />
          )}
          {mode === "tests" && peaks.tests && (
            <ReferenceDot x={peaks.tests.label} y={peaks.tests.tests} r={0} label={<Badge text={`Peak ${fmtInt(peaks.tests.tests)}`} />} />
          )}
          {markers}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );

  const legend = {
    positivity: [{ label: K.line, color: C.pos }, { label: K.ci, color: C.ns }, { label: K.trend, color: C.accent }],
    tests: [{ label: K.pos, color: C.pos }, { label: K.neg, color: C.neg }],
  };
  const legendItems = mode === "both" ? [...legend.positivity, ...legend.tests] : legend[mode];

  return (
    <Card
      title={mode === "tests" ? "Tests per report week" : mode === "both" ? "Positivity and tests per report week" : "Positivity per report week"}
      subtitle={
        mode === "tests" ? "Weekly batch split into positive and negative results"
          : "Line turns orange above the all-tests rate and blue below it · grey band is the 95% CI"
      }
      action={
        <Segmented
          label="Measure"
          value={mode}
          onChange={(m) => { setMode(m); setSpot(null); }}
          options={[{ value: "positivity", label: "Positivity" }, { value: "tests", label: "Tests" }, { value: "both", label: "Both" }]}
        />
      }
    >
      <FocusPanel d={focus} prev={prev} state={focusState} mode={mode} overallPct={overallPct} onUnpin={() => setPinned(null)} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend items={legendItems} hidden={hidden} onToggle={toggleKey} onHover={setSpot} />
        <span key={`${start}-${end}`} className="mb-2 animate-fade-in rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-semibold text-accent">
          {end - start + 1} of {weeks.length} weeks
        </span>
      </div>

      <div
        tabIndex={0} onKeyDown={onKey} className="rounded-lg outline-offset-4"
        aria-label="Weekly chart. Left and right arrow keys step through weeks, Escape unpins."
      >
        {mode === "positivity" && positivityPlot(300)}
        {mode === "tests" && testsPlot(300)}
        {mode === "both" && (
          <>
            {positivityPlot(210, false)}
            {testsPlot(160)}
          </>
        )}
      </div>

      {/* overview strip: the whole season, with a brush to choose the weeks shown above */}
      <div className="mt-2 h-12" style={{ paddingLeft: Y_WIDTH }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
            <Brush
              key={brushKey} dataKey="label" height={46} y={1}
              startIndex={start} endIndex={end}
              onChange={onBrush} onDragEnd={() => setDragging(false)}
              stroke="var(--accent)" fill="var(--surface)" travellerWidth={10}
            >
              <AreaChart data={data}>
                <Area dataKey="tests" stroke={C.accent} strokeWidth={1} fill={C.accent} fillOpacity={0.15} isAnimationActive={false} />
              </AreaChart>
            </Brush>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <Hint>
        Hover to read any week, click to pin it (arrow keys step through weeks). Drag the handles in the strip below the
        chart to zoom to a range; the whole dashboard updates. Click a legend key to show or hide it.
      </Hint>
    </Card>
  );
}
