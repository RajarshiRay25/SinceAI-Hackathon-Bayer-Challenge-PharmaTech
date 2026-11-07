import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ErrorBar, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, Hint, Legend, Segmented, TipBox } from "./ui.jsx";
import { C, axisLine, cursor, grid, labelTick, niceAxis, pctTick, tick } from "../lib/chart.js";
import { errBar, fmtCI, fmtInt, fmtOR, fmtPct, toggle } from "../lib/format.js";
import { useChartAnim, useMounted } from "../lib/motion.js";
import { OddsMark, OrPill, PlotFrame, SIGNAL, SIGNAL_LABEL, fmtOrTick, fmtX, oddsScale, oddsZones, tint } from "./plots.jsx";

// label | plot | value — shared by every row and the gridline layer behind them so they line up
const ROW = "grid grid-cols-[minmax(6.5rem,9.5rem)_1fr_4.75rem] items-center gap-3 px-2";

const SUB = {
  odds: "How much each symptom raises the odds of a positive test · log scale, 95% CI",
  prevalence: "Share of positive vs negative patients reporting each symptom",
  count: "Positivity by how many symptoms the patient reported",
};

/** One focusable row; hovering or focusing it puts the symptom in the spotlight. */
function Row({ s, rank, active, dimmed, onPick, children, value }) {
  return (
    <button
      type="button"
      onMouseEnter={() => onPick(s.key)}
      onFocus={() => onPick(s.key)}
      onClick={() => onPick(s.key, true)}
      aria-pressed={active}
      className={`${ROW} group rounded-xl py-1.5 text-left transition-all duration-200 ${
        active ? "bg-accent-soft/70 ring-1 ring-accent/25" : "hover:bg-bg"
      } ${dimmed ? "opacity-30" : ""}`}
    >
      <span className="flex min-w-0 items-center gap-2 text-[13px]">
        <span className={`num grid h-5 w-5 shrink-0 place-items-center rounded-md text-[10.5px] font-semibold transition-colors ${active ? "bg-accent text-white" : "bg-bg text-ink-3"}`}>{rank}</span>
        <span className={`truncate ${active ? "font-semibold text-ink" : "text-ink-2"}`}>{s.label}</span>
      </span>
      <span className="relative h-7">{children}</span>
      <span className="text-right">{value}</span>
    </button>
  );
}

function ForestPlot({ rows, focus, onPick, hidden, spot }) {
  const mounted = useMounted();
  const { x, ticks } = oddsScale(rows);

  return (
    <PlotFrame row={ROW} x={x} ticks={ticks} fmt={fmtOrTick} zones={oddsZones(x(1))} refValue={1} refLabel="No link">
      {rows.map((s, i) => {
        const on = focus === s.key;
        const off = hidden.includes(SIGNAL_LABEL[s.signal]) || (spot && spot !== SIGNAL_LABEL[s.signal]);
        return (
          <Row key={s.key} s={s} rank={i + 1} active={on} dimmed={off} onPick={onPick}
            value={<OrPill s={s} active={on} />}>
            <OddsMark s={s} x={x} mounted={mounted} active={on} delay={i * 40} />
          </Row>
        );
      })}
    </PlotFrame>
  );
}

function Dumbbell({ rows, focus, onPick, hidden, spot }) {
  const mounted = useMounted();
  const ax = niceAxis(Math.max(...rows.map((s) => Math.max(s.prev_pos ?? 0, s.prev_neg ?? 0))));
  const x = (v) => ((v ?? 0) / ax.domain[1]) * 100;
  const showPos = !hidden.includes("Positive"), showNeg = !hidden.includes("Negative");
  const dot = (v, color, key) => (
    <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface shadow-sm transition-all duration-700 ease-out-soft group-hover:scale-125"
      style={{ left: `${mounted ? x(v) : 0}%`, background: color, opacity: spot && spot !== key ? 0.3 : 1 }} />
  );

  return (
    <PlotFrame row={ROW} x={x} ticks={ax.ticks} fmt={pctTick}>
      {rows.map((s, i) => {
        const a = Math.min(s.prev_pos, s.prev_neg), b = Math.max(s.prev_pos, s.prev_neg);
        const gap = s.prev_pos - s.prev_neg;
        return (
          <Row key={s.key} s={s} rank={i + 1} active={focus === s.key} onPick={onPick}
            value={<span className="num text-[12px] font-semibold text-ink-2">{gap >= 0 ? "+" : "−"}{Math.abs(gap).toFixed(1)} pts</span>}>
            {showPos && showNeg && (
              <span className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full transition-all duration-700 ease-out-soft"
                style={{
                  left: `${mounted ? x(a) : 0}%`, width: `${mounted ? x(b) - x(a) : 0}%`,
                  background: `linear-gradient(90deg, ${gap >= 0 ? C.neg : C.pos}, ${gap >= 0 ? C.pos : C.neg})`, opacity: 0.45,
                }} />
            )}
            {showNeg && dot(s.prev_neg, C.neg, "Negative")}
            {showPos && dot(s.prev_pos, C.pos, "Positive")}
          </Row>
        );
      })}
    </PlotFrame>
  );
}

