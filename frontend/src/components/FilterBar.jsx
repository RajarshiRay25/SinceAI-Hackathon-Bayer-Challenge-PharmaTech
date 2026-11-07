import { Chip, ELEVATE } from "./ui.jsx";
import { fmtWeek, toggle, EMPTY_FILTERS } from "../lib/format.js";

const DOT = { blue: "bg-hue-blue", violet: "bg-hue-violet", teal: "bg-hue-teal", coral: "bg-hue-coral" };

function Group({ label, count, tone, children }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-3">
        <i className={`h-2 w-2 rounded-full ${DOT[tone]}`} aria-hidden="true" />
        {label}
        {count > 0 && <span key={count} className="num grid h-4 min-w-4 animate-pop place-items-center rounded-full bg-accent px-1 text-[10px] text-surface">{count}</span>}
      </span>
      {children}
    </div>
  );
}

/** One segment per report week; the selected range is lit. Click a segment to start or end the range there. */
function WeekTrack({ weeks, from, to, onPick }) {
  const a = from ? weeks.indexOf(from) : 0;
  const b = to ? weeks.indexOf(to) : weeks.length - 1;
  return (
    <div className="flex h-3 w-36 items-end gap-px" role="group" aria-label="Selected weeks">
      {weeks.map((w, i) => {
        const on = i >= a && i <= b;
        return (
          <button
            key={w}
            type="button"
            title={`Week of ${fmtWeek(w)}`}
            aria-label={`Week of ${fmtWeek(w)}${on ? ", selected" : ""}`}
            onClick={() => onPick(i, a, b)}
            className={`h-full flex-1 origin-bottom rounded-[1px] transition-all duration-300 hover:scale-y-125 ${on ? "bg-linear-to-t from-accent to-accent-2" : "scale-y-50 bg-line-strong"}`}
          />
        );
      })}
    </div>
  );
}

export default function FilterBar({ meta, filters, setFilters }) {
  const set = (key, value) => setFilters((f) => ({ ...f, [key]: toggle(f[key], value) }));
  const weeks = meta.weeks;
  const hasWeeks = filters.week_from || filters.week_to;
  const active =
    filters.age_groups.length + filters.test_categories.length + filters.symptom_status.length + (hasWeeks ? 1 : 0);

  // clicking left of the range's middle moves its start, right of it moves its end
  const pickWeek = (i, a, b) => {
    const [s, e] = i < (a + b) / 2 ? [i, b] : [a, i];
    setFilters((f) => ({ ...f, week_from: s === 0 ? null : weeks[s], week_to: e === weeks.length - 1 ? null : weeks[e] }));
  };

  return (
    <div className={`flex animate-rise flex-col gap-3 rounded-2xl border border-line bg-surface p-4 ${ELEVATE} lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-6`}>
      <Group label="Age" tone="blue" count={filters.age_groups.length}>
        {meta.age_groups.map((a) => (
          <Chip key={a} active={filters.age_groups.includes(a)} onClick={() => set("age_groups", a)}>{a}</Chip>
        ))}
      </Group>
      <Group label="Test" tone="violet" count={filters.test_categories.length}>
        {meta.test_categories.map((t) => (
          <Chip key={t} active={filters.test_categories.includes(t)} onClick={() => set("test_categories", t)}>{t}</Chip>
        ))}
      </Group>
      <Group label="Symptoms" tone="teal" count={filters.symptom_status.length}>
        {meta.symptom_status.map((s) => (
          <Chip key={s} active={filters.symptom_status.includes(s)} onClick={() => set("symptom_status", s)}>{s}</Chip>
        ))}
      </Group>
      <div className="flex flex-wrap items-center gap-3 lg:ml-auto">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-ink-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-3"><i className="h-2 w-2 rounded-full bg-hue-coral" aria-hidden="true" />Weeks </span>
            {fmtWeek(filters.week_from || weeks[0])} – {fmtWeek(filters.week_to || weeks[weeks.length - 1])}
            {hasWeeks && (
              <button
                onClick={() => setFilters((f) => ({ ...f, week_from: null, week_to: null }))}
                className="ml-1.5 animate-fade-in text-accent underline underline-offset-2"
              >
                all
              </button>
            )}
          </span>
          <WeekTrack weeks={weeks} from={filters.week_from} to={filters.week_to} onPick={pickWeek} />
        </div>
        <button
          onClick={() => setFilters(EMPTY_FILTERS)}
          disabled={!active}
          className="rounded-lg border border-line-strong px-3 py-1 text-[13px] font-semibold text-ink-2 transition-all enabled:hover:border-accent enabled:hover:bg-accent-soft enabled:hover:text-accent enabled:active:scale-95 disabled:opacity-40"
        >
          Clear{active ? <span key={active} className="inline-block animate-pop"> ({active})</span> : ""}
        </button>
      </div>
    </div>
  );
}
