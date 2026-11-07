# HealthSignal AI — Dashboard

### Hosted on Render - https://sinceai-hackathon-bayer-challenge.onrender.com/#overview

Interactive dashboard for the Carbon Health COVID-19 clinical testing data (Phase 1).

```
healthsignal/
├── backend/                 Python · FastAPI · pandas  (the "kitchen": data + statistics)
│   ├── main.py              API server: /api/meta, /api/dashboard, /api/quality
│   ├── bayes.py             Bayesian network queries (/api/bayes/graph, /api/bayes/query, chatbot what_if)
│   ├── stats.py             positivity, Wilson CIs, odds ratios (same maths as the notebook)
│   ├── prepare_data.py      turns notebook outputs into data/ (run after re-running the notebook)
│   ├── requirements.txt
│   └── data/                clean.parquet + quality.json (already included)
└── frontend/                React · Vite · Tailwind CSS · Recharts  (the "dining room": what people see)
    ├── package.json
    ├── vite.config.js       forwards /api to the backend during development
    └── src/
        ├── App.jsx          page layout, filters state, tabs
        ├── api.js           every call to the backend
        ├── index.css        colours (light + dark) — change the look here
        ├── lib/             number formatting, shared chart styling
        └── components/      Header, FilterBar, KpiCards, WeeklyChart, BreakdownCharts,
                             SymptomsCard, ConditionsTab, QualityTab, ui (shared pieces)
```

---

## 1. Install once

| Tool | Version | Check | Get it |
|---|---|---|---|
| Node.js (includes npm) | 20 or newer | `node -v` | https://nodejs.org (LTS) |
| Python | 3.10 or newer | `python --version` | https://python.org |
| VS Code (optional) | any | | https://code.visualstudio.com |

## 2. Set up the project (first time only)

**Backend** — open a terminal in the `backend` folder:

```bash
python -m venv .venv
# Windows:      .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
```

**Frontend** — open a second terminal in the `frontend` folder:

```bash
npm install
```

## 3. Run it (every time)

Terminal 1, in `backend` (activate the venv first if you closed the terminal):

```bash
uvicorn main:app --reload
```

Terminal 2, in `frontend`:

```bash
npm run dev
```

Open **http://localhost:5173**. Edits to any file reload the page automatically.

The API has its own test page at **http://localhost:8000/docs**, where you can try every endpoint.

## 4. How to use the dashboard

- **Filter chips** (age, test type, symptoms): click to add, click again to remove. Several in one group = either of them.
- **Click a bar** in the age or test-type chart to filter by it.
- **Drag the handles** under the weekly chart to pick a range of weeks.
- **Toggles** switch a chart between views (Positivity/Tests; Odds ratio/Prevalence/Symptom count).
- **Hover** anything for the exact number, 95% CI and n.
- **Tabs**: Overview · Conditions & exposure · Data quality. **Moon icon**: dark mode.

## 5. Updating the data

Re-run the Phase 1 notebook, then from `backend`:

```bash
python prepare_data.py --clean path/to/outputs/healthsignal_eda_clean.csv \
                       --log   path/to/outputs/cleaning_log.csv \
                       --raw   path/to/covidclinicaldata.csv
```

Restart the backend. The dashboard picks up the new numbers.

## 6. Put it online

Build the frontend once; FastAPI then serves the whole site from one address:

```bash
cd frontend && npm run build          # creates frontend/dist
cd ../backend && uvicorn main:app     # site + API on http://localhost:8000
```

For hosting (Render, Railway, Fly.io) use the included `Dockerfile`: create a new web service from your
GitHub repo and choose Docker. No other settings are needed; the app listens on the port the host provides.

## 7. Chatbot ("Ask HealthSignal")

The sparkle button at the bottom right (or press `/`) opens an assistant that answers questions about the data.
It uses any OpenAI-compatible LLM. Put these in `backend/.env` (never commit it; it's already in `.gitignore`):

```
LLM_BASE_URL=https://...        # the provider's OpenAI-compatible endpoint
LLM_API_KEY=...
LLM_MODEL=Qwen/Qwen3-32B
# LLM_TOOL_MODE=native          # optional: only for providers whose models really call tools
```

Check the connection with `python test_llm.py`. On a host, set the same values as environment variables
(no other settings are needed).

**Limits for a public demo** (`backend/main.py`, kept in memory, so they reset when the server restarts):

- 15 questions per visitor per hour. The visitor is the first address in `X-Forwarded-For`, else the socket address.
- `CHAT_DAILY_LIMIT` questions per day in total, across all visitors (default 300; resets at midnight UTC).
- `DEMO_ACCESS_CODE` (optional): when set, the chat asks for this code once per browser tab.

Visitors who hit a limit see a friendly message in the chat; the charts keep working.

How it stays accurate (`backend/chat.py`): the model never sees raw rows and never does arithmetic. A short first
call returns JSON naming the selection and statistics it needs; `stats.py` computes them; a second call writes the
answer from those numbers only. Under each answer the chat shows what was checked and for which selection. By
default it uses the filters applied on the dashboard; a switch in the chat header turns that off.

## 8. Next steps

- **Bayesian network**: trained by `python modeling/train_bayes.py` (report in `modeling/bayes_report.md`). The backend
  serves it at `GET /api/bayes/graph` and `POST /api/bayes/query`, and the chatbot's `what_if` tool uses it.
  Tests: `cd backend && python -m pytest tests -q`.

## Notes on the numbers

- Positivity uses Wilson 95% intervals; odds ratios use Woolf 95% intervals with a 0.5 correction.
- "Unknown" answers are never counted as "No".
- 31,653 exact duplicate rows are kept (no patient ID to confirm they are the same person). Without them overall
  positivity would be 2.10% instead of 1.40%; this is shown on the Data quality tab.
- Report week is the batch release date, not the exact test date.
