import { useState } from "react";
import { Card, Hint, Segmented } from "./ui.jsx";
import { niceAxis, pctTick } from "../lib/chart.js";
import { fmtCI, fmtInt, fmtPct, toggle } from "../lib/format.js";
import { useMounted } from "../lib/motion.js";

// groups with fewer tests than this are too noisy to headline
const MIN_TESTS = 50;

const fmtGap = (d) => (d == null ? "–" : `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d).toFixed(2)} pts`);
const tint = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/** Highest and lowest groups with enough tests, for the headline. */
function extremes(rows) {
  const ok = rows.filter((r) => r.tests >= MIN_TESTS && r.pct != null);
  if (ok.length < 2) return null;
  const hi = ok.reduce((m, r) => (r.pct > m.pct ? r : m)), lo = ok.reduce((m, r) => (r.pct < m.pct ? r : m));
  return lo.pct > 0 ? { hi, lo, times: hi.pct / lo.pct } : null;
}

function Insight({ ext, noun, color, soft }) {
  if (!ext) return null;
  return (
    <div className={`mb-4 flex items-center gap-3 rounded-2xl bg-linear-to-r ${soft} to-transparent px-4 py-2.5`}>
      <span className="num text-[26px] font-bold leading-none" style={{ color }}>{ext.times.toFixed(1)}×</span>
      <span className="text-[13px] leading-snug text-ink-2">
        <b className="text-ink">{noun(ext.hi.group)}</b> tested positive {ext.times.toFixed(1)} times as often as{" "}
        <b className="text-ink">{noun(ext.lo.group)}</b> ({fmtPct(ext.hi.pct, 1)} vs {fmtPct(ext.lo.pct, 1)}).
      </span>
    </div>
  );
}

