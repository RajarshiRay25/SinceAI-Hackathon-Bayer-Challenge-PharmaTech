import { useState } from "react";
import { Card, Hint, Legend, Segmented } from "./ui.jsx";
import { C, niceAxis, pctTick } from "../lib/chart.js";
import { fmtCI, fmtInt, fmtOR, fmtPct, toggle } from "../lib/format.js";
import { useMounted } from "../lib/motion.js";
import { OddsMark, OrPill, PlotFrame, SIGNAL, SIGNAL_LABEL, fmtOrTick, fmtX, oddsScale, oddsZones, tint } from "./plots.jsx";

// fewer patients than this with a condition and its interval is too wide to read much into
const FEW = 100;

const SORTS = {
  or: (a, b) => (b.or ?? 0) - (a.or ?? 0),
  pct: (a, b) => (b.if_yes.pct ?? -1) - (a.if_yes.pct ?? -1),
  n: (a, b) => b.n_yes - a.n_yes,
};
const ROW_H = 54;
const ROW = "grid grid-cols-[minmax(6.5rem,9rem)_1fr_4.25rem] sm:grid-cols-[minmax(6.5rem,9rem)_1fr_4.25rem_6rem] items-center gap-3 px-2";

/** Positivity with vs without the condition, as two short bars. */
function WithWithout({ r, max, mounted }) {
  const bar = (v, color, label) => (
    <span className="flex items-center gap-1.5" title={`${label}: ${fmtPct(v, 1)}`}>
      <span className="h-1.5 flex-1 rounded-full bg-bg">
        <span className="block h-full rounded-full transition-[width] duration-700 ease-out-soft"
          style={{ width: `${mounted ? Math.max(3, ((v ?? 0) / max) * 100) : 0}%`, background: color }} />
      </span>
      <span className="num w-9 text-right text-[11px] text-ink-2">{fmtPct(v, 1)}</span>
    </span>
  );
  return (
    <span className="grid gap-1">
      {bar(r.if_yes.pct, C.pos, "With it")}
      {bar(r.if_no.pct, C.neg, "Without it")}
    </span>
  );
}

