"""Chatbot tool tests. No LLM calls: the planner test uses a stub client.

Run from backend/:   python -m pytest tests -q
"""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bayes  # noqa: E402
import chat  # noqa: E402
import stats  # noqa: E402

DF = stats.load_data()
bayes.load(DF)

# Matched by fewer than 30 rows of clean.parquet (checked in the test, not assumed)
RARE = {"age_group": "0-18", "loss_of_smell": "Yes", "sob": "Yes", "diarrhea": "Yes"}


def run(args):
    return chat.run_tool("what_if", args, DF, {})


# ---------------------------------------------------------------- what_if ---
def test_what_if_valid_query():
    r = run({"evidence": {"loss_of_smell": "Yes"}})
    assert "error" not in r
    assert r["target"] == "covid"
    assert sum(r["pct_of_patients_with_this_profile"].values()) == pytest.approx(100, abs=0.01)
    assert 0 < r["probability"] < 1
    no = run({"evidence": {"loss_of_smell": "No"}})
    assert r["probability"] > 5 * no["probability"]          # the strongest single sign
    assert r["matching_patients"] == int((DF["loss_of_smell"] == True).sum())  # noqa: E712
    assert r["warning"] is None
    assert r["overall_positivity_pct"] == stats.positivity(DF)["pct"]
    assert "not any individual's risk" in r["about"]


def test_what_if_accepts_dashboard_labels_and_other_targets():
    a = run({"evidence": {"age_group": "61+", "cough": "yes"}})
    b = run({"evidence": {"age_group": "61+", "cough": "Yes"}})
    assert a == b
    assert run({"evidence": {"age_group": "0–18"}})["profile"] == {"age_group": "0-18"}
    r = run({"target": "loss_of_taste", "evidence": {"loss_of_smell": "Yes"}})
    assert set(r["pct_of_patients_with_this_profile"]) == {"No", "Yes"}
    assert "probability" not in r


def test_what_if_bad_variable_name():
    with pytest.raises(bayes.ToolError) as e:
        bayes.query("covid", {"smell": "Yes"})
    assert "unknown variable 'smell'" in str(e.value) and "loss_of_smell" in str(e.value)
    r = run({"evidence": {"smell": "Yes"}})
    assert "unknown variable" in r["error"] and "loss_of_smell" in r["error"]
    assert "error" in run({"target": "positive"})


def test_what_if_bad_state_and_target_as_evidence():
    r = run({"evidence": {"fever": "Maybe"}})
    assert "allowed: ['No', 'Yes']" in r["error"]
    assert "can't also be evidence" in run({"evidence": {"covid": "Positive"}})["error"]


def test_what_if_small_group_warning():
    r = run({"evidence": RARE})
    assert r["matching_patients"] < bayes.MIN_MATCHES
    assert r["warning"] and str(r["matching_patients"]) in r["warning"]
    assert 0 < r["probability"] < 1                            # the network still answers


def test_query_is_cached():
    bayes._query.cache_clear()
    bayes.query("covid", {"fever": "Yes", "cough": "Yes"})
    bayes.query("covid", {"cough": "Yes", "fever": "yes"})      # same evidence, other order and case
    assert bayes._query.cache_info().hits == 1


def test_marginals_cover_every_variable():
    m = bayes.marginals({"loss_of_smell": "Yes"})
    assert set(m["marginals"]) == set(bayes.variables())
    assert m["marginals"]["loss_of_smell"] == {"No": 0.0, "Yes": 1.0}
    assert m["marginals"]["covid"]["Positive"] == pytest.approx(bayes.query("covid", {"loss_of_smell": "Yes"})
                                                                ["probabilities"]["Positive"])


def test_tool_spec_lists_what_if():
    names = [t["function"]["name"] for t in chat.tool_specs(DF)]
    assert "what_if" in names
    assert "never present it as the user's personal risk" in chat.SYSTEM


# ---------------------------------------------------------- planner mode ---
class StubClient:
    """Returns a fixed plan for the first call and records the DATA block of the second."""

    def __init__(self, plan):
        self.plan, self.seen = plan, []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, messages, **_):
        self.seen.append(messages)
        text = json.dumps(self.plan) if len(self.seen) == 1 else "ok"
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


def test_planner_runs_what_if(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "stub")
    plan = {"filters": {}, "sections": ["positivity"],
            "what_if": {"target": "covid", "evidence": {"age_group": "61+", "fever": "Yes"}}}
    client = StubClient(plan)
    out = chat._answer_planned(client, DF, {}, "system", [{"role": "user", "content": "over 60 with fever?"}],
                               stats.Filters())
    assert [u["name"] for u in out["tools_used"]] == ["positivity", "what_if"]
    block = client.seen[1][0]["content"]
    assert '"what_if"' in block and '"matching_patients"' in block


def test_planner_without_what_if_is_unchanged(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "stub")
    client = StubClient({"filters": {}, "sections": ["by_age"]})
    out = chat._answer_planned(client, DF, {}, "system", [{"role": "user", "content": "by age?"}], stats.Filters())
    assert [u["name"] for u in out["tools_used"]] == ["positivity", "by_age"]
    assert '"what_if"' not in client.seen[1][0]["content"]


# -------------------------------------------------------------- influence ---
def test_influence_ranks_every_feature():
    r = bayes.influence({})
    names = [f["variable"] for f in r["factors"]]
    assert sorted(names) == sorted(v for v in bayes.variables() if v != "covid")
    assert [f["rank"] for f in r["factors"]] == list(range(1, len(names) + 1))
    strengths = [f["strength"] for f in r["factors"]]
    assert strengths == sorted(strengths, reverse=True)
    top = r["factors"][0]
    assert top["variable"] == "loss_of_smell" and top["highest"] == "Yes" and top["ratio"] > 5


def test_influence_holds_the_profile_fixed():
    ev = {"age_group": "61+", "fever": "Yes"}
    r = bayes.influence(ev)
    fever = next(f for f in r["factors"] if f["variable"] == "fever")
    assert fever["set"] == "Yes"
    assert fever["p_positive_by_state"]["Yes"] == pytest.approx(r["p_positive"])
    assert fever["p_positive_if_not_set"] == pytest.approx(bayes.query("covid", {"age_group": "61+"})["probabilities"]["Positive"])
    with pytest.raises(bayes.ToolError):
        bayes.influence({"covid": "Positive"})
