"""Chat limits and access code on POST /api/chat. The LLM is replaced by a stub, so nothing leaves the machine.

Run from backend/:   python -m pytest tests -q
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import chat  # noqa: E402
import main  # noqa: E402

BODY = {"messages": [{"role": "user", "content": "How many tests?"}]}


@pytest.fixture(autouse=True)
def stub_llm(monkeypatch):
    monkeypatch.setattr(chat, "configured", lambda: True)
    monkeypatch.setattr(chat, "answer", lambda *a, **k: {"reply": "ok", "tools_used": [], "model": "stub", "mode": "stub"})
    monkeypatch.delenv("DEMO_ACCESS_CODE", raising=False)
    monkeypatch.delenv("CHAT_DAILY_LIMIT", raising=False)
    main.LIMITS.reset()
    yield
    main.LIMITS.reset()


client = TestClient(main.app)


def ask(ip="203.0.113.7", **headers):
    return client.post("/api/chat", json=BODY, headers={"X-Forwarded-For": ip, **headers})


# ------------------------------------------------------------ per visitor ---
def test_fifteen_questions_per_hour_per_visitor():
    for _ in range(main.HOURLY_LIMIT):
        assert ask().status_code == 200
    r = ask()
    assert r.status_code == 429
    assert "15 questions in the last hour" in r.json()["detail"] and "about 60 minutes" in r.json()["detail"]
    assert 3500 < int(r.headers["Retry-After"]) <= 3601
    assert ask("198.51.100.1").status_code == 200            # someone else is unaffected


def test_visitor_is_first_forwarded_address():
    for _ in range(main.HOURLY_LIMIT):
        assert ask("203.0.113.9, 10.0.0.1").status_code == 200
    assert ask("203.0.113.9, 10.0.0.2").status_code == 429    # same client behind another proxy hop
    assert ask("10.0.0.1").status_code == 200


def test_hour_is_a_rolling_window():
    t0 = 1_700_000_000
    for i in range(main.HOURLY_LIMIT):
        main.LIMITS.take("v", now=t0 + i)
    with pytest.raises(main.HTTPException) as e:
        main.LIMITS.take("v", now=t0 + 3599)
    assert e.value.status_code == 429
    main.LIMITS.take("v", now=t0 + 3600)                       # the first question has left the window


# --------------------------------------------------------------- per day ---
def test_daily_total_across_visitors(monkeypatch):
    monkeypatch.setenv("CHAT_DAILY_LIMIT", "3")
    for i in range(3):
        assert ask(f"192.0.2.{i}").status_code == 200
    r = ask("192.0.2.99")
    assert r.status_code == 429
    assert "3 questions for today" in r.json()["detail"] and "midnight UTC" in r.json()["detail"]


def test_daily_total_resets_next_day(monkeypatch):
    monkeypatch.setenv("CHAT_DAILY_LIMIT", "2")
    day = 1_700_000_000
    main.LIMITS.take("a", now=day)
    main.LIMITS.take("b", now=day + 1)
    with pytest.raises(main.HTTPException):
        main.LIMITS.take("c", now=day + 2)
    main.LIMITS.take("c", now=day + 86_400)


def test_daily_limit_default_and_bad_value(monkeypatch):
    assert main._daily_limit() == 300
    monkeypatch.setenv("CHAT_DAILY_LIMIT", "lots")
    assert main._daily_limit() == 300


# ----------------------------------------------------------- access code ---
def test_access_code_required_when_set(monkeypatch):
    monkeypatch.setenv("DEMO_ACCESS_CODE", "sesame-42")
    r = ask()
    assert r.status_code == 401 and "needs an access code" in r.json()["detail"]
    r = ask(**{"X-Access-Code": "wrong"})
    assert r.status_code == 401 and "didn't work" in r.json()["detail"]
    assert ask(**{"X-Access-Code": "sesame-42"}).status_code == 200
    assert main.LIMITS.today == 1                              # refused requests don't use up the quota


def test_no_code_needed_when_unset():
    assert ask().status_code == 200


def test_bad_request_does_not_count():
    r = client.post("/api/chat", json={"messages": [{"role": "assistant", "content": "hi"}]})
    assert r.status_code == 400
    assert main.LIMITS.today == 0
