import { useEffect, useMemo, useRef, useState } from "react";
import { getBayesGraph, queryBayes, rankBayes } from "../api.js";
import { C, niceAxis, pctTick } from "../lib/chart.js";
import { fmtInt, fmtPct } from "../lib/format.js";
import { PlotFrame, tint } from "./plots.jsx";
import { AnimatedNumber, Card, Chip, ELEVATE, Hint, Segmented, TipBox } from "./ui.jsx";

const NOT_SET = "";
const MIN_MATCHES = 30;

// Short names for the network diagram
const SHORT = {
  covid: "COVID", age_group: "Age", high_risk_exposure_occupation: "Occupation", high_risk_interactions: "Contacts",
  fever: "Fever", cough: "Cough", sob: "Breathless", fatigue: "Fatigue", headache: "Headache",
  loss_of_smell: "Smell loss", loss_of_taste: "Taste loss", runny_nose: "Runny nose", muscle_sore: "Muscle ache",
  sore_throat: "Sore throat", diarrhea: "Diarrhoea",
};

const EXAMPLES = [
  { label: "Lost sense of smell", evidence: { loss_of_smell: "Yes" } },
  { label: "61+ with fever and cough", evidence: { age_group: "61+", fever: "Yes", cough: "Yes" } },
  { label: "No symptoms at all", evidence: null },
  { label: "Patients who tested positive", evidence: { covid: "Positive" } },
];

/** Debounced backend call (query or ranking) whenever the evidence changes; skipped while `enabled` is false. */
function useBayesQuery(evidence, delay = 150, call = queryBayes, enabled = true) {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const key = JSON.stringify(evidence);
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    setBusy(true);
    const t = setTimeout(() => {
      call(JSON.parse(key), ctrl.signal)
        .then((r) => { setRes(r); setError(null); setBusy(false); })
        .catch((e) => { if (e.name !== "AbortError") { setError(e.message); setBusy(false); } });
    }, delay);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [key, delay, call, enabled]);
  return { res, busy, error };
}