/** Details for the symptom in focus: odds, and positivity with vs without it. */
function Spotlight({ s }) {
  const mounted = useMounted();
  if (!s) return null;
  const color = SIGNAL[s.signal];
  const max = Math.max(s.if_yes.pct ?? 0, s.if_no.pct ?? 0) || 1;
  const bar = (label, d, fill) => (
    <div>
      <div className="flex items-baseline justify-between text-[12px] text-ink-2">
        <span>{label}</span>
        <span className="num text-[13px] font-semibold text-ink">{fmtPct(d.pct, 1)}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-surface ring-1 ring-line">
        <div className="h-full rounded-full transition-[width] duration-500 ease-out-soft"
          style={{ width: mounted ? `${Math.max(2, ((d.pct ?? 0) / max) * 100)}%` : 0, background: fill }} />
      </div>
      <div className="num mt-0.5 text-[11px] text-ink-3">{fmtInt(d.positives)} of {fmtInt(d.tests)} tests</div>
    </div>
  );
  return (
    <aside key={s.key} className="animate-fade-in rounded-2xl border border-line bg-linear-to-b from-accent-soft/60 to-surface p-4" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-ink-3">Spotlight</span>
        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-ink" style={{ background: tint(color, 25) }}>{SIGNAL_LABEL[s.signal]}</span>
      </div>
      <h3 className="mt-2 text-[17px] font-extrabold leading-tight">{s.label}</h3>
      <div className="mt-3 flex items-end gap-2">
        <span className="num text-[34px] font-bold leading-none tracking-tight" style={{ color }}>{fmtX(s.or)}</span>
        <span className="pb-1 text-[12px] leading-tight text-ink-3">odds of a<br />positive test</span>
      </div>
      <div className="num mt-1 text-[11.5px] text-ink-3">95% CI {fmtOR(s.ci_low)}–{fmtOR(s.ci_high)}</div>

      <div className="mt-4 grid gap-3">
        {bar("Positivity with it", s.if_yes, C.pos)}
        {bar("Positivity without it", s.if_no, C.neg)}
      </div>

      <p className="mt-4 border-t border-line pt-3 text-[12.5px] leading-relaxed text-ink-2">
        Reported by <b className="num text-ink">{fmtPct(s.prev_pos, 1)}</b> of positive patients and{" "}
        <b className="num text-ink">{fmtPct(s.prev_neg, 1)}</b> of negative ones · {fmtInt(s.n_yes)} patients in all.
      </p>
    </aside>
  );
}

function CountTick({ x, y, payload, rows, hover }) {
  const r = rows.find((d) => d.group === payload.value);
  const on = hover == null || rows[hover]?.group === payload.value;
  return (
    <g transform={`translate(${x},${y})`} style={{ opacity: on ? 1 : 0.4, transition: "opacity .2s" }}>
      <text dy={14} textAnchor="middle" {...labelTick} fontWeight={700}>{payload.value}</text>
      <text dy={29} textAnchor="middle" {...tick}>{fmtPct(r?.pct, 1)}</text>
    </g>
  );
}

function CountTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return <TipBox title={`${d.group} symptom${d.group === "1" ? "" : "s"}`} rows={[["Positivity", fmtPct(d.pct), C.pos], ["95% CI", fmtCI(d.ci_low, d.ci_high)], ["Positive / tests", `${fmtInt(d.positives)} / ${fmtInt(d.tests)}`]]} />;
}

