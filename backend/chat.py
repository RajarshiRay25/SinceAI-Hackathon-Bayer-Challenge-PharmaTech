"""
HealthSignal AI — chatbot.

The LLM never sees raw rows and never does its own arithmetic. It gets tools that call the
same functions as the dashboard (stats.apply_filters / positivity_by / variable_summary), so
every number it quotes comes from this code. Any OpenAI-compatible endpoint works; configure
it in backend/.env:

    LLM_BASE_URL=...   LLM_API_KEY=...   LLM_MODEL=...

Two modes (LLM_TOOL_MODE in .env):
  planner (default)  works with any chat model. A short first call returns JSON naming the selection and
                     statistics needed; this code computes them; a second call answers from that data only.
  native             OpenAI-style tool calls, for providers and models that support them properly.
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import asdict

import pandas as pd

import bayes
import stats

log = logging.getLogger("uvicorn.error")

MAX_TOOL_ROUNDS = 5
MAX_HISTORY = 12          # most recent messages sent to the model
MAX_MESSAGE_CHARS = 2000

SYSTEM = """You are HealthSignal AI, an analyst assistant inside a dashboard of SARS-CoV-2 test results \
from Carbon Health clinics (USA, April–October 2020, {records:,} tests in weekly batches).

How to answer:
- Get every number from the tools or the DATA block. Never estimate, invent or recalculate figures \
yourself, and never use outside knowledge for numbers.
- Unless the user asks otherwise, use the dashboard filters they currently have applied (given below). \
Say which selection your numbers describe when filters are applied.
- Positivity is the share of tests that were positive, with a Wilson 95% CI. Odds ratios use a 0.5 \
correction with Woolf 95% CIs; "ns" means the interval includes 1 (no clear link).
- Figures are unadjusted associations, not causes. Mention confounding (age especially) when relevant, \
and point out small groups or wide intervals.
- Report week is the batch release date, not the exact test date.
- Missing answers are "Unknown", never "No".
- Be concise: lead with the answer, then 2–5 short bullet points. Use **bold** for key numbers. \
No tables, no headings.
- This is aggregated population data. You cannot see individual patients. If someone asks about \
their own health or symptoms, say you can't give medical advice, suggest a clinician or local health \
service, and offer what the data shows in general.
- If a question is outside this dataset, say so briefly.
- what_if gives Bayesian-network estimates for groups of patients with a given profile. Always say how many matching patients exist, and never present it as the user's personal risk.