// ------------------------------------------------------------------ profile ---
function ToggleRow({ node, value, onChange }) {
  const states = node.states.filter((s) => s !== "Unknown"); // a missing answer is "Not set", not evidence
  const options = [...states].reverse().map((s) => ({ value: s, label: s })); // Yes / No, Positive / Negative
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className={`flex min-w-0 items-center gap-2 text-[13.5px] ${value ? "font-semibold text-ink" : "text-ink-2"}`}>
        <i className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${value ? "bg-accent" : "bg-line-strong"}`} />
        <span className="truncate">{node.label}</span>
      </span>
      <Segmented label={node.label} value={value ?? NOT_SET} onChange={(v) => onChange(node.id, v)}
        options={[...options, { value: NOT_SET, label: "Not set" }]} />
    </div>
  );
}

function Group({ title, children, className = "" }) {
  return (
    <div className={`border-t border-line pt-2 first:border-t-0 first:pt-0 ${className}`}>
      <h3 className="mb-1 text-[11.5px] font-bold uppercase tracking-wider text-ink-3">{title}</h3>
      {children}
    </div>
  );
}

function Profile({ graph, evidence, onSet, onReset, onExample }) {
  const by = (kind) => graph.nodes.filter((n) => n.kind === kind);
  const age = graph.nodes.find((n) => n.id === "age_group");
  const n = Object.keys(evidence).length;
  return (
    <Card title="Patient profile" subtitle="Set what's known. Anything left on Not set is averaged over." className="flex flex-col"
      action={
        <button type="button" onClick={onReset} disabled={!n}
          className="rounded-lg border border-line px-2.5 py-1 text-[12.5px] font-semibold text-ink-2 transition-colors hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink-2">
          Reset{n ? ` (${n})` : ""}
        </button>
      }>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[12px] text-ink-3">Try:</span>
        {EXAMPLES.map((x) => (
          <button key={x.label} type="button" onClick={() => onExample(x.evidence)}
            className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[12px] font-semibold text-accent transition-transform hover:-translate-y-px active:scale-95">
            {x.label}
          </button>
        ))}
      </div>

      {/* fills the height of the charts beside it; the symptom rows spread out evenly */}
      <div className="flex flex-1 flex-col gap-2">
        <Group title="Test result">
          {by("target").map((node) => <ToggleRow key={node.id} node={node} value={evidence[node.id]} onChange={onSet} />)}
        </Group>
        <Group title="Age group">
          <div className="flex flex-wrap gap-1.5 py-1.5">
            <Chip active={!evidence.age_group} onClick={() => onSet("age_group", NOT_SET)}>Not set</Chip>
            {age.states.map((s) => (
              <Chip key={s} active={evidence.age_group === s} onClick={() => onSet("age_group", evidence.age_group === s ? NOT_SET : s)}>
                {graph.age_group_labels[s] ?? s}
              </Chip>
            ))}
          </div>
        </Group>
        <Group title="High-risk exposure">
          {by("exposure").map((node) => <ToggleRow key={node.id} node={node} value={evidence[node.id]} onChange={onSet} />)}
        </Group>
        <Group title="Symptoms" className="flex flex-1 flex-col">
          <div className="flex flex-1 flex-col divide-y divide-line">
            {by("symptom").map((node) => (
              <div key={node.id} className="flex min-h-11 flex-1 items-center [&>*]:w-full">
                <ToggleRow node={node} value={evidence[node.id]} onChange={onSet} />
              </div>
            ))}
          </div>
        </Group>
      </div>
      <ProfileSummary graph={graph} evidence={evidence} onSet={onSet} />
    </Card>
  );
}

/** The answers given so far, each removable. */
function ProfileSummary({ graph, evidence, onSet }) {
  const label = Object.fromEntries(graph.nodes.map((n) => [n.id, n.label]));
  const set = graph.nodes.filter((n) => evidence[n.id]);
  return (
    <div className="mt-4 rounded-xl bg-linear-to-br from-accent-soft to-bg p-3 ring-1 ring-line">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11.5px] font-bold uppercase tracking-wider text-ink-3">Your profile</span>
        <span className="num text-[11.5px] text-ink-3">{set.length} of {graph.nodes.length} set</span>
      </div>
      {set.length ? (
        <div className="flex flex-wrap gap-1.5">
          {set.map((n) => (
            <span key={n.id} className="inline-flex animate-pop items-center gap-1 rounded-full bg-surface py-0.5 pl-2.5 pr-1 text-[12.5px] text-ink shadow-sm ring-1 ring-line">
              {label[n.id]}: <b className="font-semibold text-accent">{graph.age_group_labels?.[evidence[n.id]] ?? evidence[n.id]}</b>
              <button type="button" aria-label={`Remove ${label[n.id]}`} onClick={() => onSet(n.id, NOT_SET)}
                className="grid h-4.5 w-4.5 place-items-center rounded-full text-ink-3 transition-colors hover:bg-pos-soft hover:text-ink">
                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden="true"><path d="M3 3l6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[12.5px] leading-snug text-ink-2">Nothing set yet, so the estimates describe everyone in the data. Pick an answer above or try an example.</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------ shared plot bits ---
// Ranking and symptom charts share one row grid so labels, plots and values line up card to card.
const ROW = "grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_3.5rem] items-center gap-x-3 sm:grid-cols-[minmax(0,11.5rem)_minmax(0,1fr)_4rem]";
const P_TICKS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1];
const fmtP = (t) => `${+(100 * t).toPrecision(2)}%`;
const fmtRatio = (r) => (r == null ? "–" : `${r.toFixed(r < 10 ? 1 : 0)}×`);
const raises = (f) => f.variable === "age_group" || f.highest === "Yes";
const weakEffect = (f) => (f.ratio ?? 1) < 1.1;
const effectColor = (f) => (weakEffect(f) ? C.ns : raises(f) ? C.pos : C.neg);

/** Log scale for probabilities, snapped to round ticks around the values. */
function probScale(values, pad = 1.15) {
  const v = values.filter((p) => p > 0);
  const lo = v.length ? [...P_TICKS].reverse().find((t) => t <= Math.min(...v) / pad) ?? 0.001 : 0.001;
  const hi = v.length ? P_TICKS.find((t) => t >= Math.max(...v) * pad) ?? 1 : 1;
  const x = (p) => Math.min(100, Math.max(0, (100 * (Math.log(Math.max(p, lo)) - Math.log(lo))) / (Math.log(hi) - Math.log(lo))));
  return { x, ticks: P_TICKS.filter((t) => t >= lo && t <= hi) };
}

/** Floating tooltip anchored to the pointer (or the focused element), kept inside its container. */
function useTip() {
  const ref = useRef(null);
  const [tip, setTip] = useState(null);
  const show = (e, content) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const r = e.currentTarget.getBoundingClientRect();
    const mouse = e.type.startsWith("mouse") || e.type.startsWith("pointer");
    const x = mouse ? e.clientX : r.left + r.width / 2, y = mouse ? e.clientY : r.top;
    setTip({ ...content, left: Math.min(Math.max(x - box.left, 120), box.width - 120), top: y - box.top });
  };
  return { ref, tip, show, hide: () => setTip(null) };
}

function Tip({ tip }) {
  if (!tip) return null;
  return (
    <div className="pointer-events-none absolute z-20" style={{ left: tip.left, top: tip.top, transform: "translate(-50%, calc(-100% - 12px))" }}>
      <TipBox title={tip.title} rows={tip.rows} />
    </div>
  );
}

// ------------------------------------------------------------------ headline ---
function Waffle({ p, base }) {
  const k = Math.round(100 * p), kb = Math.round(100 * base);
  return (
    <div className="grid grid-cols-10 gap-[3px]" role="img" aria-label={`About ${k} in 100 patients with this profile tested positive`}>
      {Array.from({ length: 100 }, (_, i) => (
        <span key={i} className="h-2.5 w-2.5 rounded-full transition-[background-color,box-shadow] duration-500"
          style={{
            background: i < k ? C.pos : "var(--line)",
            boxShadow: i >= k && i < kb ? `inset 0 0 0 1.5px ${C.ink2}` : "none",
            transitionDelay: `${Math.min(i, 60) * 5}ms`,
          }} />
      ))}
    </div>
  );
}

/** Log-scale track from 0.1% to 100% with markers for everyone and for this profile. */
function Meter({ p, base }) {
  const { x, ticks } = probScale([0.001, 1], 1);
  const shown = ticks.filter((t) => [0.001, 0.01, 0.1, 1].includes(t));
  return (
    <div className="relative mt-5 pb-5 pt-6">
      <div className="h-2.5 rounded-full" style={{ background: `linear-gradient(90deg, ${tint(C.neg, 30)}, ${tint(C.ns, 18)} 40%, ${tint(C.pos, 70)})` }} />
      {shown.map((t) => (
        <span key={t} className="num absolute bottom-0 -translate-x-1/2 text-[10.5px] text-ink-3" style={{ left: `${x(t)}%` }}>{fmtP(t)}</span>
      ))}
      {base != null && (
        <span className="absolute top-[18px] flex -translate-x-1/2 flex-col items-center transition-[left] duration-700 ease-out-soft" style={{ left: `${x(base)}%` }}>
          <span className="absolute -top-5 whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">Everyone</span>
          <i className="h-[22px] w-0.5 rounded-full bg-ink-2" />
        </span>
      )}
      {p != null && (
        <span className="absolute top-[29px] h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-surface bg-pos shadow-[0_0_0_4px_color-mix(in_srgb,var(--pos)_25%,transparent)] transition-[left] duration-700 ease-out-soft"
          style={{ left: `${x(p)}%` }} />
      )}
    </div>
  );
}

function Headline({ res, base, overall, evidence, busy }) {
  const covidSet = evidence.covid;
  const p = res?.probabilities?.Positive;
  const b = base?.probabilities?.Positive;
  const ratio = p != null && b ? p / b : null;
  const n = res?.matching_patients;
  const few = n != null && n < MIN_MATCHES;
  const k = p == null ? null : Math.round(100 * p);
  return (
    <Card title="Patients with this profile" subtitle="Bayesian-network estimate from 2020 test results">
      <div className={`transition-opacity ${busy ? "opacity-60" : ""}`}>
        {covidSet ? (
          <div className="rounded-2xl bg-linear-to-r from-accent-soft to-transparent px-4 py-4 text-[14px] leading-relaxed text-ink-2">
            <b className="text-ink">Test result is set to {covidSet}.</b> The symptom chart below shows what patients who tested{" "}
            {covidSet.toLowerCase()} reported, given the rest of the profile.
          </div>
        ) : (
          <>
            <div className="grid items-center gap-x-6 gap-y-4 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <div className="text-[12.5px] font-semibold text-ink-3">Probability of a positive test</div>
                <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-2">
                  <span className="text-[46px] font-bold leading-none tracking-tight tabular-nums text-pos sm:text-[54px]">
                    {p == null ? "–" : <AnimatedNumber value={100 * p} format={(v) => fmtPct(v, v < 10 ? 2 : 1)} />}
                  </span>
                  {ratio != null && Object.keys(evidence).length > 0 && (
                    <span className="num mb-1.5 inline-flex rounded-full px-2.5 py-1 text-[13px] font-bold text-ink"
                      style={{ background: tint(ratio >= 1 ? C.pos : C.neg, 22) }}>
                      {ratio >= 1 ? `${ratio.toFixed(ratio < 10 ? 1 : 0)}× everyone` : `${(1 / ratio).toFixed(1)}× lower`}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[13.5px] leading-snug text-ink-2">
                  {k == null ? "–" : k < 1 ? <>Fewer than <b className="text-ink">1 in 100</b> patients with this profile</> : <>About <b className="text-ink">{k} in 100</b> patients with this profile</>}{" "}
                  tested positive, against <b className="num text-ink">{b == null ? "–" : fmtPct(100 * b)}</b> of everyone.
                </p>
              </div>
              {p != null && b != null && (
                <div className="justify-self-start sm:justify-self-end">
                  <Waffle p={p} base={b} />
                  <div className="mt-2 flex gap-3 text-[11px] text-ink-3">
                    <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-pos" />This profile</span>
                    <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full ring-[1.5px] ring-ink-2 ring-inset" />Everyone</span>
                  </div>
                </div>
              )}
            </div>
            <Meter p={p} base={b} />
          </>
        )}

        <div className={`mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] leading-snug ${few ? "bg-warn-bg text-warn-ink" : "bg-bg text-ink-2"}`}>
          <svg viewBox="0 0 20 20" className="mt-px h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            {few ? <path d="M10 3 2.5 16.5h15L10 3Zm0 5v4m0 2.5v.01" /> : <path d="M7 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-4.5 8a4.5 4.5 0 0 1 9 0M14 9a2.5 2.5 0 1 0 0-5M15 12.5a4 4 0 0 1 2.5 3.8" />}
          </svg>
          <div>
            Matching patients in the data: <b className="num">{n == null ? "–" : fmtInt(n)}</b>
            {few && <div className="mt-0.5">{res.warning}</div>}
          </div>
        </div>
        {!covidSet && overall != null && (
          <Hint>Overall positivity in the full data: {fmtPct(overall)}. The model's "everyone" figure is a little higher because it
            learns from tests where every symptom was recorded.</Hint>
        )}
      </div>
    </Card>
  );
}

// ----------------------------------------------------------------- ranking ---
const RANK_H = 48;

/** One feature's effect: its states as dots on the probability scale, joined from lowest to highest. */
function EffectMark({ f, x, active, ageLabel }) {
  const p = f.p_positive_by_state;
  const color = effectColor(f);
  const lo = x(p[f.lowest]), hi = x(p[f.highest]);
  return (
    <>
      <span className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full transition-all duration-500 ease-out-soft"
        style={{ left: `${Math.min(lo, hi)}%`, width: `${Math.abs(hi - lo)}%`, background: `linear-gradient(90deg, ${tint(color, 18)}, ${tint(color, 60)})` }} />
      {Object.entries(p).map(([s, v]) => {
        const top = s === f.highest && !weakEffect(f);
        const set = f.set === s;
        return (
          <span key={s} title={`${ageLabel(s)}: ${fmtPct(100 * v)}`}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-500 ease-out-soft"
            style={{
              left: `${x(v)}%`, width: top ? 14 : 10, height: top ? 14 : 10,
              background: top ? color : "var(--surface)", border: `2px solid ${top ? "var(--surface)" : color}`,
              boxShadow: set ? `0 0 0 3px ${C.accent}` : active && top ? `0 0 0 5px ${tint(color, 25)}` : "none",
            }} />
        );
      })}
    </>
  );
}

function Ranking({ graph, inf, evidence, busy, focus, onFocus, onSet }) {
  const label = Object.fromEntries(graph.nodes.map((n) => [n.id, n.label]));
  const ageLabel = (s) => graph.age_group_labels?.[s] ?? s;
  const { ref, tip, show, hide } = useTip();
  if (evidence.covid) {
    return (
      <Card title="What moves the estimate" subtitle="Features ranked by their effect on a positive test">
        <p className="rounded-2xl bg-bg px-4 py-4 text-[13.5px] leading-relaxed text-ink-2">
          The ranking measures each feature's effect on the test result, so it needs the test result to be <b className="text-ink">Not set</b>.
        </p>
      </Card>
    );
  }
  const rows = inf?.factors ?? [];
  const { x, ticks } = probScale([...rows.flatMap((f) => Object.values(f.p_positive_by_state)), inf?.p_positive ?? 0.01]);
  const tipFor = (f) => ({
    title: `#${f.rank} ${label[f.variable]} · ${fmtRatio(f.ratio)}`,
    rows: [
      ...Object.entries(f.p_positive_by_state).map(([s, v]) => [
        `${f.variable === "age_group" ? ageLabel(s) : `If ${s}`}${f.set === s ? " (set)" : ""}`,
        `${fmtPct(100 * v)} · n ${fmtInt(f.patients_by_state[s])}`, s === f.highest ? effectColor(f) : undefined]),
      ["If not set", fmtPct(100 * f.p_positive_if_not_set)],
    ],
  });
  return (
    <Card title="What moves the estimate"
      subtitle="Each feature's states on the chance of a positive test, with the rest of your profile held fixed. Ranked by the gap.">
      <div ref={ref} className={`relative transition-opacity ${busy ? "opacity-60" : ""}`} onMouseLeave={() => { hide(); onFocus(null); }}>
        <PlotFrame row={ROW} x={x} ticks={ticks} fmt={fmtP} refValue={inf?.p_positive} refLabel="Your profile"
          zones={`linear-gradient(90deg, ${tint(C.neg, 5)}, transparent 45%, ${tint(C.pos, 7)})`}
          bodyClass="" bodyStyle={{ height: rows.length * RANK_H }}>
          {rows.map((f, i) => {
            const on = focus === f.variable;
            const weak = weakEffect(f);
            return (
              <button key={f.variable} type="button"
                aria-label={`${label[f.variable]}: effect ${fmtRatio(f.ratio)}. ${f.set ? "Click to remove from the profile" : "Click to add to the profile"}`}
                onMouseEnter={() => onFocus(f.variable)} onMouseMove={(e) => show(e, tipFor(f))}
                onFocus={(e) => { onFocus(f.variable); show(e, tipFor(f)); }} onBlur={() => { onFocus(null); hide(); }}
                onClick={() => onSet(f.variable, f.set ? NOT_SET : f.highest)}
                className={`group absolute inset-x-0 ${ROW} rounded-xl text-left transition-[transform,background-color] duration-500 ease-out-soft ${on ? "bg-accent-soft/70" : "hover:bg-bg/70"}`}
                style={{ height: RANK_H - 4, transform: `translateY(${i * RANK_H}px)` }}>
                <span className="flex min-w-0 items-center gap-2 pl-1">
                  <span className={`num grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11.5px] font-bold ${f.rank <= 3 && !weak ? "bg-linear-to-br from-accent to-accent-2 text-white shadow-sm" : "bg-surface text-ink-3 ring-1 ring-line"}`}>
                    {f.rank}
                  </span>
                  <span className="min-w-0">
                    <span className={`block truncate text-[13.5px] ${on ? "font-semibold text-ink" : "text-ink"}`}>{label[f.variable]}</span>
                    {f.set && <span className="block truncate text-[11px] font-semibold text-accent">set: {ageLabel(f.set)}</span>}
                  </span>
                </span>
                <span className="relative h-full self-stretch">
                  <EffectMark f={f} x={x} active={on} ageLabel={ageLabel} />
                </span>
                <span className="num justify-self-end rounded-full px-2 py-0.5 text-[12px] font-bold text-ink transition-colors"
                  style={{ background: tint(effectColor(f), on ? 34 : weak ? 12 : 20) }}>{fmtRatio(f.ratio)}</span>
              </button>
            );
          })}
        </PlotFrame>
        <Tip tip={tip} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-full border-2 border-surface bg-pos ring-1 ring-pos" />Yes raises the chance</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-full border-2 border-surface bg-neg ring-1 ring-neg" />Yes lowers it</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full border-2 border-ns" />Other state</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full ring-[3px] ring-accent" />In your profile</span>
      </div>
      <Hint>Log scale. The gap between a feature's dots is its effect; the pill gives it as a ratio (1.0× = no effect). Hover for patient
        counts; click a row to add its higher-risk answer to the profile.</Hint>
    </Card>
  );
}

