"""
HealthSignal AI — API server.

Local:   uvicorn main:app --reload           (API on http://localhost:8000)
Docs:    http://localhost:8000/docs           (try every endpoint in the browser)

If ../frontend/dist exists (after `npm run build`), this server also serves the
dashboard itself, so production is one app on one port.
"""
import hmac
import json
import os
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import bayes
import chat
import stats

load_dotenv(Path(__file__).parent / ".env")  # LLM_BASE_URL / LLM_API_KEY / LLM_MODEL for the chatbot

HERE = Path(__file__).parent
DIST = HERE.parent / "frontend" / "dist"

app = FastAPI(title="HealthSignal AI API", version="1.0.0")
app.add_middleware(  # lets the Vite dev server (port 5173) call the API during development
    CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"], allow_headers=["*"],
)

DF = stats.load_data()
QUALITY = json.loads((stats.DATA_DIR / "quality.json").read_text(encoding="utf-8"))
bayes.load(DF)  # Bayesian network from modeling/train_bayes.py


class FilterBody(BaseModel):
    age_groups: list[str] = Field(default_factory=list, examples=[["61+"]])
    test_categories: list[str] = Field(default_factory=list)
    symptom_status: list[str] = Field(default_factory=list)
    week_from: str | None = Field(default=None, examples=["2020-06-02"])
    week_to: str | None = None


@app.get("/api/health")
def health():
    return {"status": "ok", "records": len(DF)}


@app.get("/api/meta")
def get_meta():
    """Filter options, week list and overall positivity."""
    return stats.meta(DF)


@lru_cache(maxsize=512)
def _cached(key: str):
    return stats.dashboard(DF, stats.Filters(**json.loads(key)))


@app.post("/api/dashboard")
def get_dashboard(body: FilterBody):
    """All numbers for one filter selection (cached per selection)."""
    key = json.dumps(body.model_dump(), sort_keys=True)
    return _cached(key)


@app.get("/api/quality")
def get_quality():
    """Static data-quality tables: missing values, duplicates, vitals, cleaning log."""
    return QUALITY


# ---- chatbot -----------------------------------------------------------------
class ChatMessage(BaseModel):
    role: str = Field(examples=["user"])
    content: str = Field(examples=["Which age group had the highest positivity?"])


class ChatBody(BaseModel):
    messages: list[ChatMessage]
    filters: FilterBody = Field(default_factory=FilterBody)
    tab: str | None = None


# Limits for a public demo. Kept in memory: they reset when the server restarts and assume one server process.
HOURLY_LIMIT = 15        # questions per visitor per rolling hour
DEFAULT_DAILY_LIMIT = 300


def _daily_limit() -> int:
    try:
        return max(0, int(os.environ.get("CHAT_DAILY_LIMIT", DEFAULT_DAILY_LIMIT)))
    except ValueError:
        return DEFAULT_DAILY_LIMIT


def _in_minutes(seconds: float) -> str:
    m = max(1, round(seconds / 60))
    if m <= 60:
        return f"{m} minute{'s' if m != 1 else ''}"
    h, rest = divmod(m, 60)
    return f"{h} h {rest} min" if rest else f"{h} hours"


class ChatLimits:
    """Rolling one-hour window per visitor, plus a total per UTC day."""

    def __init__(self):
        self.lock = threading.Lock()
        self.reset()

    def reset(self):
        self.recent: dict[str, deque] = defaultdict(deque)
        self.day, self.today = None, 0

    def take(self, visitor: str, now: float | None = None) -> None:
        """Count one question, or raise 429 with a message for the chat."""
        now = time.time() if now is None else now
        today = datetime.fromtimestamp(now, timezone.utc).date()
        with self.lock:
            if self.day != today:
                self.day, self.today = today, 0
            if self.today >= _daily_limit():
                midnight = datetime.combine(today + timedelta(days=1), datetime.min.time(), timezone.utc).timestamp()
                done = (f"The assistant has answered its {_daily_limit()} questions for today, the daily limit for this demo."
                        if _daily_limit() else "The assistant is switched off for today in this demo.")
                raise HTTPException(429, f"{done} It resets in about {_in_minutes(midnight - now)} (midnight UTC). "
                                         "The charts keep working in the meantime.",
                                    headers={"Retry-After": str(int(midnight - now) + 1)})
            q = self.recent[visitor]
            while q and q[0] <= now - 3600:
                q.popleft()
            if len(q) >= HOURLY_LIMIT:
                wait = q[0] + 3600 - now
                raise HTTPException(429, f"You've asked {HOURLY_LIMIT} questions in the last hour, the limit for this demo. "
                                         f"You can ask again in about {_in_minutes(wait)}.",
                                    headers={"Retry-After": str(int(wait) + 1)})
            q.append(now)
            self.today += 1
            if len(self.recent) > 10_000:  # drop visitors with nothing in the window
                self.recent = defaultdict(deque, {k: v for k, v in self.recent.items() if v and v[-1] > now - 3600})