function ConditionReadout({ r }) {
  if (!r) return null;
  const color = SIGNAL[r.signal];
  const cell = (label, value, sub) => (
    <div className="min-w-0 px-3 py-2">
      <div className="text-[10.5px] font-bold uppercase tracking-wider text-ink-3">{label}</div>
      <div className="num mt-0.5 text-[16px] font-bold leading-tight">{value}</div>
      {sub && <div className="num text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
  return (
    <div key={r.key} className="mt-4 grid animate-fade-in grid-cols-2 rounded-2xl border border-line bg-bg/60 sm:grid-cols-[auto_1fr_1fr_1fr]">
      <div className="col-span-2 flex items-center gap-2 border-b border-line px-3 py-2 sm:col-span-1 sm:border-b-0 sm:border-r">
        <i className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-extrabold">{r.label}</div>
          <div className="text-[11px] text-ink-3">{SIGNAL_LABEL[r.signal]}</div>
        </div>
      </div>
      {cell("Odds ratio", <span style={{ color }}>{fmtX(r.or)}</span>, `95% CI ${fmtOR(r.ci_low)}–${fmtOR(r.ci_high)}`)}
      {cell("With vs without", `${fmtPct(r.if_yes.pct, 1)} / ${fmtPct(r.if_no.pct, 1)}`, fmtCI(r.if_yes.ci_low, r.if_yes.ci_high, 1))}
      {cell("Patients", fmtInt(r.n_yes), `${fmtPct(r.prev_pos, 1)} of positive · ${fmtPct(r.prev_neg, 1)} of negative`)}
    </div>
  );
}

function ConditionsForest({ rows }) {
  const [sort, setSort] = useState("or");
  const [hover, setHover] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [hidden, setHidden] = useState([]);
  const [spot, setSpot] = useState(null);
  const mounted = useMounted();
  const { x, ticks: all } = oddsScale(rows);
  // the plot column is narrow here, so keep only every other log tick
  const ticks = all.filter((t) => ![0.05, 0.2, 20].includes(t));
  const order = [...rows].sort(SORTS[sort]).map((r) => r.key);
  const maxPct = Math.max(...rows.flatMap((r) => [r.if_yes.pct ?? 0, r.if_no.pct ?? 0]), 0.1);
  const clear = rows.filter((r) => r.signal !== "ns");
  const top = clear.length ? clear.reduce((m, r) => (r.or > m.or ? r : m)) : null;
  const focusKey = hover ?? pinned ?? top?.key ?? rows[0]?.key;

  return (
    <>
      {top && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-linear-to-r from-hue-coral-soft to-transparent px-4 py-2.5">
          <span className="num text-[26px] font-bold leading-none text-pos">{fmtX(top.or)}</span>
          <span className="text-[13px] leading-snug text-ink-2">
            <b className="text-ink">{top.label}</b> has the strongest link: {fmtPct(top.if_yes.pct, 1)} positive vs{" "}
            {fmtPct(top.if_no.pct, 1)} without it. <b className="text-ink">{clear.length} of {rows.length}</b> conditions show a clear link.
          </span>
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Legend
          items={["higher", "lower", "ns"].map((k) => ({ label: SIGNAL_LABEL[k], color: SIGNAL[k] }))}
          hidden={hidden} onToggle={(l) => setHidden((h) => toggle(h, l))} onHover={setSpot}
        />
        <Segmented
          label="Sort conditions" value={sort} onChange={setSort}
          options={[{ value: "or", label: "Odds" }, { value: "pct", label: "Positivity" }, { value: "n", label: "Patients" }]}
        />
      </div>

      <div className={`${ROW} mb-1 text-[10.5px] font-bold uppercase tracking-wider text-ink-3`}>
        <span>Condition</span><span>Odds ratio · log scale</span><span className="text-right">OR</span>
        <span className="hidden sm:block">With / without</span>
      </div>

      <PlotFrame
        row={ROW} x={x} ticks={ticks} fmt={fmtOrTick} zones={oddsZones(x(1))} refValue={1} refLabel="No link"
        bodyClass="" bodyStyle={{ height: rows.length * ROW_H }}
      >
        <div onMouseLeave={() => setHover(null)}>
          {rows.map((r, i) => {
            const idx = order.indexOf(r.key);
            const on = focusKey === r.key;
            const off = hidden.includes(SIGNAL_LABEL[r.signal]) || (spot && spot !== SIGNAL_LABEL[r.signal]);
            const few = r.n_yes < FEW;
            return (
              <button
                key={r.key}
                type="button"
                aria-pressed={pinned === r.key}
                onMouseEnter={() => setHover(r.key)}
                onFocus={() => setHover(r.key)}
                onBlur={() => setHover(null)}
                onClick={() => setPinned((p) => (p === r.key ? null : r.key))}
                className={`${ROW} group absolute inset-x-0 top-0 rounded-xl text-left transition-[transform,opacity,background-color] duration-500 ease-out-soft ${
                  on ? "bg-accent-soft/70 ring-1 ring-accent/25" : "hover:bg-bg"
                } ${off ? "opacity-30" : ""}`}
                style={{ height: ROW_H - 4, transform: `translateY(${idx * ROW_H}px)` }}
              >
                <span className="min-w-0">
                  <span className={`block truncate text-[13px] ${on ? "font-semibold text-ink" : "text-ink-2"}`}>{r.label}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="num text-[11px] text-ink-3">n={fmtInt(r.n_yes)}</span>
                    {few && (
                      <span className="rounded-full bg-warn-bg px-1.5 text-[10px] font-semibold text-warn-ink" title="Few patients: the interval is wide">
                        few patients
                      </span>
                    )}
                  </span>
                </span>
                <span className="relative h-7" style={{ opacity: few ? 0.7 : 1 }}>
                  <OddsMark s={r} x={x} mounted={mounted} active={on} delay={i * 40} />
                </span>
                <span className="text-right"><OrPill s={r} active={on} /></span>
                <span className="hidden sm:block"><WithWithout r={r} max={maxPct} mounted={mounted} /></span>
              </button>
            );
          })}
        </div>
      </PlotFrame>

      <ConditionReadout r={rows.find((r) => r.key === focusKey)} />
    </>
  );
}

/** One exposure question: headline, positivity by answer, and how people answered. */
function ExposureTile({ v, overallPct, index }) {
  const [hover, setHover] = useState(null);
  const mounted = useMounted();
  const color = SIGNAL[v.signal];
  const groups = [
    { key: "Yes", d: v.if_yes, color: C.pos },
    { key: "No", d: v.if_no, color: C.neg },
    ...(v.if_unknown.tests ? [{ key: "Not recorded", d: v.if_unknown, color: C.ns }] : []),
  ];
  const ax = niceAxis(Math.max(overallPct, ...groups.map((g) => g.d.ci_high ?? 0)));
  const x = (n) => Math.min(100, ((n ?? 0) / ax.domain[1]) * 100);
  const total = groups.reduce((s, g) => s + g.d.tests, 0);
  const ratio = v.if_no.pct ? v.if_yes.pct / v.if_no.pct : null;
  const summary = v.signal === "ns"
    ? <>No clear difference: <b className="num text-ink">{fmtPct(v.if_yes.pct, 1)}</b> if yes vs <b className="num text-ink">{fmtPct(v.if_no.pct, 1)}</b> if no.</>
    : <>Answering yes came with <b className="num text-ink">{ratio?.toFixed(1)}×</b> the positivity: <b className="num text-ink">{fmtPct(v.if_yes.pct, 1)}</b> vs <b className="num text-ink">{fmtPct(v.if_no.pct, 1)}</b>.</>;

  return (
    <div className="animate-rise rounded-2xl border border-line bg-linear-to-br from-accent-soft/50 to-surface to-60% p-4" style={{ animationDelay: `${index * 80}ms` }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-extrabold leading-tight">{v.label}</h3>
          <span className="mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold text-ink" style={{ background: tint(color, 25) }}>
            {SIGNAL_LABEL[v.signal]}
          </span>
        </div>
        <div className="text-right">
          <div className="num text-[28px] font-bold leading-none" style={{ color }}>{fmtX(v.or)}</div>
          <div className="num mt-1 text-[11px] text-ink-3">OR · {fmtOR(v.ci_low)}–{fmtOR(v.ci_high)}</div>
        </div>
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">{summary}</p>

      {/* positivity by answer */}
      <div className="relative mt-3" onMouseLeave={() => setHover(null)}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-[6.5rem_1fr_4rem] gap-3 px-1">
          <span />
          <div className="relative">
            {ax.ticks.map((t) => <div key={t} className="absolute inset-y-0 w-px bg-line" style={{ left: `${x(t)}%` }} />)}
            <div className="absolute inset-y-0 z-10 border-l-2 border-dashed border-ink-3/60" style={{ left: `${x(overallPct)}%` }} />
          </div>
        </div>
        {groups.map((g, i) => (
          <div
            key={g.key}
            onMouseEnter={() => setHover(g.key)}
            title={`${g.key}: ${fmtPct(g.d.pct)} (${fmtCI(g.d.ci_low, g.d.ci_high)}), ${fmtInt(g.d.positives)} of ${fmtInt(g.d.tests)} tests`}
            className={`relative grid h-9 grid-cols-[6.5rem_1fr_4rem] items-center gap-3 rounded-lg px-1 transition-opacity ${hover && hover !== g.key ? "opacity-40" : ""}`}
          >
            <span className="flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-ink-2">
              <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: g.color }} />{g.key}
            </span>
            <span className="relative h-full">
              <span className="absolute left-0 top-1/2 h-3 -translate-y-1/2 rounded-r-full rounded-l-sm transition-[width] duration-700 ease-out-soft"
                style={{ width: `${mounted ? x(g.d.pct) : 0}%`, background: `linear-gradient(90deg, ${tint(g.color, 50)}, ${g.color})`, transitionDelay: `${index * 80 + i * 60}ms` }} />
              <span className="absolute top-1/2 h-px -translate-y-1/2 bg-ink-2 transition-opacity duration-500"
                style={{ left: `${x(g.d.ci_low)}%`, width: `${x(g.d.ci_high) - x(g.d.ci_low)}%`, opacity: mounted ? 1 : 0 }}>
                <span className="absolute -top-1 left-0 h-2 w-px bg-ink-2" />
                <span className="absolute -top-1 right-0 h-2 w-px bg-ink-2" />
              </span>
            </span>
            <span className="text-right">
              <span className="num block text-[13px] font-bold">{fmtPct(g.d.pct)}</span>
              {hover === g.key && <span className="num block animate-fade-in text-[10.5px] text-ink-3">n={fmtInt(g.d.tests)}</span>}
            </span>
          </div>
        ))}
        <div aria-hidden="true" className="grid grid-cols-[6.5rem_1fr_4rem] gap-3 px-1">
          <span />
          <div className="relative h-4">
            {ax.ticks.map((t) => <span key={t} className="num absolute -translate-x-1/2 text-[10.5px] text-ink-3" style={{ left: `${x(t)}%` }}>{pctTick(t)}</span>)}
          </div>
        </div>
      </div>

      {/* how people answered */}
      <div className="mt-3">
        <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-ink-3">How patients answered</div>
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-bg">
          {groups.map((g) => (
            <span key={g.key} className="h-full transition-[width] duration-700 ease-out-soft first:rounded-l-full last:rounded-r-full"
              style={{ width: mounted ? `${(g.d.tests / total) * 100}%` : 0, background: g.color, opacity: hover && hover !== g.key ? 0.35 : 1 }} />
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-ink-3">
          {groups.map((g) => (
            <span key={g.key}>{g.key} <b className="num font-semibold text-ink-2">{((g.d.tests / total) * 100).toFixed(1)}%</b></span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ConditionsTab({ data }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
      <Card title="Underlying conditions" subtitle="How each condition relates to the odds of a positive test · 95% CI">
        <ConditionsForest rows={data.comorbidities} />
        <Hint>
          Hover a row for details, click to keep it; switch the sort to reorder. These figures are unadjusted.
          Conditions such as hypertension are more common in older patients, who tested positive less often, so a low
          odds ratio here does not mean a condition protects anyone.
        </Hint>
      </Card>
      <Card title="High-risk exposure" subtitle="Positivity by the patient's answer · dashed line is all tests">
        <div className="grid gap-4">
          {data.exposure.map((v, i) => <ExposureTile key={v.key} v={v} index={i} overallPct={data.kpis.overall_pct} />)}
        </div>
      </Card>
    </div>
  );
}
