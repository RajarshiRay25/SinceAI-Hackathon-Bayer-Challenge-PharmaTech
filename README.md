<div align="center">

# 🩺 HealthSignal AI

**An interactive dashboard, Bayesian what-if explorer and data assistant for COVID-19 clinical testing data**

Built on the Carbon Health COVID-19 Clinical Data Repository: 93,995 tests, April to October 2020

### 🌐 [Live demo: sinceai-hackathon-bayer-challenge.onrender.com](https://sinceai-hackathon-bayer-challenge.onrender.com/#overview)

[![Live on Render](https://img.shields.io/badge/Live_demo-Render-46E3B7?logo=render&logoColor=white)](https://sinceai-hackathon-bayer-challenge.onrender.com/#overview)
![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.1-06B6D4?logo=tailwindcss&logoColor=white)
![Recharts](https://img.shields.io/badge/Recharts-2.15-22B5BF)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)
![pandas](https://img.shields.io/badge/pandas-2.x-150458?logo=pandas&logoColor=white)
![pgmpy](https://img.shields.io/badge/pgmpy-1.1.2-8A2BE2)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)

[Live demo](https://sinceai-hackathon-bayer-challenge.onrender.com/#overview) · [Features](#-features) · [Run locally](#-quick-start) · [API](#-api-reference) · [Chatbot](#-ask-healthsignal-chatbot) · [Deploy](#%EF%B8%8F-deployment)

</div>

---

## ✨ Features

| View | What it shows |
|---|---|
| 📊 **[Overview](https://sinceai-hackathon-bayer-challenge.onrender.com/#overview)** | Weekly positivity and test volume, positivity by age group and test type, and symptom signals (odds ratios, prevalence, symptom count) |
| ❤️ **[Conditions & exposure](https://sinceai-hackathon-bayer-challenge.onrender.com/#conditions)** | Underlying conditions and high-risk exposure, as odds ratios with 95% CIs |
| 🛡️ **[Data quality](https://sinceai-hackathon-bayer-challenge.onrender.com/#quality)** | Missing values, duplicates, vital signs and every cleaning step |
| 🔮 **[What-if explorer](https://sinceai-hackathon-bayer-challenge.onrender.com/#whatif)** | A Bayesian network: pick a patient profile and see what moves the estimated positivity |
| 👥 **[About us](https://sinceai-hackathon-bayer-challenge.onrender.com/#about)** | The team, the views and the tech stack |
| ✨ **Ask HealthSignal** | An LLM assistant whose numbers are all computed by the backend, never by the model |

Each tab has its own URL, so it can be bookmarked or shared. Light and dark themes are included.

---

## 🗂️ Project structure

```
healthsignal/
├── backend/                 Python · FastAPI · pandas · pgmpy   (data + statistics)
│   ├── main.py              API server, chat limits; serves the built frontend in production
│   ├── stats.py             positivity, Wilson CIs, odds ratios (same maths as the notebook)
│   ├── bayes.py             Bayesian network queries (graph, query, influence, chatbot what_if)
│   ├── chat.py              two-step LLM assistant (plan → compute → answer)
│   ├── prepare_data.py      turns notebook outputs into data/
│   ├── test_llm.py          checks the LLM connection
│   ├── tests/               pytest: chat + rate limits
│   └── data/                clean.parquet, quality.json, bayes_model.bif, bayes_meta.json
├── frontend/                React · Vite · Tailwind CSS · Recharts   (what people see)
│   ├── vite.config.js       forwards /api to the backend during development
│   └── src/
│       ├── App.jsx          page layout, filter state, tabs
│       ├── api.js           every call to the backend
│       ├── index.css        colours (light + dark): change the look here
│       ├── lib/             number formatting, chart styling, motion helpers
│       └── components/      Header, FilterBar, KpiCards, WeeklyChart, BreakdownCharts, SymptomsCard,
│                            ConditionsTab, QualityTab, BayesExplorer, ChatPanel, AboutPage, ui, plots
├── modeling/
│   ├── train_bayes.py       trains and compares expert vs learned Bayesian networks
│   ├── bayes_report.md      evaluation report
│   └── figures/             DAGs, PR curve, calibration plot
└── Dockerfile               one container: builds the frontend, serves site + API
```

---

## 🚀 Quick start

### 1. Prerequisites

| Tool | Version | Check | Get it |
|---|---|---|---|
| Node.js (includes npm) | 20 or newer | `node -v` | https://nodejs.org (LTS) |
| Python | 3.10 or newer | `python --version` | https://python.org |
| VS Code (optional) | any | | https://code.visualstudio.com |

### 2. Set up (first time only)

**Backend**, in the `backend` folder:

```bash
python -m venv .venv
# Windows:      .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
```

**Frontend**, in a second terminal in the `frontend` folder:

```bash
npm install
```

### 3. Run (every time)

```bash
# Terminal 1, in backend/ (venv activated)
uvicorn main:app --reload

# Terminal 2, in frontend/
npm run dev
```

| URL | What |
|---|---|
| 🌐 **http://localhost:5173** | The dashboard (reloads automatically on edits) |
| 📘 **http://localhost:8000/docs** | Interactive API docs: try every endpoint |

---

## 🖱️ Using the dashboard

- **Filter chips** (age, test type, symptoms): click to add, click again to remove. Several in one group means either of them.
- **Click a bar** in the age or test-type chart to filter by it.
- **Drag the handles** under the weekly chart to pick a range of weeks.
- **Toggles** switch a chart between views (Positivity / Tests; Odds ratio / Prevalence / Symptom count).
- **Hover** anything for the exact number, 95% CI and n.
- **Moon icon** switches to dark mode. **Arrow keys** move between tabs.

---

## 🔌 API reference

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Status and record count |
| `GET` | `/api/meta` | Filter options, week list, overall positivity |
| `POST` | `/api/dashboard` | All numbers for one filter selection (cached per selection) |
| `GET` | `/api/quality` | Data-quality tables: missing values, duplicates, vitals, cleaning log |
| `GET` | `/api/chat/status` | Whether an LLM is configured |
| `POST` | `/api/chat` | Ask the assistant a question |
| `GET` | `/api/bayes/graph` | Network nodes, edges, states and test metrics |
| `POST` | `/api/bayes/query` | Probabilities of every variable given evidence |
| `POST` | `/api/bayes/influence` | Features ranked by their effect on P(positive test) for a profile |

Example filter body for `/api/dashboard`:

```json
{ "age_groups": ["61+"], "test_categories": [], "symptom_status": [], "week_from": "2020-06-02", "week_to": null }
```

---

## 💬 Ask HealthSignal (chatbot)

The sparkle button at the bottom right (or press `/`) opens an assistant that answers questions about the data. It works with any OpenAI-compatible LLM. Put these in `backend/.env` (it's in `.gitignore`; never commit it):

```env
LLM_BASE_URL=https://...        # the provider's OpenAI-compatible endpoint
LLM_API_KEY=...
LLM_MODEL=Qwen/Qwen3-32B
# LLM_TOOL_MODE=native          # optional: only for providers whose models really call tools
```

Check the connection with `python test_llm.py`. On a host, set the same values as environment variables.

**How it stays accurate** (`backend/chat.py`): the model never sees raw rows and never does arithmetic.

```
question ──► LLM call 1: returns JSON naming the selection + statistics it needs
         ──► stats.py / bayes.py compute them
         ──► LLM call 2: writes the answer from those numbers only
```

Under each answer the chat shows what was checked and for which selection. By default it uses the filters applied on the dashboard; a switch in the chat header turns that off.

**Limits for a public demo** (in memory, so they reset when the server restarts):

| Setting | Default | Meaning |
|---|---|---|
| Per visitor | 15 / hour | Visitor = first address in `X-Forwarded-For`, else the socket address |
| `CHAT_DAILY_LIMIT` | 300 / day | Total across all visitors; resets at midnight UTC |
| `DEMO_ACCESS_CODE` | unset | When set, the chat asks for this code once per browser tab |

Visitors who hit a limit see a friendly message in the chat, and the charts keep working.

---

## 🧠 Bayesian network

Trained with `python modeling/train_bayes.py`, which compares an expert-designed DAG with a hill-climbing learned DAG. The full evaluation is in [`modeling/bayes_report.md`](modeling/bayes_report.md).

- **Chosen structure:** learned BN (47 edges), saved to `backend/data/bayes_model.bif`
- **Held-out Sep–Oct 2020:** PR-AUC **0.091** (12.8× the 0.0071 baseline), ROC-AUC **0.660**
- Logistic regression on the same variables, for comparison: PR-AUC 0.080, ROC-AUC 0.659
- A missing symptom is never treated as "No"; the network averages over it

It powers the **What-if explorer** tab, the `/api/bayes/*` endpoints and the chatbot's `what_if` tool.

---

## 🔄 Updating the data

Re-run the Phase 1 notebook, then from `backend`:

```bash
python prepare_data.py --clean path/to/outputs/healthsignal_eda_clean.csv \
                       --log   path/to/outputs/cleaning_log.csv \
                       --raw   path/to/covidclinicaldata.csv
```

Restart the backend and the dashboard picks up the new numbers.

---

## ☁️ Deployment

Build the frontend once; FastAPI then serves the whole site from one address:

```bash
cd frontend && npm run build          # creates frontend/dist
cd ../backend && uvicorn main:app     # site + API on http://localhost:8000
```

**Live deployment:** the app is hosted on Render at **https://sinceai-hackathon-bayer-challenge.onrender.com**.

**Docker** (Render, Railway, Fly.io): create a new web service from the GitHub repo and choose Docker. The included `Dockerfile` builds the React app and serves it with the API. The app listens on the `PORT` the host provides, so no other settings are needed. Add the LLM variables if you want the chatbot.

---

## 🧪 Tests

```bash
cd backend && python -m pytest tests -q
```

---

## 📐 Notes on the numbers

- Positivity uses **Wilson 95% intervals**; odds ratios use **Woolf 95% intervals** with a 0.5 correction.
- "Unknown" answers are never counted as "No".
- 31,653 exact duplicate rows are kept (there is no patient ID to confirm they are the same person). Without them, overall positivity would be 2.10% instead of 1.40%; this is shown on the Data quality tab.
- Report week is the batch release date, not the exact test date.

---

## 👥 Team

| | Role |
|---|---|
| **Rajarshi Ray** | Biomedical Informatics Researcher, Tampere University |
| **Yunseon Lee** | Doctoral Researcher in Computer Science, University of Helsinki |

<div align="center">

**[🌐 Open the live dashboard](https://sinceai-hackathon-bayer-challenge.onrender.com/#overview)** · **[GitHub repo](https://github.com/RajarshiRay25/SinceAI-Hackathon-Bayer-Challenge-PharmaTech)**

Data: Carbon Health COVID-19 Clinical Data Repository · Built for the SinceAI Hackathon, Bayer challenge

</div>