LIMITS = ChatLimits()


def _visitor(request: Request) -> str:
    """Client IP: the first value of X-Forwarded-For (set by the hosting proxy), else the socket address."""
    fwd = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return fwd or (request.client.host if request.client else "unknown")


def _check_access(code: str | None) -> None:
    """If DEMO_ACCESS_CODE is set, the X-Access-Code header must match it."""
    expected = os.environ.get("DEMO_ACCESS_CODE")
    if not expected:
        return
    if not code:
        raise HTTPException(401, "This demo's assistant needs an access code. Enter the code you were given.")
    if not hmac.compare_digest(code.strip().encode(), expected.encode()):
        raise HTTPException(401, "That access code didn't work. Check it and try again.")


@app.get("/api/chat/status")
def chat_status():
    """Whether an LLM is configured (the key itself is never sent to the browser)."""
    return {"configured": chat.configured(), "model": os.environ.get("LLM_MODEL") if chat.configured() else None}


@app.post("/api/chat")
def chat_reply(body: ChatBody, request: Request, x_access_code: str | None = Header(default=None)):
    """Answer a question about the data. The LLM gets tools that call stats.apply_filters /
    stats.positivity_by / stats.variable_summary, so every number it quotes comes from this code.

    Limits: HOURLY_LIMIT questions per visitor per hour and CHAT_DAILY_LIMIT in total per day (429);
    if DEMO_ACCESS_CODE is set, the X-Access-Code header must match it (401)."""
    if not chat.configured():
        raise HTTPException(503, "The chatbot isn't configured: set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL in backend/.env")
    _check_access(x_access_code)
    if not body.messages or body.messages[-1].role != "user":
        raise HTTPException(400, "The last message must come from the user")
    LIMITS.take(_visitor(request))
    try:
        return chat.answer(DF, QUALITY, [m.model_dump() for m in body.messages], body.filters.model_dump(), body.tab)
    except Exception as e:  # provider down, bad key, timeout…
        raise HTTPException(502, f"The language model didn't respond: {type(e).__name__}: {str(e)[:300]}")


# ---- Bayesian network ----------------------------------------------------------
class BayesQuery(BaseModel):
    target: str = Field(default="covid", examples=["covid"])
    evidence: dict[str, str] = Field(default_factory=dict, examples=[{"age_group": "61+", "loss_of_smell": "Yes"}])


@app.get("/api/bayes/graph")
def bayes_graph():
    """Nodes, edges and states of the network, with its test metrics."""
    return bayes.graph()


@app.post("/api/bayes/query")
def bayes_query(body: BayesQuery):
    """P(each state) of every variable given the evidence, plus the target's probabilities and how many
    patients match the evidence exactly. Describes patients with that profile, not one person's risk."""
    try:
        target, _ = bayes.validate(body.target, {})
        m = bayes.marginals(body.evidence)  # the target may be evidence too, e.g. covid=Positive → symptom picture
        return {**m, "target": target, "probabilities": m["marginals"][target]}
    except bayes.ToolError as e:
        raise HTTPException(400, str(e))


class BayesEvidence(BaseModel):
    evidence: dict[str, str] = Field(default_factory=dict, examples=[{"age_group": "61+", "fever": "Yes"}])


@app.post("/api/bayes/influence")
def bayes_influence(body: BayesEvidence):
    """Features ranked by their effect on P(positive test) for patients with this profile: for each one,
    P(positive) in each of its states with the rest of the profile fixed, and the high/low ratio."""
    try:
        return bayes.influence(body.evidence)
    except bayes.ToolError as e:
        raise HTTPException(400, str(e))


# ---- serve the built React app (production) -------------------------------
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