Current dashboard filters: {filters}
Current dashboard tab: {tab} /no_think"""

_THINK = re.compile(r"<think>.*?</think>", re.S)


# ------------------------------------------------------------------ tools ---
def _filter_schema(test_categories: list[str]) -> dict:
    return {
        "type": "object",
        "description": "Rows to include. Omit a field (or pass []) for no filter on it.",
        "properties": {
            "age_groups": {"type": "array", "items": {"type": "string", "enum": stats.AGE_GROUPS}},
            "test_categories": {"type": "array", "items": {"type": "string", "enum": test_categories}},
            "symptom_status": {"type": "array", "items": {"type": "string", "enum": stats.SYMPTOM_STATUS}},
            "week_from": {"type": "string", "description": "First report week, YYYY-MM-DD (inclusive)"},
            "week_to": {"type": "string", "description": "Last report week, YYYY-MM-DD (inclusive)"},
        },
    }


def tool_specs(df: pd.DataFrame) -> list[dict]:
    f = _filter_schema(sorted(df["test_category"].unique()))
    fn = lambda name, desc, props, req=(): {  # noqa: E731
        "type": "function",
        "function": {"name": name, "description": desc,
                     "parameters": {"type": "object", "properties": props, "required": list(req)}},
    }
    return [
        fn("get_positivity", "Overall positivity, test counts, symptomatic share and week span for a selection.",
           {"filters": f}),
        fn("positivity_by_group", "Positivity (with 95% CI and counts) for each group of one dimension.",
           {"dimension": {"type": "string", "enum": ["age_group", "test_category", "symptom_status", "week", "symptom_count"]},
            "filters": f}, ["dimension"]),
        fn("variable_detail", "Odds ratio of a positive test for one symptom, condition or exposure, with "
           "positivity if yes/no/unknown and prevalence among positive vs negative patients.",
           {"variable": {"type": "string", "enum": stats.BINARY,
                         "description": "; ".join(f"{k} = {stats.LABELS[k]}" for k in stats.BINARY)},
            "filters": f}, ["variable"]),
        fn("rank_variables", "Every symptom, condition or exposure in a family ranked by odds ratio.",
           {"family": {"type": "string", "enum": ["symptoms", "conditions", "exposure"]}, "filters": f}, ["family"]),
        fn("what_if", "Bayesian-network estimate for patients with a given profile: the share in each state of "
           "`target` (default covid: Positive/Negative) given `evidence`, with how many patients match exactly. "
           "Uses all tests; dashboard filters don't apply. Describes a group of patients, never one person's risk.",
           {"target": {"type": "string", "enum": list(bayes.variables()), "default": "covid"},
            "evidence": {"type": "object", "description": "Known answers, e.g. {\"age_group\": \"61+\", \"cough\": \"Yes\"}",
                         "properties": {v: {"type": "string", "enum": s} for v, s in bayes.variables().items()},
                         "additionalProperties": False}}),
        fn("data_quality", "Facts about the raw data: missing values per column, duplicate rows, vital signs, "
           "cleaning steps.",
           {"topic": {"type": "string", "enum": ["missingness", "duplicates", "vitals", "cleaning_log"]}}, ["topic"]),
    ]


def _filters(raw: dict | None) -> stats.Filters:
    raw = raw or {}
    return stats.Filters(
        age_groups=list(raw.get("age_groups") or []),
        test_categories=list(raw.get("test_categories") or []),
        symptom_status=list(raw.get("symptom_status") or []),
        week_from=raw.get("week_from") or None,
        week_to=raw.get("week_to") or None,
    )


def _compact(v: dict) -> dict:
    """variable_summary without the noise, for the model's context."""
    return {"label": v["label"], "odds_ratio": v["or"], "ci": [v["ci_low"], v["ci_high"]], "signal": v["signal"],
            "positivity_if_yes": v["if_yes"]["pct"], "positivity_if_no": v["if_no"]["pct"],
            "patients_yes": v["n_yes"], "unknown": v["n_unknown"],
            "prevalence_in_positive_pct": v["prev_pos"], "prevalence_in_negative_pct": v["prev_neg"]}


def what_if(target: str | None = None, evidence: dict | None = None) -> dict:
    """bayes.query, framed as a group of patients with the overall positivity as a baseline."""
    target = target or "covid"
    r = bayes.query(target, evidence)
    base = bayes.query(target, {})["probabilities"]
    pct = lambda p: round(100 * p, 2)  # noqa: E731
    out = {"about": "Bayesian-network estimate for patients with this profile (all tests, Apr–Oct 2020; dashboard "
                    "filters do not apply). It describes a group of patients, not any individual's risk.",
           "target": r["target"], "profile": r["evidence"] or "no answers given (everyone)",
           "pct_of_patients_with_this_profile": {s: pct(p) for s, p in r["probabilities"].items()},
           "model_pct_without_profile": {s: pct(p) for s, p in base.items()},
           "overall_positivity_pct": bayes.overall_positivity()["pct"],
           "matching_patients": r["matching_patients"], "warning": r["warning"]}
    if target == bayes.meta()["target"]:
        out["probability"] = r["probabilities"]["Positive"]
    return out


FAMILIES = {"symptoms": stats.SYMPTOMS, "conditions": stats.COMORBIDITIES, "exposure": stats.EXPOSURE}