// ------------------------------------------------------------- symptom bars ---
const SYM_H = 34;

function SymptomBars({ graph, res, base, evidence, busy, onSet }) {
  const [sort, setSort] = useState("common");
  const [hover, setHover] = useState(null);
  const { ref, tip, show, hide } = useTip();
  const yes = (r, id) => r?.marginals?.[id]?.Yes;
  const all = graph.nodes.filter((n) => n.kind === "symptom").map((n) => {
    const v = yes(res, n.id), b = yes(base, n.id);
    return { ...n, v, b, set: evidence[n.id], change: v != null && b ? v / b : null };
  });
  const free = (r) => !r.set;
  const rows = [...all].sort((a, b) => sort === "change"
    ? (free(b) - free(a)) || (b.change ?? 0) - (a.change ?? 0)
    : (b.b ?? 0) - (a.b ?? 0));
  const ax = niceAxis(100 * Math.min(1, Math.max(0.05, ...all.filter(free).map((r) => Math.max(r.v ?? 0, r.b ?? 0)))), 4);
  const top = ax.domain[1];
  const x = (pct) => Math.min(100, (100 * pct) / top);
  const color = evidence.covid === "Positive" ? C.pos : evidence.covid === "Negative" ? C.neg : C.accent;
  const who = evidence.covid ? `patients who tested ${evidence.covid.toLowerCase()}` : "patients with this profile";
  const profiled = Object.keys(evidence).length > 0;
  return (
    <Card title="Symptom picture" subtitle={`Share of ${who} reporting each symptom, against everyone`}
      action={<Segmented label="Sort symptoms" value={sort} onChange={setSort}
        options={[{ value: "common", label: "Most common" }, { value: "change", label: "Biggest change" }]} />}>
      <div ref={ref} className={`relative transition-opacity ${busy ? "opacity-60" : ""}`} onMouseLeave={() => { hide(); setHover(null); }}>
        <PlotFrame row={ROW} x={x} ticks={ax.ticks} fmt={pctTick} bodyClass="" bodyStyle={{ height: rows.length * SYM_H }}>
          {rows.map((r, i) => {
            const on = hover === r.id;
            const tipRows = [[`This profile`, r.set ? `set: ${r.set}` : fmtPct(100 * r.v, 1), color], ["Everyone", fmtPct(100 * r.b, 1), C.ink3]];
            if (!r.set && r.change) tipRows.push(["Change", fmtRatio(r.change)]);
            return (
              <button key={r.id} type="button" aria-label={`${r.label}: ${r.set ? `set to ${r.set}` : fmtPct(100 * r.v, 1)}`}
                onMouseEnter={() => setHover(r.id)} onMouseMove={(e) => show(e, { title: r.label, rows: tipRows })}
                onFocus={(e) => { setHover(r.id); show(e, { title: r.label, rows: tipRows }); }} onBlur={() => { setHover(null); hide(); }}
                onClick={() => onSet(r.id, r.set ? NOT_SET : "Yes")}
                className={`absolute inset-x-0 ${ROW} rounded-lg text-left transition-[transform,background-color] duration-500 ease-out-soft ${on ? "bg-bg/80" : ""}`}
                style={{ height: SYM_H - 4, transform: `translateY(${i * SYM_H}px)`, opacity: r.set ? 0.55 : 1 }}>
                <span className={`truncate pl-1 text-[13px] ${on ? "font-semibold text-ink" : "text-ink-2"}`}>{r.label}</span>
                <span className="relative h-full self-stretch">
                  {/* everyone: a pale full-height bar; this profile: a solid bar in front */}
                  <span className="absolute inset-y-1 left-0 rounded-r-[4px] transition-[width] duration-500 ease-out-soft"
                    style={{ width: `${x(100 * (r.b ?? 0))}%`, background: tint(C.ink3, on ? 34 : 24) }} />
                  <span className="absolute inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-ink-2 transition-[left] duration-500 ease-out-soft"
                    style={{ left: `${x(100 * (r.b ?? 0))}%` }} />
                  {!r.set && (
                    <span className="absolute inset-y-[9px] left-0 rounded-r-[4px] transition-[width,opacity] duration-500 ease-out-soft"
                      style={{ width: `${x(100 * (r.v ?? 0))}%`, background: color, opacity: hover && !on ? 0.5 : 1 }} />
                  )}
                </span>
                <span className="num justify-self-end text-right text-[12.5px] leading-tight text-ink">
                  {r.set ? <span className="text-ink-3">set</span> : fmtPct(100 * r.v, 1)}
                  {profiled && !r.set && r.change && Math.abs(Math.log(r.change)) > Math.log(1.1) && (
                    <span className={`block text-[10.5px] font-semibold ${r.change > 1 ? "text-pos" : "text-neg"}`}>
                      {r.change > 1 ? "▲" : "▼"} {fmtRatio(r.change > 1 ? r.change : 1 / r.change)}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </PlotFrame>
        <Tip tip={tip} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
        <span className="inline-flex items-center gap-1.5"><i className="h-2 w-3 rounded-sm" style={{ background: color }} />{evidence.covid ? `Tested ${evidence.covid.toLowerCase()}` : "This profile"}</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-sm border-r-2 border-ink-2" style={{ background: tint(C.ink3, 24) }} />Everyone</span>
      </div>
      <Hint>Symptoms already in your profile are faded. Click a symptom to add it as Yes. Set Test result to Positive to see the symptoms of positive patients.</Hint>
    </Card>
  );
}

// ----------------------------------------------------------------- network ---
function layout(graph) {
  const ids = graph.nodes.map((n) => n.id);
  const parents = Object.fromEntries(ids.map((id) => [id, []]));
  graph.edges.forEach((e) => parents[e.target].push(e.source));
  const layer = {};
  const depth = (id) => (layer[id] ??= parents[id].length ? 1 + Math.max(...parents[id].map(depth)) : 0);
  ids.forEach(depth);
  const cols = Math.max(...Object.values(layer)) + 1;
  // layers run left to right (parents before children); a lone node in a column shifts up or down so chains zigzag
  const W = 1160, H = 340, PX = 62, PY = 30;
  const pos = {};
  for (let c = 0; c < cols; c++) {
    const col = ids.filter((id) => layer[id] === c);
    const x = cols === 1 ? W / 2 : PX + (c * (W - 2 * PX)) / (cols - 1);
    col.forEach((id, i) => {
      const y = PY + ((i + 0.5) * (H - 2 * PY)) / col.length;
      pos[id] = { x, y: col.length === 1 ? y + (c % 2 ? 46 : -46) : y, layer: c };
    });
  }
  return { pos, W, H, parents };
}

/** Edges that carry information to or from COVID: its parents, its children, and its children's other parents. */
function blanket(graph, target) {
  const children = new Set(graph.edges.filter((e) => e.source === target).map((e) => e.target));
  return new Set(graph.edges.filter((e) => e.target === target || e.source === target || children.has(e.target))
    .map((e) => `${e.source}-${e.target}`));
}

function Network({ graph, evidence, inf, focus, onFocus, onSet }) {
  const [own, setOwn] = useState(null);
  const [scope, setScope] = useState("near");
  const hover = own ?? focus;
  const { pos, W, H } = useMemo(() => layout(graph), [graph]);
  const near = useMemo(() => blanket(graph, graph.target), [graph]);
  const nearNodes = useMemo(() => new Set([...near].flatMap((k) => k.split("-"))), [near]);
  const rank = Object.fromEntries((evidence.covid ? [] : inf?.factors ?? []).map((f) => [f.variable, f]));
  const maxS = Math.max(Math.log(2), ...Object.values(rank).map((f) => f.strength ?? 0));
  const w = (id) => 16 + 6.9 * SHORT[id].length;
  const linked = (e) => hover && (e.source === hover || e.target === hover);
  const quiet = (e) => scope === "near" && !near.has(`${e.source}-${e.target}`);
  const node = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));

  const cycle = (n) => {
    const states = n.states.filter((s) => s !== "Unknown");
    const order = n.kind === "demographic" ? states : [...states].reverse(); // Yes before No, Positive before Negative
    const cur = evidence[n.id];
    const next = cur == null ? order[0] : order[order.indexOf(cur) + 1] ?? NOT_SET;
    onSet(n.id, next);
  };
  const setHover = (id) => { setOwn(id); onFocus?.(id); };
  const hv = hover && node[hover];
  const r = hover && rank[hover];
  const ins = hover ? graph.edges.filter((e) => e.target === hover).length : 0;
  const outs = hover ? graph.edges.filter((e) => e.source === hover).length : 0;
  const stateOf = (id) => (evidence[id] ? graph.age_group_labels?.[evidence[id]] ?? evidence[id] : "Not set");

  return (
    <Card title="The network"
      subtitle={`${graph.structure.replace("BN", "structure")} · ${graph.edges.length} links. Number = effect rank; deeper colour = stronger effect.`}
      action={<Segmented label="Links shown" value={scope} onChange={setScope}
        options={[{ value: "near", label: "Around COVID" }, { value: "all", label: "All links" }]} />}>
      <div className="-mx-1 overflow-x-auto">
        <div className="relative min-w-[880px]">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Bayesian network diagram">
            <defs>
              <marker id="bn-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 10 5 0 10Z" fill="var(--ink-3)" />
              </marker>
              <marker id="bn-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 10 5 0 10Z" fill="var(--accent)" />
              </marker>
              <radialGradient id="bn-glow">
                <stop offset="0" stopColor="var(--pos)" stopOpacity="0.28" />
                <stop offset="1" stopColor="var(--pos)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx={pos[graph.target].x} cy={pos[graph.target].y} r="46" fill="url(#bn-glow)" />
            {graph.edges.map((e) => {
              const a = pos[e.source], b = pos[e.target];
              const x1 = a.x + w(e.source) / 2, x2 = b.x - w(e.target) / 2 - 3;
              // edges that skip columns bow outwards so they don't run through the nodes in between
              const bow = (b.layer - a.layer - 1) * 24 * (a.y + b.y < H ? -1 : 1);
              const dx = (x2 - x1) / 2;
              const on = linked(e);
              const faint = hover ? !on : quiet(e);
              return (
                <path key={`${e.source}-${e.target}`} d={`M${x1} ${a.y} C${x1 + dx} ${a.y + bow} ${x2 - dx} ${b.y + bow} ${x2} ${b.y}`} fill="none"
                  stroke={on ? "var(--accent)" : near.has(`${e.source}-${e.target}`) && scope === "near" ? "var(--ink-3)" : "var(--line-strong)"}
                  strokeWidth={on ? 2.2 : 1.3} markerEnd={`url(#${on ? "bn-arrow-on" : "bn-arrow"})`}
                  style={{ opacity: faint ? 0.12 : 0.9, transition: "opacity .25s, stroke .25s" }} />
              );
            })}
            {graph.nodes.map((n) => {
              const p = pos[n.id], set = evidence[n.id], width = w(n.id);
              const target = n.kind === "target";
              const f = rank[n.id];
              const strong = f && !weakEffect(f);
              const shade = strong ? Math.round(10 + (55 * (f.strength ?? 0)) / maxS) : 0;
              const fill = set ? "var(--accent)" : target ? "var(--pos-soft)"
                : shade ? `color-mix(in srgb, ${raises(f) ? "var(--pos)" : "var(--neg)"} ${shade}%, var(--surface))` : "var(--surface)";
              const stroke = set ? "var(--accent)" : target ? "var(--pos)" : hover === n.id ? "var(--accent)" : "var(--line-strong)";
              const dim = hover ? hover !== n.id && !graph.edges.some((e) => linked(e) && (e.source === n.id || e.target === n.id))
                : scope === "near" && !nearNodes.has(n.id);
              return (
                <g key={n.id} transform={`translate(${p.x} ${p.y})`} role="button" tabIndex={0}
                  aria-label={`${n.label}: ${stateOf(n.id)}. Click to change.`}
                  onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(n.id)} onBlur={() => setHover(null)}
                  onClick={() => cycle(n)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cycle(n); } }}
                  className="cursor-pointer outline-none"
                  style={{ opacity: dim ? 0.4 : 1, transition: "opacity .25s" }}>
                  <g className="transition-transform duration-200"
                    style={{ transform: hover === n.id ? "scale(1.08)" : "none", transformBox: "fill-box", transformOrigin: "center" }}>
                    <rect x={-width / 2} y={-13} width={width} height={26} rx={13} fill={fill} stroke={stroke}
                      strokeWidth={target || set || hover === n.id ? 2 : 1.2} style={{ transition: "fill .3s, stroke .25s" }} />
                    <text textAnchor="middle" dy="4.5" fontSize="12.5" fontWeight={set || target || strong ? 700 : 500}
                      fill={set ? "#fff" : "var(--ink)"} style={{ fontFamily: "Public Sans, Arial, sans-serif", pointerEvents: "none" }}>
                      {SHORT[n.id]}
                    </text>
                    {f && (
                      <g transform={`translate(${width / 2 - 3} -12)`}>
                        <circle r="8.5" fill={f.rank <= 3 && strong ? "var(--accent-2)" : "var(--surface)"}
                          stroke={f.rank <= 3 && strong ? "var(--accent-2)" : "var(--line-strong)"} />
                        <text textAnchor="middle" dy="3.5" fontSize="10" fontWeight="700" fill={f.rank <= 3 && strong ? "#fff" : "var(--ink-2)"}
                          style={{ fontFamily: "IBM Plex Mono, ui-monospace, monospace", pointerEvents: "none" }}>{f.rank}</text>
                      </g>
                    )}
                  </g>
                </g>
              );
            })}
          </svg>
          {hv && (
            <div className="pointer-events-none absolute z-20" style={{ left: `${(100 * pos[hover].x) / W}%`, top: `${(100 * (pos[hover].y - 16)) / H}%`, transform: "translate(-50%, -100%)" }}>
              <TipBox title={hv.label} rows={[
                ["In your profile", stateOf(hover)],
                ...(r ? [["Effect rank", `#${r.rank} of ${Object.keys(rank).length}`], ["Effect", fmtRatio(r.ratio), effectColor(r)]] : []),
                ["Links", `${ins} in · ${outs} out`],
              ]} />
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-5 rounded-full bg-accent" />In your profile</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-5 rounded-full" style={{ background: tint(C.pos, 55) }} />Raises the chance</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-5 rounded-full border-2 border-pos bg-pos-soft" />COVID result</span>
        <span className="inline-flex items-center gap-1.5"><i className="grid h-4 w-4 place-items-center rounded-full bg-accent-2 text-[9px] font-bold text-white">1</i>Effect rank</span>
      </div>
      <Hint>Click a node to cycle its answer (Yes → No → Not set). "Around COVID" keeps the links that pass information to or from the
        result; the rest are faded. Links are statistical, not causes.</Hint>
    </Card>
  );
}

// ------------------------------------------------------------- reliability ---
function Reliability({ graph }) {
  const [open, setOpen] = useState(false);
  const all = graph.test_metrics.all_test_rows;
  const m = all[graph.structure], lr = all["Logistic regression"], cb = all["Constant baseline"];
  const over = m.mean_pred / m.observed;
  const rows = [
    [graph.structure === "Learned BN" ? "This network (learned)" : "This network (expert)", m],
    [graph.structure === "Learned BN" ? "Expert-drawn network" : "Learned network", all[graph.structure === "Learned BN" ? "Expert BN" : "Learned BN"]],
    ["Logistic regression", lr],
    ["Guessing the average", cb],
  ];
  return (
    <section className={`rounded-2xl border border-line bg-surface transition-[border-color,box-shadow] duration-300 hover:border-line-strong ${ELEVATE}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3.5 text-left sm:px-5">
        <span className="border-l-[3px] border-accent pl-2.5" style={{ borderImage: "linear-gradient(var(--accent), var(--accent-2)) 1" }}>
          <span className="block text-[15px] font-bold text-ink">How reliable is this?</span>
          <span className="block text-[13px] text-ink-3">Tested on Sep–Oct 2020 results the model had not seen</span>
        </span>
        <svg viewBox="0 0 20 20" className={`h-5 w-5 shrink-0 text-ink-3 transition-transform duration-300 ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg>
      </button>
      <div className={`grid transition-all duration-300 ease-out-soft ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="overflow-hidden">
          <div className="grid gap-4 px-4 pb-5 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <ul className="grid gap-2.5 text-[13.5px] leading-relaxed text-ink-2">
              <li><b className="text-ink">It sorts patients better than chance, but not by much.</b> Take one patient who tested positive and one who
                didn't: the model gives the positive one the higher estimate <b className="num text-ink">{Math.round(100 * m.roc_auc)}%</b> of the time
                (a coin flip would be 50%).</li>
              <li><b className="text-ink">It is best at spotting the highest-risk groups.</b> Its precision score (PR-AUC) is
                <b className="num text-ink"> {m.pr_auc.toFixed(3)}</b>, about <b className="num text-ink">{Math.round(m.pr_auc / cb.pr_auc)}×</b> what
                guessing the average gets, and similar to a standard logistic regression ({lr.pr_auc.toFixed(3)}).</li>
              <li><b className="text-ink">The exact percentages run high for later months.</b> Positivity fell after the summer: in Sep–Oct the model
                predicted <b className="num text-ink">{fmtPct(100 * m.mean_pred)}</b> on average while <b className="num text-ink">{fmtPct(100 * m.observed)}</b> tested
                positive (about {over.toFixed(1)}× high). Compare profiles with each other rather than reading the numbers as exact.</li>
              <li><b className="text-ink">Small groups are guesses.</b> When fewer than {MIN_MATCHES} patients match a profile, the estimate leans on
                related groups rather than on people exactly like that.</li>
            </ul>
            <div className="min-w-0">
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-bg text-ink-3">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Model (Sep–Oct 2020 test)</th>
                      <th className="px-3 py-2 text-right font-semibold" title="Precision–recall area; higher is better">PR-AUC</th>
                      <th className="px-3 py-2 text-right font-semibold" title="Chance the positive patient scores higher; 0.5 = coin flip">ROC-AUC</th>
                      <th className="px-3 py-2 text-right font-semibold" title="Average gap between predicted and observed positivity">Calib. gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(([name, r], i) => (
                      <tr key={name} className={`border-t border-line ${i === 0 ? "font-semibold text-ink" : "text-ink-2"}`}>
                        <td className="px-3 py-1.5">{name}</td>
                        <td className="num px-3 py-1.5 text-right">{r.pr_auc.toFixed(3)}</td>
                        <td className="num px-3 py-1.5 text-right">{r.roc_auc.toFixed(3)}</td>
                        <td className="num px-3 py-1.5 text-right">{fmtPct(100 * r.ece)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Hint>Trained on {fmtInt(graph.training.rows_train_split)} tests up to 31 Aug 2020 for this check; the live model is refitted on
                all {fmtInt(graph.training.rows_final_model)} tests with every symptom recorded ({graph.created}).</Hint>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// -------------------------------------------------------------------- tab ---
export default function BayesExplorer() {
  const [graph, setGraph] = useState(null);
  const [graphError, setGraphError] = useState(null);
  const [evidence, setEvidence] = useState({});
  const { res, busy, error } = useBayesQuery(evidence);
  const { res: base } = useBayesQuery({}, 0);
  const { res: inf, busy: ranking } = useBayesQuery(evidence, 150, rankBayes, !evidence.covid);
  const [focus, setFocus] = useState(null); // feature hovered in the ranking or the network

  useEffect(() => { getBayesGraph().then(setGraph, (e) => setGraphError(e.message)); }, []);

  const onSet = (id, v) => setEvidence(({ [id]: _, ...rest }) => (v ? { ...rest, [id]: v } : rest));
  const onExample = (ev) => setEvidence(ev ?? Object.fromEntries(graph.nodes.filter((n) => n.kind === "symptom").map((n) => [n.id, "No"])));

  if (graphError) {
    return (
      <div className="rounded-2xl border border-pos bg-pos-soft p-4 text-[14px] text-ink">
        <b>The What-if model isn't available.</b> Train it with <code className="font-mono">python modeling/train_bayes.py</code> and
        restart the backend. <span className="text-[12px] text-ink-2">Details: {graphError}</span>
      </div>
    );
  }
  if (!graph) return <div className="h-96 animate-pulse rounded-2xl bg-surface" aria-busy="true" aria-label="Loading" />;

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Profile graph={graph} evidence={evidence} onSet={onSet} onReset={() => setEvidence({})} onExample={onExample} />
        <div className="grid min-w-0 gap-4">
          {error && (
            <div className="rounded-2xl border border-pos bg-pos-soft p-3 text-[13px] text-ink">Couldn't update the estimate: {error}</div>
          )}
          <Headline res={res} base={base} overall={graph.overall_positivity?.all_rows != null ? 100 * graph.overall_positivity.all_rows : null}
            evidence={evidence} busy={busy} />
          <Ranking graph={graph} inf={inf} evidence={evidence} busy={ranking} focus={focus} onFocus={setFocus} onSet={onSet} />
        </div>
      </div>
      <SymptomBars graph={graph} res={res} base={base} evidence={evidence} busy={busy} onSet={onSet} />
      <Network graph={graph} evidence={evidence} inf={inf} focus={focus} onFocus={setFocus} onSet={onSet} />
      <Reliability graph={graph} />
      <p className="px-1 text-[12.5px] text-ink-3">
        Estimates describe groups of patients in 2020 testing data, not any individual's risk.
      </p>
    </div>
  );
}
