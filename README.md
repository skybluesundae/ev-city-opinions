# CityScope — City Conversation Explorer

A React website and Python API for comparing how city communities discuss a topic you choose. The included **synthetic** CSV contains 2,310 fictional posts across 11 Indian cities and three demonstration topics: electric vehicles, metro travel, and work from home. Synthetic patterns are for testing the interface, not research findings.

## Run in VS Code on Windows

Install Python 3.11+, Node.js, Git for Windows, and the VS Code Python extension. Extract this ZIP and use **File → Open Folder** to open `ev-city-opinions`.

**Terminal 1 — API** (from the project root):

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn api:app --reload
```

The API runs at `http://127.0.0.1:8000`; its interactive documentation is at `/docs`. Keep this terminal open.

**Terminal 2 — website** (open another VS Code terminal):

```powershell
cd frontend
npm install
npm run dev
```

Open the URL printed by Vite, normally `http://127.0.0.1:5173`. Keep this terminal open too. You can select the `.venv` interpreter with **Ctrl+Shift+P → Python: Select Interpreter**. The frontend source is in `frontend/src/App.jsx` and `frontend/src/styles.css`. Saving either file updates the site while the development server runs.

## Use the app

- Try a demo topic chip, then click **Analyze conversations**. The sample CSV covers EVs, metro, and work from home.
- Change the matching words or phrases, select city communities, and explore the map, sentiment chart, themes, local keywords, and individual posts.
- Upload a UTF-8 CSV for a different topic. Required columns are `text,city`. Optional: `id,created_utc,score,review_label`; `created_utc` is Unix seconds. The file limit is 5 MB. The CSV must already contain posts about your topic; entering a topic does not fetch posts.
- Under **Explore posts**, filter **Needs review** and set a human sentiment label on flagged posts. The chart recalculates using that correction. Corrections last for this browser session; use **Export corrections** to download an `id,review_label` CSV. Join those labels with your source CSV by `id` if you want to preserve them for a later upload.

## What each file does

- `frontend/src/App.jsx`: React interface, charts, city map, post review controls, API calls.
- `frontend/src/styles.css`: responsive styling.
- `api.py`: FastAPI endpoints `/metadata` and `/analyze`; CORS configured for local Vite.
- `analysis.py`: topic matching, sentiment, review flags, themes, per-city measures.
- `generate_sample.py` and `data/synthetic_city_posts.csv`: reproducible fictional examples.

Sentiment starts with English VADER. A cautious rule flags some praise-plus-problem wording, including “Great, the metro is late by only 37 minutes today instead of 40!” The uncorrected flag is excluded from average sentiment, while `raw_sentiment` remains visible. It misses other sarcasm and can flag literal praise. Theme labels are approximate NMF word clusters. Validate both against manually labeled real posts before drawing conclusions. A city subreddit is a proxy for the discussion venue, not proof of a writer's residence.

## GitHub and next work

With Git installed, use VS Code **Source Control → Initialize Repository → Commit → Publish to GitHub**. `.venv`, `frontend/node_modules`, and build output are ignored; commit `frontend/package-lock.json` for reproducible dependencies.

For real Reddit data, first obtain explicit Data API approval. Collect authorized data separately, using consistent keywords and date ranges for each city, then upload the CSV. The current website does not collect Reddit posts automatically.