def run_tool(name: str, args: dict, df: pd.DataFrame, quality: dict) -> dict:
    if name == "what_if":
        try:
            return what_if(args.get("target"), args.get("evidence"))
        except bayes.ToolError as e:
            return {"error": str(e)}
    f = _filters(args.get("filters"))
    sel = stats.apply_filters(df, f)
    if name == "get_positivity":
        k = stats.positivity(sel)
        return {"selection": asdict(f), **k, "negatives": k["tests"] - k["positives"],
                "overall_all_tests_pct": stats.positivity(df)["pct"],
                "symptomatic_pct": round(100 * (sel["symptom_status"] == "Symptomatic").mean(), 2) if len(sel) else None,
                "weeks": [sel["week"].min(), sel["week"].max()] if len(sel) else None}
    if name == "positivity_by_group":
        dim = args.get("dimension")
        if dim == "symptom_count":
            sel = sel.assign(bucket=sel["n_symptoms"].clip(upper=6).astype(int).astype(str).replace({"6": "6+"}))
            rows = stats.positivity_by(sel, "bucket", stats.SYMPTOM_COUNT_BUCKETS)
        elif dim == "age_group":
            rows = stats.positivity_by(sel, "age_group", stats.AGE_GROUPS)
        elif dim in ("test_category", "symptom_status", "week"):
            rows = stats.positivity_by(sel, dim)
        else:
            return {"error": f"unknown dimension {dim!r}"}
        return {"selection": asdict(f), "dimension": dim, "groups": rows}
    if name == "variable_detail":
        var = args.get("variable")
        if var not in stats.BINARY:
            return {"error": f"unknown variable {var!r}; choose from {stats.BINARY}"}
        return {"selection": asdict(f), **_compact(stats.variable_summary(sel, var))}
    if name == "rank_variables":
        fam = FAMILIES.get(args.get("family"))
        if not fam:
            return {"error": "family must be symptoms, conditions or exposure"}
        rows = sorted((_compact(stats.variable_summary(sel, v)) for v in fam), key=lambda r: -(r["odds_ratio"] or 0))
        return {"selection": asdict(f), "ranked_by_odds_ratio": rows}
    if name == "data_quality":
        topic = args.get("topic")
        if topic == "missingness":
            return {"missing_pct_by_column": quality["missingness"]}
        if topic in ("duplicates", "vitals", "cleaning_log"):
            return {topic: quality[topic]}
        return {"error": f"unknown topic {topic!r}"}
    return {"error": f"unknown tool {name!r}"}


# ----------------------------------------------------------------- client ---
def configured() -> bool:
    return all(os.environ.get(k) for k in ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"))


def _client():
    from openai import OpenAI
    return OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], timeout=90)


def _create(client, messages, tools=None, max_tokens=900, temperature=0.3):
    kw = dict(model=os.environ["LLM_MODEL"], messages=messages, max_tokens=max_tokens, temperature=temperature,
              extra_body={"chat_template_kwargs": {"enable_thinking": False}})
    if tools:
        kw.update(tools=tools, tool_choice="auto")
    return client.chat.completions.create(**kw)


def _clean(text: str | None) -> str:
    return _THINK.sub("", text or "").replace("/no_think", "").strip()


def _describe(f: stats.Filters) -> str:
    parts = [f"age {', '.join(f.age_groups)}" if f.age_groups else "",
             f"test {', '.join(f.test_categories)}" if f.test_categories else "",
             f"symptoms {', '.join(f.symptom_status)}" if f.symptom_status else "",
             f"weeks {f.week_from or 'start'} to {f.week_to or 'end'}" if f.week_from or f.week_to else ""]
    return "; ".join(p for p in parts if p) or "none (all tests)"


