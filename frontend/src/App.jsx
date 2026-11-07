import { useEffect, useState } from "react";
import { getDashboard, getMeta, getQuality } from "./api.js";
import { EMPTY_FILTERS } from "./lib/format.js";
import Header from "./components/Header.jsx";
import FilterBar from "./components/FilterBar.jsx";
import KpiCards from "./components/KpiCards.jsx";
import WeeklyChart from "./components/WeeklyChart.jsx";
import { AgeChart, TestTypeChart } from "./components/BreakdownCharts.jsx";
import SymptomsCard from "./components/SymptomsCard.jsx";
import ConditionsTab from "./components/ConditionsTab.jsx";
import QualityTab from "./components/QualityTab.jsx";
import ChatPanel from "./components/ChatPanel.jsx";
import BayesExplorer from "./components/BayesExplorer.jsx";

const TAB_IDS = ["overview", "conditions", "quality", "whatif"];
const tabFromHash = () => (TAB_IDS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview");

export default function App() {
  const [meta, setMeta] = useState(null);
  const [quality, setQuality] = useState(null);
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(tabFromHash);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  // first load
  useEffect(() => {
    Promise.all([getMeta(), getQuality()])
      .then(([m, q]) => { setMeta(m); setQuality(q); })
      .catch((e) => setError(e.message));
  }, []);

  // reload numbers whenever the filters change (short delay so dragging the week range stays smooth)
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      getDashboard(filters, ctrl.signal)
        .then((d) => { setData(d); setError(null); setLoading(false); })
        .catch((e) => { if (e.name !== "AbortError") { setError(e.message); setLoading(false); } });
    }, 180);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [filters]);

  // tabs live in the URL (#overview, #conditions, #quality, #whatif) so they can be bookmarked
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  const goTab = (id) => { location.hash = id; setTab(id); };

  const toggleTheme = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch {}
    setDark(next);
  };

  const filtered = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);
  const noPositives = data && data.kpis.positives === 0;

  return (
    <div className="min-h-screen">
      <Header tab={tab} onTab={goTab} dark={dark} onToggleTheme={toggleTheme} loading={loading && !!data} records={meta?.records} />

      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-5 sm:px-6 sm:py-6">
        {error && (
          <div className="rounded-2xl border border-pos bg-pos-soft p-4 text-[14px] text-ink">
            <b>Can't reach the data server.</b> Start the backend in a terminal with{" "}
            <code className="font-mono">cd backend && uvicorn main:app --reload</code>, then refresh this page.
            <div className="mt-1 text-[12px] text-ink-2">Details: {error}</div>
          </div>
        )}

        {!meta || !data ? (
          !error && <Skeleton />
        ) : tab === "quality" ? (
          <QualityTab q={quality} />
        ) : tab === "whatif" ? (
          <BayesExplorer />
        ) : (
          <>
            <FilterBar meta={meta} filters={filters} setFilters={setFilters} />
            <KpiCards k={data.kpis} weekly={data.weekly} filtered={filtered} />

            {noPositives ? (
              <div className="rounded-2xl border border-dashed border-line-strong bg-surface p-10 text-center">
                <h2 className="text-[17px] font-bold">No positive tests in this selection</h2>
                <p className="mt-1 text-ink-2">Positivity and odds ratios need at least one positive result. Widen the filters or press Clear.</p>
              </div>
            ) : tab === "overview" ? (
              <div className={`grid gap-4 transition-opacity ${loading ? "opacity-70" : ""}`}>
                <WeeklyChart weekly={data.weekly} weeks={meta.weeks} filters={filters} setFilters={setFilters} overallPct={data.kpis.overall_pct} />
                <div className="grid gap-4 lg:grid-cols-2">
                  <AgeChart rows={data.by_age} filters={filters} setFilters={setFilters} overallPct={data.kpis.overall_pct} />
                  <TestTypeChart rows={data.by_test} filters={filters} setFilters={setFilters} overallPct={data.kpis.overall_pct} />
                </div>
                <SymptomsCard symptoms={data.symptoms} byCount={data.by_symptom_count} overallPct={data.kpis.overall_pct} />
              </div>
            ) : (
              <div className={`transition-opacity ${loading ? "opacity-70" : ""}`}>
                <ConditionsTab data={data} />
              </div>
            )}
          </>
        )}
      </main>

      <ChatPanel filters={filters} tab={tab} records={meta?.records} />

      <footer className="mx-auto max-w-7xl px-4 pb-10 text-[12.5px] leading-relaxed text-ink-3 sm:px-6">
        <p>
          Source: Carbon Health COVID-19 Clinical Data Repository, {meta ? meta.records.toLocaleString("en-US") : "93,995"} tests
          in weekly batches, April to October 2020. Report week is the batch release date, not the exact test date.
          Proportions use Wilson 95% intervals; odds ratios use Woolf 95% intervals with a 0.5 correction.
        </p>
      </footer>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading">
      <div className="h-24 animate-pulse rounded-2xl bg-surface" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-surface" />)}
      </div>
      <div className="h-80 animate-pulse rounded-2xl bg-surface" />
    </div>
  );
}
