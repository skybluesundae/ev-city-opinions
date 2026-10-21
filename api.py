"""JSON analysis API for the included React frontend."""
import json
from io import BytesIO
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from analysis import CITIES, analyze, city_summary, discover_themes, distinctive_terms, load_posts, select_topic

app = FastAPI(title="City Conversation Explorer API", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["*"])
SAMPLE = Path(__file__).parent / "data" / "synthetic_city_posts.csv"
MAX_UPLOAD = 5 * 1024 * 1024


@app.get("/metadata")
def metadata():
    return {"cities": list(CITIES), "demo_topics": [
        {"name": "Electric vehicles", "keywords": "EV, electric car, electric vehicle"},
        {"name": "Metro", "keywords": "metro"},
        {"name": "Work from home", "keywords": "WFH, work from home"}],
        "required_csv_columns": ["text", "city"], "sample_is_synthetic": True}


@app.post("/analyze")
async def analyze_topic(keywords: str = Query(..., min_length=1), cities: str = "",
                        file: UploadFile | None = File(None), overrides: str = Form("{}")):
    if file is not None:
        data = await file.read(MAX_UPLOAD + 1)
        if len(data) > MAX_UPLOAD:
            raise HTTPException(413, "CSV exceeds 5 MB")
        source = BytesIO(data)
        source_name = "uploaded_csv"
    else:
        source = SAMPLE
        source_name = "synthetic_demo"
    try:
        all_posts = load_posts(source)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(400, f"Invalid CSV: {exc}") from exc
    chosen = [s.strip().title() for s in cities.split(",") if s.strip()] or list(CITIES)
    invalid = set(chosen) - set(CITIES)
    if invalid:
        raise HTTPException(400, f"Unknown cities: {', '.join(sorted(invalid))}")
    try:
        corrections = json.loads(overrides)
        if not isinstance(corrections, dict) or len(corrections) > 1000 or any(
            str(v).title() not in {"Positive", "Negative", "Neutral"} for v in corrections.values()
        ):
            raise ValueError("invalid review labels")
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, "overrides must be a JSON object of id to Positive, Negative, or Neutral") from exc
    all_posts["review_label"] = all_posts.id.map({str(k): str(v).title() for k, v in corrections.items()}).fillna(
        all_posts["review_label"] if "review_label" in all_posts else "")
    matched = select_topic(all_posts, keywords)
    matched = matched[matched.city.isin(chosen)].copy()
    if matched.empty:
        return {"source": source_name, "count": 0, "city_summary": [], "themes": [],
                "theme_shares": {}, "sentiment_mix": {}, "distinctive_terms": {}, "posts": [], "review_posts": [], "message": "No matching posts. Try more search terms or a different CSV."}
    analyzed = analyze(matched)
    analyzed, themes = discover_themes(analyzed, keywords)
    shares = analyzed.groupby(["city", "theme"]).size().div(analyzed.groupby("city").size(), level="city").round(3)
    sentiment_mix = (analyzed.groupby(["city", "sentiment"]).size()
                     .unstack(fill_value=0).reindex(columns=["Negative", "Neutral", "Positive", "Needs review"], fill_value=0))
    sentiment_mix = sentiment_mix.div(sentiment_mix.sum(axis=1), axis=0).round(3)
    columns = ["id", "city", "text", "date", "raw_sentiment", "sentiment", "needs_review", "theme"]
    posts = analyzed[columns].copy()
    posts["date"] = posts.date.dt.strftime("%Y-%m-%d")
    posts = posts.where(posts.notna(), None)
    return {"source": source_name, "count": len(analyzed), "cities": chosen,
            "city_summary": city_summary(analyzed), "themes": themes,
            "sentiment_mix": sentiment_mix.to_dict(orient="index"),
            "theme_shares": {city: {t: float(v) for t, v in values.items()}
                             for city, values in shares.unstack(fill_value=0).to_dict(orient="index").items()},
            "distinctive_terms": distinctive_terms(analyzed, keywords),
            "posts": posts.head(500).to_dict(orient="records"),
            "review_posts": posts[posts.needs_review].head(200).to_dict(orient="records"),
            "posts_truncated": len(posts) > 500,
            "note": "Synthetic data unless a CSV was uploaded. Unreviewed suspected irony is excluded from mean sentiment."}