# ------------------------------------------------------------ planner mode ---
# Works with any chat model: one short call picks the data, the backend computes it, a second call
# answers from that data only. The default, because many hosted models ignore `tools`.
SECTIONS = {
    "positivity": ("get_positivity", {}),
    "by_age": ("positivity_by_group", {"dimension": "age_group"}),
    "by_test": ("positivity_by_group", {"dimension": "test_category"}),
    "by_symptom_status": ("positivity_by_group", {"dimension": "symptom_status"}),
    "by_week": ("positivity_by_group", {"dimension": "week"}),
    "by_symptom_count": ("positivity_by_group", {"dimension": "symptom_count"}),
    "symptoms": ("rank_variables", {"family": "symptoms"}),
    "conditions": ("rank_variables", {"family": "conditions"}),
    "exposure": ("rank_variables", {"family": "exposure"}),
    "missingness": ("data_quality", {"topic": "missingness"}),
    "duplicates": ("data_quality", {"topic": "duplicates"}),
    "vitals": ("data_quality", {"topic": "vitals"}),
    "cleaning_log": ("data_quality", {"topic": "cleaning_log"}),
}
DEFAULT_SECTIONS = ["positivity", "by_age", "by_test", "symptoms", "conditions", "exposure"]

PLANNER = """You choose which statistics are needed to answer the user's latest question about a dataset of \
SARS-CoV-2 tests. You do not answer the question.

Reply with ONLY a JSON object, no other text:
{{"filters": {{"age_groups": [], "test_categories": [], "symptom_status": [], "week_from": null, "week_to": null}},
 "sections": [], "what_if": null}}

filters: the selection the question is about. Start from the user's current dashboard filters ({current}) and \
change them only if the question names a different group or period (e.g. "children" -> age_groups ["0–18"]; \
"overall" or "all tests" -> no filters).
Allowed age_groups: {ages}. Allowed test_categories: {tests}. Allowed symptom_status: {status}.
Weeks are YYYY-MM-DD between {first} and {last}.

sections: 1 to 5 of {sections}. "positivity" is the headline rate; "by_*" split positivity by a dimension; \
"symptoms", "conditions" and "exposure" rank odds ratios; the rest describe data quality.

what_if: only for questions about patients with a particular combination of answers (e.g. "people over 60 with a cough and fever", "if someone lost their sense of smell"). Then give {{"target": "covid", "evidence": {{variable: state}}}} with only the answers the question names; otherwise null. Variables and states: {bayes_vars}. /no_think"""


def _valid_filters(raw: dict, df: pd.DataFrame) -> stats.Filters:
    """Planner output → Filters, dropping anything that isn't a real option."""
    f = _filters(raw)
    tests = set(df["test_category"].unique())
    week = re.compile(r"^\d{4}-\d{2}-\d{2}$")
    return stats.Filters(
        age_groups=[a for a in f.age_groups if a in stats.AGE_GROUPS],
        test_categories=[t for t in f.test_categories if t in tests],
        symptom_status=[x for x in f.symptom_status if x in stats.SYMPTOM_STATUS],
        week_from=f.week_from if f.week_from and week.match(str(f.week_from)) else None,
        week_to=f.week_to if f.week_to and week.match(str(f.week_to)) else None,
    )


def _plan(client, df: pd.DataFrame, convo: list[dict],
          current: stats.Filters) -> tuple[stats.Filters, list[str], dict | None]:
    weeks = sorted(df["week"].unique())
    system = PLANNER.format(current=json.dumps(asdict(current), ensure_ascii=False), ages=stats.AGE_GROUPS,
                            tests=sorted(df["test_category"].unique()), status=stats.SYMPTOM_STATUS,
                            first=weeks[0], last=weeks[-1], sections=list(SECTIONS),
                            bayes_vars="; ".join(f"{v}: {'/'.join(s)}" for v, s in bayes.variables().items()))
    try:
        text = _clean(_create(client, [{"role": "system", "content": system}, *convo[-4:]], max_tokens=250, temperature=0)
                      .choices[0].message.content)
        plan = json.loads(re.search(r"\{.*\}", text, re.S).group(0))
        sections = [x for x in plan.get("sections", []) if x in SECTIONS][:6]
        wi = plan.get("what_if") if isinstance(plan.get("what_if"), dict) else None
        return _valid_filters(plan.get("filters") or {}, df), sections or DEFAULT_SECTIONS, wi
    except Exception as e:  # unparseable plan: answer about the current selection with the usual sections
        log.warning("chat planner fell back to defaults: %s: %s", type(e).__name__, e)
        return current, DEFAULT_SECTIONS, None


