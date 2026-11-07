import { useRef, useState } from "react";
import { AnimatedNumber, Card, Segmented } from "./ui.jsx";
import { fmtInt } from "../lib/format.js";
import { useMounted } from "../lib/motion.js";

const th = "py-2 pr-4 text-left text-[11px] font-bold uppercase tracking-wider text-ink-3 whitespace-nowrap";
const td = "py-2.5 pr-4 align-top";
const code = (s) =>
  String(s ?? "").split(/`([^`]+)`/).map((part, i) =>
    i % 2 ? <code key={i} className="rounded border border-line bg-bg px-1 font-mono text-[12px]">{part}</code> : part,
  );

// What part of the intake each raw column belongs to (display only; anything unlisted is "Other").
const FIELD_GROUPS = [
  { name: "Other tests", color: "var(--hue-violet)", test: (c) => /^(rapid_|cxr_)/.test(c) },
  { name: "Vitals", color: "var(--hue-teal)", test: (c) => /^(temperature|pulse|sys|dia|rr|sats)$/.test(c) },
  { name: "Exam", color: "var(--hue-blue)", test: (c) => /^(rhonchi|wheezes|ctab|labored_respiration)$/.test(c) },
  { name: "Symptoms", color: "var(--hue-coral)", test: (c) => /(severity|fever|sob|cough|loss_of|diarrhea|runny|sore|headache|muscle|fatigue|symptom)/.test(c) },
];
const groupOf = (c) => FIELD_GROUPS.find((g) => g.test(c)) ?? { name: "Other", color: "var(--ns)" };

const BANDS = [
  { label: "Almost empty", min: 90, color: "var(--pos)" },
  { label: "Mostly empty", min: 50, color: "color-mix(in srgb, var(--pos) 55%, var(--surface))" },
  { label: "Partly filled", min: 10, color: "color-mix(in srgb, var(--neg) 55%, var(--surface))" },
  { label: "Nearly complete", min: 0, color: "var(--neg)" },
];
const MISS_ROW = "grid grid-cols-[minmax(8rem,11.5rem)_1fr_3.5rem] items-center gap-3";

/** Threshold handle: drag it across the plot, or focus it and use the arrow keys. */
function useThreshold(initial) {
  const [cut, setCut] = useState(initial);
  const plotRef = useRef(null);
  const fromPointer = (e) => {
    const r = plotRef.current?.getBoundingClientRect();
    if (!r) return;
    setCut(Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)) / 5) * 5);
  };
  const handle = {
    role: "slider", tabIndex: 0, "aria-label": "Missingness threshold", "aria-valuemin": 0, "aria-valuemax": 100,
    "aria-valuenow": cut, "aria-valuetext": `${cut}% missing`,
    onPointerDown: (e) => { e.currentTarget.setPointerCapture(e.pointerId); fromPointer(e); },
    onPointerMove: (e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e); },
    onKeyDown: (e) => {
      const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 }[e.key];
      if (step) { e.preventDefault(); setCut((c) => Math.min(100, Math.max(0, c + step))); }
    },
  };
  return { cut, plotRef, handle };
}

function MissingChart({ all }) {
  const [show, setShow] = useState("top");
  const [hover, setHover] = useState(null);
  const mounted = useMounted();
  const { cut, plotRef, handle } = useThreshold(50);
  const miss = show === "top" ? all.slice(0, 25) : all;
  const over = miss.filter((m) => m.pct > cut).length;
  const bands = BANDS.map((b, i) => ({
    ...b, n: all.filter((m) => m.pct >= b.min && (i === 0 || m.pct < BANDS[i - 1].min)).length,
  }));
  const groups = FIELD_GROUPS.filter((g) => miss.some((m) => g.test(m.column)));

  return (
    <Card
      title="Missing values in the raw data"
      subtitle={`${show === "top" ? "Top 25" : `All ${all.length}`} columns with gaps · orange = more than ${cut}% missing`}
      action={
        <Segmented label="Columns shown" value={show} onChange={setShow}
          options={[{ value: "top", label: "Top 25" }, { value: "all", label: `All ${all.length}` }]} />
      }
    >
      {/* how the columns split by missingness */}
      <div className="mb-4 rounded-2xl border border-line bg-bg/60 p-3">
        <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
          {bands.filter((b) => b.n).map((b) => (
            <span key={b.label} title={`${b.label}: ${b.n} columns`} className="h-full transition-[width] duration-700 ease-out-soft first:rounded-l-full last:rounded-r-full"
              style={{ width: mounted ? `${(b.n / all.length) * 100}%` : 0, background: b.color }} />
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
          {bands.map((b) => (
            <div key={b.label} className="flex items-baseline gap-1.5">
              <i className="h-2 w-2 shrink-0 rounded-sm" style={{ background: b.color }} />
              <span className="num text-[15px] font-bold">{b.n}</span>
              <span className="truncate text-[11.5px] text-ink-3">{b.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink-3">
          {groups.map((g) => (
            <span key={g.name} className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full" style={{ background: g.color }} />{g.name}</span>
          ))}
        </div>
        <span key={`${over}-${cut}`} className="animate-fade-in rounded-full bg-pos-soft px-2 py-0.5 text-[12px] font-semibold text-ink">
          {over} of {miss.length} over {cut}%
        </span>
      </div>

      <div className="relative">
        {/* gridlines, threshold shading and the draggable handle share the plot column */}
        <div className={`pointer-events-none absolute inset-0 ${MISS_ROW}`}>
          <span />
          <div ref={plotRef} className="relative h-full">
            {[0, 25, 50, 75, 100].map((t) => <div key={t} className="absolute inset-y-0 w-px bg-line" style={{ left: `${t}%` }} />)}
            <div className="absolute inset-y-0 right-0 bg-pos/5 transition-all duration-150" style={{ left: `${cut}%` }} />
            <div {...handle}
              className="pointer-events-auto absolute -inset-y-1 z-20 w-4 -translate-x-1/2 cursor-ew-resize touch-none focus-visible:outline-none"
              style={{ left: `${cut}%` }}>
              <span className="absolute inset-y-0 left-1/2 border-l-2 border-dashed border-ink-2" />
              <span className="num absolute top-0 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-2 py-0.5 text-[11px] font-semibold text-bg shadow-md ring-accent focus-within:ring-2">
                ⇆ {cut}%
              </span>
            </div>
          </div>
        </div>

        <div className="relative grid pt-7" onMouseLeave={() => setHover(null)}>
          {miss.map((m, i) => {
            const g = groupOf(m.column);
            const above = m.pct > cut;
            const color = above ? "var(--pos)" : "var(--neg)";
            return (
              <div key={m.column} onMouseEnter={() => setHover(m.column)}
                className={`${MISS_ROW} h-[26px] rounded-md transition-opacity duration-200 ${hover && hover !== m.column ? "opacity-45" : ""}`}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <i className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: g.color }} title={g.name} />
                  <span className={`truncate font-mono text-[11.5px] ${hover === m.column ? "text-ink" : "text-ink-2"}`}>{m.column}</span>
                </span>
                <span className="relative h-2.5 rounded-full bg-bg">
                  <span className="absolute inset-y-0 left-0 rounded-full transition-[width,background] duration-500 ease-out-soft"
                    style={{
                      width: `${mounted ? Math.max(0.6, m.pct) : 0}%`, transitionDelay: mounted ? "0ms" : `${i * 20}ms`,
                      background: `linear-gradient(90deg, color-mix(in srgb, ${color} 45%, transparent), ${color})`,
                    }} />
                </span>
                <span className={`num text-right text-[12px] ${above ? "font-semibold text-ink" : "text-ink-2"}`}>{m.pct.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
        <div aria-hidden="true" className={`${MISS_ROW} mt-1`}>
          <span />
          <div className="relative h-4">
            {[0, 25, 50, 75, 100].map((t) => <span key={t} className="num absolute -translate-x-1/2 text-[11px] text-ink-3" style={{ left: `${t}%` }}>{t}%</span>)}
          </div>
        </div>
      </div>

      <p className="mt-2 text-[12px] text-ink-3">
        Drag the dashed handle (or focus it and use the arrow keys) to move the threshold. Gaps follow the testing
        pathway and changes to the intake form over time. Missing answers are kept as Unknown, never counted as No.
      </p>
    </Card>
  );
}

const splitLabel = (label) => {
  const m = /^(.*?)\s*\(([^)]*)\)$/.exec(label);
  return m ? { name: m[1], unit: m[2] } : { name: label, unit: "" };
};
const niceStep = (span) => {
  const raw = span / 4, p = 10 ** Math.floor(Math.log10(raw)), r = raw / p;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p;
};

/** Positive vs negative interquartile boxes with medians, on a scale shared by the two. */
function VitalTile({ v, index }) {
  const mounted = useMounted();
  const { name, unit } = splitLabel(v.label);
  const lo0 = Math.min(v.positive.q1, v.negative.q1), hi0 = Math.max(v.positive.q3, v.negative.q3);
  const step = niceStep((hi0 - lo0) || 1);
  const lo = Math.floor((lo0 - step / 2) / step) * step, hi = Math.ceil((hi0 + step / 2) / step) * step;
  const ticks = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(+t.toFixed(4));
  const x = (n) => ((n - lo) / (hi - lo)) * 100;
  const diff = +(v.positive.median - v.negative.median).toFixed(2);
  const unitText = unit === "%" ? " pts" : unit.startsWith("/") ? ` ${unit}` : unit ? ` ${unit}` : "";

  const lane = (k, color, label) => {
    const s = v[k];
    return (
      <div className="grid grid-cols-[7.25rem_1fr] items-center gap-3" title={`${label}: median ${s.median}, IQR ${s.q1}–${s.q3}, n=${fmtInt(s.n)}`}>
        <span className="num flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-ink-2">
          <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
          <b className="font-semibold text-ink">{s.median}</b><span className="text-ink-3">{s.q1}–{s.q3}</span>
        </span>
        <div className="relative h-6">
          {/* IQR box grows out from the median */}
          <span className="absolute inset-y-1 rounded-md border-2 transition-all duration-700 ease-out-soft"
            style={{
              left: `${mounted ? x(s.q1) : x(s.median)}%`, right: `${100 - (mounted ? x(s.q3) : x(s.median))}%`,
              borderColor: color, background: `color-mix(in srgb, ${color} 18%, transparent)`, transitionDelay: `${index * 60}ms`,
            }} />
          <span className="absolute inset-y-0 w-[3px] -translate-x-1/2 rounded-full transition-transform duration-200 group-hover:scale-y-110"
            style={{ left: `${x(s.median)}%`, background: color }} />
          <span className="num absolute -top-0.5 -translate-x-1/2 -translate-y-full whitespace-nowrap text-[11px] font-semibold text-ink opacity-0 transition-opacity group-hover:opacity-100"
            style={{ left: `${x(s.median)}%` }}>{s.median}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="group animate-rise rounded-2xl border border-line p-3 transition-colors hover:border-line-strong hover:bg-bg/60" style={{ animationDelay: `${index * 60}ms` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[14px] font-bold leading-tight">{name}</span>
          {unit && <span className="text-[11.5px] text-ink-3">{unit}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="num text-[10.5px] text-ink-3">n {fmtInt(v.positive.n)} / {fmtInt(v.negative.n)}</span>
          <span className={`num inline-block rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${
            diff === 0 ? "bg-bg text-ink-3" : diff > 0 ? "bg-pos-soft text-ink" : "bg-neg-soft text-ink"}`}>
            {diff === 0 ? "Same median" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)}${unitText} in positive`}
          </span>
        </div>
      </div>

      <div className="relative mt-2">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-[7.25rem_1fr] gap-3">
          <span />
          <div className="relative">{ticks.map((t) => <div key={t} className="absolute inset-y-0 w-px bg-line" style={{ left: `${x(t)}%` }} />)}</div>
        </div>
        <div className="relative grid gap-0.5" role="img"
          aria-label={`${name}: positive median ${v.positive.median}, IQR ${v.positive.q1} to ${v.positive.q3}; negative median ${v.negative.median}, IQR ${v.negative.q1} to ${v.negative.q3}`}>
          {lane("positive", "var(--pos)", "Positive")}
          {lane("negative", "var(--neg)", "Negative")}
        </div>
        <div aria-hidden="true" className="mt-0.5 grid grid-cols-[7.25rem_1fr] gap-3">
          <span className="text-[10.5px] text-ink-3">median · IQR</span>
          <div className="relative h-4">
            {ticks.map((t) => <span key={t} className="num absolute -translate-x-1/2 text-[10.5px] text-ink-3" style={{ left: `${x(t)}%` }}>{t}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}

function VitalsCard({ vitals }) {
  return (
    <Card title="Vital signs at testing" subtitle="Median and interquartile range for patients examined in clinic">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="relative inline-block h-3 w-6 rounded-sm border-2 border-ink-3"><span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-ink-3" /></span>
          box = middle 50% of patients, bar = median
        </span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-pos" />Positive</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-neg" />Negative</span>
      </div>
      <div className="grid gap-3">
        {vitals.map((v, i) => <VitalTile key={v.key} v={v} index={i} />)}
      </div>
      <p className="mt-3 text-[12px] text-ink-3">
        Hover a tile to label the medians on the plot. Differences are small: positive patients ran slightly warmer
        with slightly faster pulses, but their ranges overlap heavily with negative patients.
      </p>
    </Card>
  );
}

export default function QualityTab({ q }) {
  const mounted = useMounted();
  if (!q) return null;
  const d = q.duplicates;
  const maxRows = Math.max(1, ...q.cleaning_log.map((l) => l.rows_affected ?? 0));
  return (
    <div className="grid gap-4">
      <div className="animate-rise rounded-2xl border-l-4 border-[#f0b429] bg-warn-bg p-4 text-[14px] leading-relaxed text-warn-ink sm:p-5">
        <b><AnimatedNumber value={d.n} format={fmtInt} /> rows are exact duplicates.</b> The data has no patient ID, so they could be different people
        with identical answers. Nearly all are negative tests with few fields filled in. They are kept in every figure
        on this site. Without them, overall positivity would be{" "}
        <span className="num font-semibold">{d.positivity_without_pct.toFixed(2)}%</span> instead of{" "}
        <span className="num font-semibold">{d.positivity_with_pct.toFixed(2)}%</span>.
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MissingChart all={q.missingness} />

        <VitalsCard vitals={q.vitals} />
      </div>

      <Card title="Cleaning log" subtitle="Every change made to the raw extract, in the order applied">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13.5px]">
            <thead className="border-b border-line">
              <tr><th className={th}>Step</th><th className={th}>Field</th><th className={th}>What we found</th><th className={th}>What we did</th><th className={`${th} text-right`}>Rows</th></tr>
            </thead>
            <tbody>
              {q.cleaning_log.map((l, i) => (
                <tr key={i} className="animate-fade-in border-b border-line transition-colors last:border-0 hover:bg-bg" style={{ animationDelay: `${i * 30}ms` }}>
                  <td className={`${td} num text-ink-3`}>{l.step}</td>
                  <td className={`${td} font-medium`}>{l.variable}</td>
                  <td className={`${td} text-ink-2`}>{code(l.issue)}</td>
                  <td className={td}>{code(l.decision)}</td>
                  <td className={`${td} num text-right`}>
                    {l.rows_affected == null ? "–" : fmtInt(l.rows_affected)}
                    {l.rows_affected > 0 && (
                      <div className="ml-auto mt-1 h-1 w-20 rounded-full bg-bg">
                        <div className="ml-auto h-full rounded-full bg-linear-to-l from-accent to-accent-2 transition-[width] duration-700 ease-out-soft"
                          style={{ width: mounted ? `${Math.max(4, (l.rows_affected / maxRows) * 100)}%` : 0 }} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
