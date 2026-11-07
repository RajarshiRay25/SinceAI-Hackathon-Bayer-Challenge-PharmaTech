export const fmtInt = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
export const fmtPct = (n, d = 2) => (n == null || !Number.isFinite(n) ? "–" : `${n.toFixed(d)}%`);
export const fmtOR = (n) => (n == null ? "–" : n >= 10 ? n.toFixed(1) : n.toFixed(2));
export const fmtCI = (lo, hi, d = 2) => `${fmtPct(lo, d)} to ${fmtPct(hi, d)}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtWeek = (iso) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
export const monthOf = (iso) => MONTHS[new Date(`${iso}T00:00:00Z`).getUTCMonth()];

/** [below, above] distances for Recharts <ErrorBar> */
export const errBar = (r) =>
  r.pct == null ? [0, 0] : [r.pct - r.ci_low, r.ci_high - r.pct];

export const EMPTY_FILTERS = {
  age_groups: [],
  test_categories: [],
  symptom_status: [],
  week_from: null,
  week_to: null,
};

export const toggle = (list, value) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