function CountChart({ byCount, overallPct }) {
  const [hover, setHover] = useState(null);
  const anim = useChartAnim();
  const count = byCount.map((r) => ({ ...r, err: errBar(r) }));
  const ax = niceAxis(Math.max(overallPct, ...count.map((d) => d.ci_high ?? 0)));
  const first = count[0], last = count[count.length - 1];
  const times = first?.pct ? last.pct / first.pct : null;
  return (
    <>
      {times && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-linear-to-r from-hue-coral-soft to-transparent px-4 py-3">
          <span className="num text-[30px] font-bold leading-none text-pos">{times.toFixed(0)}×</span>
          <span className="text-[13px] leading-snug text-ink-2">
            Patients reporting <b className="text-ink">{last.group}</b> symptoms tested positive {times.toFixed(0)} times as
            often as those reporting <b className="text-ink">{first.group}</b> ({fmtPct(last.pct, 1)} vs {fmtPct(first.pct, 1)}).
          </span>
        </div>
      )}
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={count} margin={{ top: 8, right: 64, left: 0, bottom: 0 }}
            onMouseMove={(s) => setHover(s?.isTooltipActive ? s.activeTooltipIndex : null)} onMouseLeave={() => setHover(null)}>
            <CartesianGrid {...grid} />
            <XAxis dataKey="group" tick={<CountTick rows={count} hover={hover} />} axisLine={axisLine} tickLine={false} height={40} interval={0} />
            <YAxis tick={tick} axisLine={false} tickLine={false} width={44} tickFormatter={pctTick} domain={ax.domain} ticks={ax.ticks} />
            <Tooltip content={<CountTip />} cursor={cursor} />
            <ReferenceLine y={overallPct} stroke={C.ink3} strokeDasharray="4 4"
              label={{ value: `All ${fmtPct(overallPct)}`, position: "right", fill: "var(--ink-3)", fontSize: 11 }} />
            <Bar dataKey="pct" radius={[6, 6, 0, 0]} maxBarSize={64} {...anim}>
              {/* one hue, deepening with the number of symptoms */}
              {count.map((d, i) => (
                <Cell key={d.group} fill={`color-mix(in srgb, var(--pos) ${35 + (65 * i) / Math.max(1, count.length - 1)}%, var(--surface))`}
                  fillOpacity={hover == null || hover === i ? 1 : 0.45} style={{ transition: "fill-opacity .2s" }} />
              ))}
              <ErrorBar dataKey="err" width={8} stroke={C.ink2} strokeWidth={1.5} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

export default function SymptomsCard({ symptoms, byCount, overallPct }) {
  const [mode, setMode] = useState("odds");
  const [hidden, setHidden] = useState([]);
  const [spot, setSpot] = useState(null); // legend key under the pointer
  const [focus, setFocus] = useState(null);
  const [pinned, setPinned] = useState(null);
  const onLegend = (l) => setHidden((h) => toggle(h, l));
  const changeMode = (m) => { setMode(m); setHidden([]); setSpot(null); };

  const odds = [...symptoms].sort((a, b) => (b.or ?? 0) - (a.or ?? 0));
  const prev = [...symptoms].sort((a, b) => (b.prev_pos ?? 0) - (a.prev_pos ?? 0));
  const rows = mode === "prevalence" ? prev : odds;

  // spotlight: hovered row, else the clicked one, else the strongest signal
  const onPick = (key, click) => (click ? setPinned((p) => (p === key ? null : key)) : setFocus(key));
  const focusKey = focus ?? pinned ?? rows[0]?.key;
  const focused = symptoms.find((s) => s.key === focusKey);

  return (
    <Card
      title="Symptoms"
      subtitle={SUB[mode]}
      action={
        <Segmented
          label="Symptom view"
          value={mode}
          onChange={changeMode}
          options={[{ value: "odds", label: "Odds ratio" }, { value: "prevalence", label: "Prevalence" }, { value: "count", label: "Symptom count" }]}
        />
      }
    >
      {mode === "count" ? (
        <CountChart byCount={byCount} overallPct={overallPct} />
      ) : (
        <>
          <Legend
            items={mode === "odds"
              ? ["higher", "lower", "ns"].map((k) => ({ label: SIGNAL_LABEL[k], color: SIGNAL[k] }))
              : [{ label: "Positive", color: C.pos }, { label: "Negative", color: C.neg }]}
            hidden={hidden} onToggle={onLegend} onHover={setSpot}
          />
          <div className="grid gap-4 lg:grid-cols-[1fr_17rem]">
            <div onMouseLeave={() => setFocus(null)} className="min-w-0">
              {mode === "odds"
                ? <ForestPlot rows={odds} focus={focusKey} onPick={onPick} hidden={hidden} spot={spot} />
                : <Dumbbell rows={prev} focus={focusKey} onPick={onPick} hidden={hidden} spot={spot} />}
            </div>
            <Spotlight s={focused} />
          </div>
          <Hint>
            {mode === "odds"
              ? "An odds ratio of 1 means no link. Hover or tab through the rows to see each symptom in the spotlight; click one to keep it there."
              : "Each row joins the share of positive and negative patients reporting the symptom; the wider the gap, the stronger the clue."}
          </Hint>
        </>
      )}
    </Card>
  );
}
