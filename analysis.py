"""Topic-independent, inspectable baselines for city discussions."""
import re

import pandas as pd
from sklearn.decomposition import NMF
from sklearn.feature_extraction.text import TfidfVectorizer
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

CITIES = {
    "Bengaluru": (12.9716, 77.5946), "Mumbai": (19.0760, 72.8777),
    "Delhi": (28.6139, 77.2090), "Chennai": (13.0827, 80.2707),
    "Hyderabad": (17.3850, 78.4867), "Pune": (18.5204, 73.8567),
    "Kolkata": (22.5726, 88.3639), "Ahmedabad": (23.0225, 72.5714),
    "Jaipur": (26.9124, 75.7873), "Kochi": (9.9312, 76.2673),
    "Chandigarh": (30.7333, 76.7794),
}
# A cautious cue detector, not a general sarcasm classifier.
IRONY_CUES = re.compile(
    r"(?:\b(?:great|awesome|fantastic|wonderful|love it|so convenient|brilliant)\b.{0,100}"
    r"\b(?:late|delay|broken|cancelled|outage|stuck|failed|unavailable|overcrowded|expensive|minutes|hours)\b)"
    r"|(?:/s\b|#sarcasm\b)", re.I)
FILLER = {"people", "think", "thoughts", "experience", "curious", "options", "new", "great",
          "love", "need", "local", "today", "city", "anyone", "really", "just", "thing", "things",
          "discussion", "topic", "using", "getting", "better", "minutes", "37", "40", "fantastic",
          "service", "happy", "improved", "lately", "trouble", "keeps", "causing", "regret", "relying",
          "convenient", "surprise", "finally", "worst", "part", "frustrating", "fixing", "noticed",
          "recent", "information", "details", "works", "practice", "comparing", "pleasant", "recommend",
          "well", "awesome", "failed", "brilliant", "timing", "instead", "does", "another", "want",
          "looking", "idea", "however", "fine", "morning", "re", "ve", "isn"}


def load_posts(source):
    df = pd.read_csv(source)
    missing = {"text", "city"} - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(sorted(missing))}")
    df = df.copy()
    if "id" not in df:
        df["id"] = [f"row_{i}" for i in range(len(df))]
    df["id"] = df["id"].astype(str)
    df["city"] = df.city.astype(str).str.strip().str.title()
    df["text"] = df.text.fillna("").astype(str).str.strip()
    df = df[df.city.isin(CITIES) & (df.text.str.len() >= 15)].copy()
    df = df.drop_duplicates(subset=["id"] if "id" in df else ["city", "text"])
    df["date"] = (pd.to_datetime(df.created_utc, unit="s", errors="coerce", utc=True)
                  if "created_utc" in df else pd.NaT)
    return df


def select_topic(df, keywords):
    terms = [s.strip() for s in keywords.split(",") if s.strip()]
    if not terms:
        return df.iloc[0:0].copy()
    pattern = r"(?<!\w)(?:" + "|".join(re.escape(t) for t in terms) + r")(?!\w)"
    return df[df.text.str.contains(pattern, case=False, regex=True)].copy()


def analyze(df):
    df = df.copy()
    scorer = SentimentIntensityAnalyzer()
    df["raw_score"] = df.text.map(lambda text: scorer.polarity_scores(text)["compound"])
    df["raw_sentiment"] = df.raw_score.map(
        lambda s: "Positive" if s >= 0.05 else ("Negative" if s <= -0.05 else "Neutral"))
    df["needs_review"] = df.text.map(lambda text: bool(IRONY_CUES.search(text)))
    if "review_label" not in df:
        df["review_label"] = ""
    df["review_label"] = df.review_label.fillna("").astype(str).str.title()
    valid = df.review_label.isin(["Positive", "Negative", "Neutral"])
    df["sentiment"] = df.raw_sentiment.where(~df.needs_review, "Needs review")
    df.loc[valid, "sentiment"] = df.loc[valid, "review_label"]
    # Unreviewed flagged posts do not contribute to a city's mean sentiment.
    df["sentiment_score"] = df.raw_score.where(~df.needs_review | valid)
    df.loc[valid, "sentiment_score"] = df.loc[valid, "review_label"].map(
        {"Positive": 1.0, "Neutral": 0.0, "Negative": -1.0})
    return df


def discover_themes(df, keywords, count=4):
    df = df.copy()
    df["theme"] = "Unclassified"
    if len(df) < 12:
        return df, []
    # Remove search terms, city names and generic conversational filler before theme extraction.
    terms = [s.strip() for s in keywords.split(",") if s.strip()]
    pattern = re.compile(r"(?<!\w)(?:" + "|".join(re.escape(t) for t in terms) + r")(?!\w)", re.I)
    texts = df.text.map(lambda s: pattern.sub(" ", s))
    stop = list(TfidfVectorizer(stop_words="english").get_stop_words()) + list(FILLER) + [c.lower() for c in CITIES]
    try:
        vectorizer = TfidfVectorizer(stop_words=stop, ngram_range=(1, 2),
                                     min_df=3, max_df=0.85, max_features=2500)
        matrix = vectorizer.fit_transform(texts)
        n = min(count, matrix.shape[0] - 1, matrix.shape[1])
        if n < 2:
            return df, []
        model = NMF(n_components=n, init="nndsvda", random_state=42, max_iter=400)
        weights = model.fit_transform(matrix)
        names = vectorizer.get_feature_names_out()
        labels = [" · ".join(names[i] for i in comp.argsort()[-3:][::-1]) for comp in model.components_]
        df["theme"] = [labels[i] for i in weights.argmax(axis=1)]
        return df, labels
    except ValueError:
        return df, []


def city_summary(df, theme=None):
    rows = []
    for city, group in df.groupby("city"):
        lat, lon = CITIES[city]
        scored = group.sentiment_score.dropna()
        rows.append({"city": city, "lat": lat, "lon": lon, "posts": len(group),
                     "scored_posts": len(scored), "needs_review": int((group.sentiment == "Needs review").sum()),
                     "mean_sentiment": round(float(scored.mean()), 3) if len(scored) else None,
                     "theme_share": round(float((group.theme == theme).mean()), 3) if theme else None})
    return rows


def distinctive_terms(df, keywords, top_n=8):
    docs = df.groupby("city").text.apply(" ".join)
    if docs.empty:
        return {}
    terms_to_remove = [s.strip() for s in keywords.split(",") if s.strip()]
    pattern = re.compile(r"(?<!\w)(?:" + "|".join(re.escape(t) for t in terms_to_remove) + r")(?!\w)", re.I)
    docs = docs.map(lambda s: pattern.sub(" ", s))
    stop = list(TfidfVectorizer(stop_words="english").get_stop_words()) + list(FILLER) + [c.lower() for c in CITIES]
    try:
        vectorizer = TfidfVectorizer(stop_words=stop, ngram_range=(1, 2), max_features=3000)
        matrix = vectorizer.fit_transform(docs)
    except ValueError:
        return {city: [] for city in docs.index}
    names = vectorizer.get_feature_names_out()
    return {city: [names[i] for i in matrix[j].toarray().ravel().argsort()[-top_n:][::-1]]
            for j, city in enumerate(docs.index)}
