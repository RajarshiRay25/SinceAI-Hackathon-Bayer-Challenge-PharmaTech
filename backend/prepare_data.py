"""
Turn the Phase 1 notebook outputs into the two files the API reads.

Run this whenever you re-run the notebook:

    python prepare_data.py \
        --clean ../../outputs/healthsignal_eda_clean.csv \
        --log   ../../outputs/cleaning_log.csv \
        --raw   ../../covidclinicaldata.csv

Writes:
    data/clean.parquet   one row per test, only the columns the app uses
    data/quality.json    static data-quality tables (missingness, cleaning log, vitals, duplicates)
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from stats import BINARY, VITALS, LABELS, to_bool

HERE = Path(__file__).parent
KEEP = (["batch_date", "covid_positive", "age", "age_group", "test_category", "symptom_status",
         "n_symptoms", "is_exact_duplicate"] + BINARY + VITALS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clean", required=True, help="healthsignal_eda_clean.csv or .parquet from the notebook")
    ap.add_argument("--log", required=True, help="cleaning_log.csv from the notebook")
    ap.add_argument("--raw", help="original covidclinicaldata.csv (for raw missing-value %)")
    a = ap.parse_args()

    clean = Path(a.clean)
    d = pd.read_parquet(clean) if clean.suffix == ".parquet" else pd.read_csv(clean, low_memory=False)
    d = d[KEEP].copy()
    d["batch_date"] = pd.to_datetime(d["batch_date"])
    for c in BINARY:
        d[c] = to_bool(d[c]).astype("boolean")
    d["is_exact_duplicate"] = to_bool(d["is_exact_duplicate"]).fillna(False).astype(bool)
    d["covid_positive"] = d["covid_positive"].astype("int8")
    for c in ["age_group", "test_category", "symptom_status"]:
        d[c] = d[c].astype(str)

    out = HERE / "data"
    out.mkdir(exist_ok=True)
    d.to_parquet(out / "clean.parquet", index=False)

    # ---- static data-quality tables ----
    y = d["covid_positive"]
    vitals = []
    for v in VITALS:
        p_, n_ = d.loc[y == 1, v].dropna(), d.loc[y == 0, v].dropna()
        q = lambda s: {"n": int(len(s)), "q1": round(float(s.quantile(.25)), 2),
                       "median": round(float(s.median()), 2), "q3": round(float(s.quantile(.75)), 2)}
        vitals.append({"key": v, "label": LABELS[v], "positive": q(p_), "negative": q(n_)})

    src = pd.read_csv(a.raw, low_memory=False) if a.raw else d
    miss = (src.isna().mean() * 100).sort_values(ascending=False)
    dup = d["is_exact_duplicate"]
    log = pd.read_csv(a.log, dtype={"step": str}).replace({np.nan: None}).to_dict("records")

    quality = {
        "missingness": [{"column": c, "pct": round(float(p), 2)} for c, p in miss.items() if p > 0],
        "missingness_source": "raw" if a.raw else "clean",
        "duplicates": {"n": int(dup.sum()),
                       "positivity_with_pct": round(100 * float(y.mean()), 3),
                       "positivity_without_pct": round(100 * float(y[~dup].mean()), 3)},
        "vitals": vitals,
        "cleaning_log": log,
    }
    (out / "quality.json").write_text(json.dumps(quality, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {out/'clean.parquet'} ({len(d):,} rows) and {out/'quality.json'}")


if __name__ == "__main__":
    main()
