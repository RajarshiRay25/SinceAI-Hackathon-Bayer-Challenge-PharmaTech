"""
HealthSignal AI — statistics used by the dashboard (and, later, by the chatbot's tools).

Same maths as the Phase 1 notebook:
  * positivity with Wilson 95% intervals
  * odds ratios with a 0.5 (Haldane) correction and Woolf 95% intervals
  * "Unknown" answers are never counted as "No": they are excluded from yes/no
    comparisons and reported separately.

Every public function takes a pandas DataFrame plus a `Filters` object and returns
plain Python dicts/lists, so the API can return them as JSON and an LLM tool can
call them directly.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

# ---------------------------------------------------------------- variables ---
SYMPTOMS = ["fever", "cough", "sob", "fatigue", "headache", "loss_of_smell", "loss_of_taste",
            "runny_nose", "muscle_sore", "sore_throat", "diarrhea"]
COMORBIDITIES = ["diabetes", "chd", "htn", "cancer", "asthma", "copd", "autoimmune_dis", "smoker"]
EXPOSURE = ["high_risk_exposure_occupation", "high_risk_interactions"]
VITALS = ["temperature", "pulse", "sys", "dia", "rr", "sats"]
BINARY = SYMPTOMS + COMORBIDITIES + EXPOSURE

AGE_GROUPS = ["0–18", "19–30", "31–45", "46–60", "61+"]          # "Unknown" exists but is not charted
SYMPTOM_STATUS = ["Symptomatic", "Asymptomatic", "Unknown"]
SYMPTOM_COUNT_BUCKETS = ["0", "1", "2", "3", "4", "5", "6+"]

LABELS = {
    "fever": "Fever", "cough": "Cough", "sob": "Shortness of breath", "fatigue": "Fatigue",
    "headache": "Headache", "loss_of_smell": "Loss of smell", "loss_of_taste": "Loss of taste",
    "runny_nose": "Runny nose", "muscle_sore": "Muscle soreness", "sore_throat": "Sore throat",
    "diarrhea": "Diarrhoea", "diabetes": "Diabetes", "chd": "Coronary heart disease",
    "htn": "Hypertension", "cancer": "Cancer", "asthma": "Asthma", "copd": "COPD",
    "autoimmune_dis": "Autoimmune disease", "smoker": "Smoker",
    "high_risk_exposure_occupation": "High-risk occupation",
    "high_risk_interactions": "High-risk interactions",
    "temperature": "Temperature (°C)", "pulse": "Pulse (bpm)", "sys": "Systolic BP (mmHg)",
    "dia": "Diastolic BP (mmHg)", "rr": "Respiratory rate (/min)", "sats": "SpO₂ (%)",
}

DATA_DIR = Path(__file__).parent / "data"


# ----------------------------------------------------------------- loading ---
def to_bool(s: pd.Series) -> pd.Series:
    """True/False/'True'/'False'/1/0 → True/False, anything else → NaN (Unknown)."""
    def conv(x):
        t = str(x).strip().lower()
        if t in {"true", "1", "1.0", "yes"}:
            return True
        if t in {"false", "0", "0.0", "no"}:
            return False
        return np.nan
    return s.map(conv)


def load_data(path: Path | None = None) -> pd.DataFrame:
    df = pd.read_parquet(path or DATA_DIR / "clean.parquet")
    df["week"] = df["batch_date"].dt.strftime("%Y-%m-%d")
    return df


# ----------------------------------------------------------------- filters ---
@dataclass
class Filters:
    """Empty list = no filter on that field. Weeks are inclusive ISO dates (YYYY-MM-DD)."""
    age_groups: list[str] = field(default_factory=list)
    test_categories: list[str] = field(default_factory=list)
    symptom_status: list[str] = field(default_factory=list)
    week_from: str | None = None
    week_to: str | None = None

    def is_empty(self) -> bool:
        return not (self.age_groups or self.test_categories or self.symptom_status
                    or self.week_from or self.week_to)


def apply_filters(df: pd.DataFrame, f: Filters, skip: Iterable[str] = ()) -> pd.DataFrame:
    """Filter rows. `skip` names filters to ignore, used for cross-filtering:
    the age chart ignores the age filter so every group stays visible and clickable."""
    m = pd.Series(True, index=df.index)
    if f.age_groups and "age" not in skip:
        m &= df["age_group"].isin(f.age_groups)
    if f.test_categories and "test" not in skip:
        m &= df["test_category"].isin(f.test_categories)
    if f.symptom_status and "symptom" not in skip:
        m &= df["symptom_status"].isin(f.symptom_status)
    if "week" not in skip:
        if f.week_from:
            m &= df["week"] >= f.week_from
        if f.week_to:
            m &= df["week"] <= f.week_to
    return df[m]


# -------------------------------------------------------------- statistics ---
def _num(x: float, nd: int = 3):
    return None if x is None or not math.isfinite(x) else round(float(x), nd)


def wilson(k: int, n: int, z: float = 1.96) -> dict:
    """Positivity (%) with Wilson score 95% interval."""
    if n == 0:
        return {"tests": 0, "positives": 0, "pct": None, "ci_low": None, "ci_high": None}
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return {"tests": int(n), "positives": int(k), "pct": _num(100 * p),
            "ci_low": _num(100 * (c - h)), "ci_high": _num(100 * (c + h))}


def odds_ratio(a: int, b: int, c: int, d: int) -> dict:
    """a=yes&positive, b=yes&negative, c=no&positive, d=no&negative."""
    A, B, C, D = a + .5, b + .5, c + .5, d + .5
    orr = (A * D) / (B * C)
    se = math.sqrt(1 / A + 1 / B + 1 / C + 1 / D)
    lo, hi = math.exp(math.log(orr) - 1.96 * se), math.exp(math.log(orr) + 1.96 * se)
    return {"or": _num(orr), "ci_low": _num(lo), "ci_high": _num(hi),
            "signal": "higher" if lo > 1 else "lower" if hi < 1 else "ns"}


def positivity(df: pd.DataFrame) -> dict:
    return wilson(int(df["covid_positive"].sum()), len(df))


def positivity_by(df: pd.DataFrame, column: str, order: list[str] | None = None) -> list[dict]:
    g = df.groupby(column, observed=True)["covid_positive"].agg(["sum", "size"])
    keys = order if order is not None else list(g.index)
    out = []
    for k in keys:
        if k in g.index and g.loc[k, "size"] > 0:
            out.append({"group": str(k), **wilson(int(g.loc[k, "sum"]), int(g.loc[k, "size"]))})
    return out


def variable_summary(df: pd.DataFrame, var: str) -> dict:
    """Yes/No/Unknown positivity, prevalence among positive vs negative, and odds ratio."""
    x, y = df[var], df["covid_positive"] == 1
    yes, no = x == True, x == False  # noqa: E712  (nullable boolean, NaN → False in both)
    yes, no = yes.fillna(False), no.fillna(False)
    unk = ~(yes | no)
    yp, yn = int((yes & y).sum()), int((yes & ~y).sum())
    np_, nn = int((no & y).sum()), int((no & ~y).sum())
    return {
        "key": var, "label": LABELS.get(var, var),
        **odds_ratio(yp, yn, np_, nn),
        "prev_pos": _num(100 * yp / (yp + np_)) if yp + np_ else None,
        "prev_neg": _num(100 * yn / (yn + nn)) if yn + nn else None,
        "n_known": yp + yn + np_ + nn, "n_yes": yp + yn, "n_unknown": int(unk.sum()),
        "if_yes": wilson(yp, yp + yn), "if_no": wilson(np_, np_ + nn),
        "if_unknown": wilson(int((unk & y).sum()), int(unk.sum())),
    }


# ------------------------------------------------------------ dashboard API ---
def meta(df: pd.DataFrame) -> dict:
    weeks = sorted(df["week"].unique())
    return {
        "records": int(len(df)),
        "overall": positivity(df),
        "weeks": weeks,
        "age_groups": AGE_GROUPS,
        "test_categories": sorted(df["test_category"].unique()),
        "symptom_status": SYMPTOM_STATUS,
        "source": "Carbon Health COVID-19 Clinical Data Repository",
    }


def dashboard(df: pd.DataFrame, f: Filters) -> dict:
    """Everything the overview and detail tabs need for one filter selection."""
    sel = apply_filters(df, f)
    overall = positivity(df)
    k = positivity(sel)
    n_sym = int((sel["symptom_status"] == "Symptomatic").sum())

    compare = "same"
    if k["pct"] is not None and not f.is_empty():
        if k["ci_low"] > overall["pct"]:
            compare = "above"
        elif k["ci_high"] < overall["pct"]:
            compare = "below"

    weekly_src = apply_filters(df, f, skip=["week"])
    weekly = [{"week": r["group"], **{k_: v for k_, v in r.items() if k_ != "group"}}
              for r in positivity_by(weekly_src, "week", sorted(df["week"].unique()))]

    counts = sel.assign(bucket=sel["n_symptoms"].clip(upper=6).astype(int).astype(str).replace({"6": "6+"}))
    by_count = [r for r in positivity_by(counts, "bucket", SYMPTOM_COUNT_BUCKETS) if r["tests"] >= 20]

    return {
        "kpis": {**k, "negatives": k["tests"] - k["positives"],
                 "symptomatic_pct": _num(100 * n_sym / len(sel)) if len(sel) else None,
                 "weeks": int(sel["week"].nunique()), "overall_pct": overall["pct"], "compare": compare},
        "weekly": weekly,
        "by_age": positivity_by(apply_filters(df, f, skip=["age"]), "age_group", AGE_GROUPS),
        "by_test": sorted(positivity_by(apply_filters(df, f, skip=["test"]), "test_category"),
                          key=lambda r: -(r["pct"] or 0)),
        "by_symptom_count": by_count,
        "symptoms": sorted([variable_summary(sel, v) for v in SYMPTOMS], key=lambda r: -(r["or"] or 0)),
        "comorbidities": sorted([variable_summary(sel, v) for v in COMORBIDITIES],
                                key=lambda r: -(r["if_yes"]["pct"] or 0)),
        "exposure": [variable_summary(sel, v) for v in EXPOSURE],
    }