/** Figures for the group in focus. */
function Readout({ d, overallPct, total, color, picked, noun }) {
  if (!d) return null;
  const gap = d.pct == null ? null : d.pct - overallPct;
  const cell = (label, value, sub) => (
    <div className="min-w-0 px-3 py-2">
      <div className="text-[10.5px] font-bold uppercase tracking-wider text-ink-3">{label}</div>
      <div className="num mt-0.5 text-[16px] font-bold leading-tight">{value}</div>
      {sub && <div className="num text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
  return (
    <div key={d.group} className="mt-4 grid animate-fade-in grid-cols-2 gap-y-1 rounded-2xl border border-line bg-bg/60 sm:grid-cols-[auto_1fr_1fr_1fr]">
      <div className="col-span-2 flex items-center gap-2 border-b border-line px-3 py-2 sm:col-span-1 sm:border-b-0 sm:border-r">
        <i className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-extrabold">{noun(d.group)}</div>
          <div className="text-[11px] text-ink-3">{picked ? "In your filter" : "Hover a bar to compare"}</div>
        </div>
      </div>
      {cell("Positivity", fmtPct(d.pct), fmtCI(d.ci_low, d.ci_high, 1))}
      {cell("vs all tests", (
        <span className={gap > 0 ? "text-pos" : gap < 0 ? "text-neg" : ""}>{fmtGap(gap)}</span>
      ), `all tests ${fmtPct(overallPct)}`)}
      {cell("Tests", fmtInt(d.tests), `${fmtInt(d.positives)} positive · ${total ? ((d.tests / total) * 100).toFixed(1) : 0}% of all`)}
    </div>
  );
}

const fillFor = (selected, group, strong, soft) => (selected.length === 0 || selected.includes(group) ? strong : soft);

/** Small check badge shown on groups that are part of the current filter. */
const Check = () => (
  <span className="grid h-4 w-4 shrink-0 animate-pop place-items-center rounded-full bg-accent text-white">
    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden="true">
      <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>
);

export function AgeChart({ rows, filters, setFilters, overallPct }) {
  const [hover, setHover] = useState(null);
  const mounted = useMounted();
  const sel = filters.age_groups;
  const ax = niceAxis(Math.max(overallPct, ...rows.map((d) => d.ci_high ?? 0)));
  const y = (v) => Math.min(100, ((v ?? 0) / ax.domain[1]) * 100);
  const total = rows.reduce((s, r) => s + r.tests, 0);
  const ext = extremes(rows);
  const focus = rows.find((r) => r.group === hover) ?? rows.find((r) => sel.includes(r.group)) ?? ext?.hi ?? rows[0];
  const noun = (g) => `Ages ${g}`;
  const pick = (g) => setFilters((f) => ({ ...f, age_groups: toggle(f.age_groups, g) }));

  return (
    <Card title="Positivity by age group" subtitle="Children and young adults tested positive most often">
      <Insight ext={ext} noun={noun} color="var(--pos)" soft="from-hue-coral-soft" />

      <div className="grid grid-cols-[2.5rem_1fr]">
        {/* y axis */}
        <div className="relative h-56" aria-hidden="true">
          {ax.ticks.map((t) => (
            <span key={t} className="num absolute right-2 translate-y-1/2 text-[11px] text-ink-3" style={{ bottom: `${y(t)}%` }}>{pctTick(t)}</span>
          ))}
          {/* the all-tests line is named in the axis gutter, clear of the bar labels */}
          <span className="absolute right-1 z-10 translate-y-1/2 rounded-full bg-surface px-1 text-[10.5px] font-bold text-ink-2 ring-1 ring-line-strong"
            style={{ bottom: `${y(overallPct)}%` }} title={`All tests ${fmtPct(overallPct)}`}>All</span>
        </div>

        <div className="relative h-56 border-b border-line-strong" onMouseLeave={() => setHover(null)}>
          {ax.ticks.map((t) => (
            <div key={t} aria-hidden="true" className="absolute inset-x-0 h-px bg-line" style={{ bottom: `${y(t)}%` }} />
          ))}
          <div aria-hidden="true" className="absolute inset-x-0 z-10 border-t-2 border-dashed border-ink-3/60" style={{ bottom: `${y(overallPct)}%` }} />

          <div className="relative flex h-full items-end justify-around gap-2 px-2">
            {rows.map((d, i) => {
              const picked = sel.includes(d.group);
              const fill = fillFor(sel, d.group, "var(--pos)", "var(--pos-soft)");
              return (
                <button
                  key={d.group}
                  type="button"
                  aria-pressed={picked}
                  aria-label={`Ages ${d.group}: ${fmtPct(d.pct)} positive. ${picked ? "Remove from" : "Add to"} filter`}
                  onMouseEnter={() => setHover(d.group)}
                  onFocus={() => setHover(d.group)}
                  onBlur={() => setHover(null)}
                  onClick={() => pick(d.group)}
                  className={`group relative h-full max-w-[4.5rem] flex-1 cursor-pointer transition-opacity duration-200 ${hover && hover !== d.group ? "opacity-45" : ""}`}
                >
                  {/* hover wash behind the column */}
                  <span className="absolute inset-x-0 inset-y-0 rounded-t-xl bg-accent/0 transition-colors group-hover:bg-accent/5" />
                  <span
                    className={`absolute inset-x-1.5 bottom-0 rounded-t-xl transition-[height,box-shadow] duration-700 ease-out-soft ${picked ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : ""}`}
                    style={{
                      height: `${mounted ? y(d.pct) : 0}%`, transitionDelay: `${i * 60}ms`,
                      background: `linear-gradient(180deg, ${fill}, ${tint(fill, 65)})`,
                      boxShadow: hover === d.group ? `0 10px 24px -8px ${tint(fill, 70)}` : "none",
                    }}
                  />
                  {/* 95% CI whisker */}
                  <span className="absolute left-1/2 w-px -translate-x-1/2 bg-ink-2 transition-opacity duration-500"
                    style={{ bottom: `${y(d.ci_low)}%`, height: `${y(d.ci_high) - y(d.ci_low)}%`, opacity: mounted ? 1 : 0 }}>
                    <span className="absolute -left-1 top-0 h-px w-2 bg-ink-2" />
                    <span className="absolute -left-1 bottom-0 h-px w-2 bg-ink-2" />
                  </span>
                  <span className="num absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11.5px] font-semibold text-ink transition-opacity duration-500"
                    style={{ bottom: `calc(${y(d.ci_high)}% + 6px)`, opacity: mounted ? 1 : 0 }}>
                    {fmtPct(d.pct, 1)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <span />
        <div className="flex justify-around gap-2 px-2 pt-2">
          {rows.map((d) => (
            <div key={d.group} className={`max-w-[4.5rem] flex-1 text-center transition-opacity ${hover && hover !== d.group ? "opacity-45" : ""}`}>
              <div className="flex items-center justify-center gap-1 text-[13px] font-bold">
                {sel.includes(d.group) && <Check />}{d.group}
              </div>
              <div className="num text-[11px] text-ink-3">n={fmtInt(d.tests)}</div>
            </div>
          ))}
        </div>
      </div>

      <Readout d={focus} overallPct={overallPct} total={total} color="var(--pos)" picked={sel.includes(focus?.group)} noun={noun} />
      <Hint>Click a bar to filter by that age group; click again to remove it. Whiskers show the 95% CI; dashed line: all tests ({fmtPct(overallPct)}).</Hint>
    </Card>
  );
}

const SORTS = {
  pct: (a, b) => (b.pct ?? -1) - (a.pct ?? -1),
  tests: (a, b) => b.tests - a.tests,
};
const ROW_H = 52;
const ROW = "grid grid-cols-[minmax(6.5rem,9.5rem)_1fr_4.5rem] sm:grid-cols-[minmax(6.5rem,9.5rem)_1fr_4.5rem_5.5rem] items-center gap-3 px-2";

export function TestTypeChart({ rows, filters, setFilters, overallPct }) {
  const [hover, setHover] = useState(null);
  const [sort, setSort] = useState("default");
  const mounted = useMounted();
  const sel = filters.test_categories;
  const ax = niceAxis(Math.max(overallPct, ...rows.map((d) => d.ci_high ?? 0)));
  const x = (v) => Math.min(100, ((v ?? 0) / ax.domain[1]) * 100);
  const total = rows.reduce((s, r) => s + r.tests, 0);
  const maxTests = Math.max(1, ...rows.map((r) => r.tests));
  // rows keep their DOM order; only their vertical position changes, so a re-sort slides them
  const order = (SORTS[sort] ? [...rows].sort(SORTS[sort]) : rows).map((r) => r.group);
  const ext = extremes(rows);
  const focus = rows.find((r) => r.group === hover) ?? rows.find((r) => sel.includes(r.group)) ?? ext?.hi ?? rows[0];
  const pick = (g) => setFilters((f) => ({ ...f, test_categories: toggle(f.test_categories, g) }));

  return (
    <Card
      title="Positivity by test type"
      subtitle="Each test type reaches a different group of patients"
      action={
        <Segmented
          label="Sort test types"
          value={sort}
          onChange={setSort}
          options={[{ value: "default", label: "Default" }, { value: "pct", label: "Positivity" }, { value: "tests", label: "Tests" }]}
        />
      }
    >
      <Insight ext={ext} noun={(g) => g} color="var(--neg)" soft="from-hue-blue-soft" />

      <div className={`${ROW} mb-1 text-[10.5px] font-bold uppercase tracking-wider text-ink-3`}>
        <span>Test type</span><span>Positivity · 95% CI</span><span className="text-right">Rate</span>
        <span className="hidden text-right sm:block">Volume</span>
      </div>

      <div className="relative">
        {/* gridlines and the all-tests line, behind the rows */}
        <div aria-hidden="true" className={`pointer-events-none absolute inset-0 ${ROW}`}>
          <span />
          <div className="relative h-full">
            {ax.ticks.map((t) => <div key={t} className="absolute inset-y-0 w-px bg-line" style={{ left: `${x(t)}%` }} />)}
            <div className="absolute inset-y-0 z-10 border-l-2 border-dashed border-ink-3/60" style={{ left: `${x(overallPct)}%` }} />
          </div>
        </div>

        <div className="relative" style={{ height: rows.length * ROW_H }} onMouseLeave={() => setHover(null)}>
          {rows.map((d) => {
            const idx = order.indexOf(d.group);
            const picked = sel.includes(d.group);
            const fill = fillFor(sel, d.group, "var(--neg)", "var(--neg-soft)");
            const gap = d.pct == null ? null : d.pct - overallPct;
            return (
              <button
                key={d.group}
                type="button"
                aria-pressed={picked}
                aria-label={`${d.group}: ${fmtPct(d.pct)} positive. ${picked ? "Remove from" : "Add to"} filter`}
                onMouseEnter={() => setHover(d.group)}
                onFocus={() => setHover(d.group)}
                onBlur={() => setHover(null)}
                onClick={() => pick(d.group)}
                className={`${ROW} group absolute inset-x-0 top-0 rounded-xl text-left transition-[transform,opacity,background-color] duration-500 ease-out-soft ${
                  picked ? "bg-accent-soft/70 ring-1 ring-accent/25" : "hover:bg-bg"
                } ${hover && hover !== d.group ? "opacity-45" : ""}`}
                style={{ height: ROW_H - 4, transform: `translateY(${idx * ROW_H}px)` }}
              >
                <span className="flex min-w-0 items-center gap-2 text-[13px]">
                  {picked && <Check />}
                  <span className={`truncate ${picked || hover === d.group ? "font-semibold text-ink" : "text-ink-2"}`}>{d.group}</span>
                </span>

                <span className="relative h-full">
                  <span className="absolute left-0 top-1/2 h-3.5 -translate-y-1/2 rounded-r-full rounded-l-sm transition-[width,box-shadow] duration-700 ease-out-soft"
                    style={{
                      width: `${mounted ? x(d.pct) : 0}%`,
                      background: `linear-gradient(90deg, ${tint(fill, 55)}, ${fill})`,
                      boxShadow: hover === d.group ? `0 6px 18px -6px ${tint(fill, 80)}` : "none",
                    }} />
                  <span className="absolute top-1/2 h-px -translate-y-1/2 bg-ink-2 transition-opacity duration-500"
                    style={{ left: `${x(d.ci_low)}%`, width: `${x(d.ci_high) - x(d.ci_low)}%`, opacity: mounted ? 1 : 0 }}>
                    <span className="absolute -top-1 left-0 h-2 w-px bg-ink-2" />
                    <span className="absolute -top-1 right-0 h-2 w-px bg-ink-2" />
                  </span>
                </span>

                <span className="text-right">
                  <span className="num block text-[13.5px] font-bold text-ink">{fmtPct(d.pct)}</span>
                  <span className={`num block text-[10.5px] ${gap > 0 ? "text-pos" : "text-neg"}`}>{fmtGap(gap)}</span>
                </span>

                <span className="hidden text-right sm:block">
                  <span className="num block text-[12px] text-ink-2">{fmtInt(d.tests)}</span>
                  <span className="mt-1 ml-auto block h-1 w-16 rounded-full bg-bg">
                    <span className="ml-auto block h-full rounded-full bg-hue-violet transition-[width] duration-700 ease-out-soft"
                      style={{ width: `${mounted ? Math.max(4, (d.tests / maxTests) * 100) : 0}%` }} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div aria-hidden="true" className={`${ROW} mt-1`}>
          <span />
          <div className="relative h-4">
            {ax.ticks.map((t) => (
              <span key={t} className="num absolute -translate-x-1/2 text-[11px] text-ink-3" style={{ left: `${x(t)}%` }}>{pctTick(t)}</span>
            ))}
          </div>
        </div>
      </div>

      <Readout d={focus} overallPct={overallPct} total={total} color="var(--neg)" picked={sel.includes(focus?.group)} noun={(g) => g} />
      <Hint>Click a row to filter by that test type; click again to remove it. Dashed line: all tests ({fmtPct(overallPct)}).</Hint>
    </Card>
  );
}