def _answer_planned(client, df, quality, system, convo, current) -> dict:
    f, sections, wi = _plan(client, df, convo, current)
    if "positivity" not in sections:
        sections = ["positivity", *sections]
    data = {key: run_tool(SECTIONS[key][0], {**SECTIONS[key][1], "filters": asdict(f)}, df, quality) for key in sections}
    used = [{"name": key, "args": {"filters": asdict(f)}} for key in sections]
    if wi:
        wi_args = {"target": wi.get("target"), "evidence": wi.get("evidence")}
        data["what_if"] = run_tool("what_if", wi_args, df, quality)
        used.append({"name": "what_if", "args": wi_args})
    block = (f"DATA for the selection {_describe(f)} (computed by the dashboard; quote only these numbers, and say "
             f"so if something you'd need isn't here):\n{json.dumps(data, default=str, ensure_ascii=False)}")
    msg = _create(client, [{"role": "system", "content": system + "\n\n" + block}, *convo]).choices[0].message
    return {"reply": _clean(msg.content), "model": os.environ["LLM_MODEL"], "mode": "planner", "tools_used": used}


def answer(df: pd.DataFrame, quality: dict, history: list[dict], filters: dict | None, tab: str | None) -> dict:
    """Run the conversation; returns {reply, tools_used, model, mode}."""
    f = _filters(filters)
    system = SYSTEM.format(records=len(df), filters=_describe(f) + f"  (as tool filters: {json.dumps(asdict(f))})",
                           tab=tab or "overview")
    convo = [{"role": m["role"], "content": str(m["content"])[:MAX_MESSAGE_CHARS]}
             for m in history[-MAX_HISTORY:] if m.get("role") in ("user", "assistant") and m.get("content")]
    client = _client()
    if os.environ.get("LLM_TOOL_MODE", "planner") != "native":
        return _answer_planned(client, df, quality, system, convo, f)

    messages, used = [{"role": "system", "content": system}, *convo], []
    try:
        tools = tool_specs(df)
        for _ in range(MAX_TOOL_ROUNDS):
            msg = _create(client, messages, tools).choices[0].message
            if not msg.tool_calls:
                return {"reply": _clean(msg.content), "tools_used": used, "model": os.environ["LLM_MODEL"], "mode": "tools"}
            messages.append({"role": "assistant", "content": msg.content or "",
                             "tool_calls": [{"id": c.id, "type": "function",
                                             "function": {"name": c.function.name, "arguments": c.function.arguments}}
                                            for c in msg.tool_calls]})
            for c in msg.tool_calls:
                try:
                    args = json.loads(c.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                result = run_tool(c.function.name, args, df, quality)
                used.append({"name": c.function.name, "args": args})
                messages.append({"role": "tool", "tool_call_id": c.id, "content": json.dumps(result, default=str)})
        # too many rounds: ask for a final answer with what it has
        msg = _create(client, messages).choices[0].message
        return {"reply": _clean(msg.content), "tools_used": used, "model": os.environ["LLM_MODEL"], "mode": "tools"}
    except Exception as e:  # provider rejects tool calls: use the planner instead
        if "tool" not in str(e).lower() and "function" not in str(e).lower():
            raise
        return _answer_planned(client, df, quality, system, convo, f)
