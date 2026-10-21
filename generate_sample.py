"""Generate diverse fictional city discussions; never represent them as Reddit data."""
import csv
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

from analysis import CITIES

OUT = Path(__file__).parent / "data" / "synthetic_city_posts.csv"
TOPICS = {
    "Electric vehicles": {
        "tokens": ["EV", "electric car", "electric vehicle"],
        "aspects": {
            "charging": ["apartment charging points", "broken public chargers", "overnight charging access"],
            "battery": ["battery range on highways", "battery replacement costs", "range in summer heat"],
            "price": ["upfront price and EMI", "insurance premiums", "total running costs"],
            "policy": ["registration tax waiver", "changing subsidy rules", "parking incentives"],
            "weather": ["rainwater on flooded roads", "monsoon driving safety", "waterlogged underpasses"],
        },
    },
    "Metro": {
        "tokens": ["metro"],
        "aspects": {
            "delays": ["late trains at peak hour", "service delays after 8 pm", "construction delays"],
            "fare": ["ticket fare increases", "monthly pass pricing", "student fare discounts"],
            "crowds": ["overcrowded coaches", "platform queues", "rush hour boarding"],
            "access": ["last-mile bus connections", "station lift accessibility", "walking access to stations"],
            "reliability": ["frequency between trains", "missed connections", "weekend timetable changes"],
        },
    },
    "Work from home": {
        "tokens": ["WFH", "work from home"],
        "aspects": {
            "internet": ["internet outages during calls", "backup broadband costs", "video call stability"],
            "productivity": ["deep work without interruptions", "meeting overload", "focus during shared hours"],
            "policy": ["hybrid attendance rules", "manager approval process", "return-to-office policy"],
            "commute": ["saved commute time", "traffic avoided", "transport spending"],
            "space": ["desk setup in a small flat", "quiet workspace", "home office equipment"],
        },
    },
}
FRAMES = {
    "Positive": ["{topic}: {issue} has improved lately and I am happy with it in {city}.",
                 "I recommend {topic} here because {issue} works well for me.",
                 "A pleasant surprise with {topic} in {city}: {issue} is finally convenient."],
    "Negative": ["{topic} in {city} is frustrating because of {issue}; this needs fixing.",
                 "I regret relying on {topic} when {issue} keeps causing trouble.",
                 "The worst part of {topic} for me is {issue}. It is unreliable."],
    "Neutral": ["Does anyone in {city} have recent information about {topic} and {issue}?",
                "Comparing {topic} options; how does {issue} work in practice?",
                "I noticed a discussion of {issue} for {topic} in {city}; looking for details."],
    "Sarcastic": ["Great, {topic} has another delay related to {issue}. Fantastic in {city}.",
                  "Love it when {topic} has another outage during {issue}. So convenient in {city}.",
                  "Awesome, {topic} failed again because of {issue}. Brilliant timing in {city}."],
}

def main():
    rng = random.Random(42)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    with OUT.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["id", "city", "text", "created_utc", "score", "demo_label", "demo_aspect"])
        writer.writeheader()
        for city in CITIES:
            for topic_name, spec in TOPICS.items():
                aspects = list(spec["aspects"])
                # Each city has a distinct but non-exclusive aspect mix, for a useful chart demo.
                favored = aspects[list(CITIES).index(city) % len(aspects)]
                for i in range(70):
                    aspect = rng.choices(aspects, [5 if a == favored else 2 for a in aspects])[0]
                    issue = rng.choice(spec["aspects"][aspect])
                    sentiment_profiles = [[5, 2, 2, 1], [2, 5, 2, 1], [2, 3, 2, 3], [3, 3, 3, 1]]
                    profile = sentiment_profiles[list(CITIES).index(city) % len(sentiment_profiles)]
                    sentiment = rng.choices(list(FRAMES), profile)[0]
                    token = rng.choice(spec["tokens"])
                    text = rng.choice(FRAMES[sentiment]).format(topic=token, issue=issue, city=city)
                    if topic_name == "Metro" and sentiment == "Sarcastic" and i % 5 == 0:
                        text = f"Great, the metro is late by only 37 minutes today instead of 40! Fantastic in {city}."
                    writer.writerow({"id": f"demo_{city}_{topic_name}_{i}", "city": city,
                        "text": text, "created_utc": int((start + timedelta(days=rng.randrange(270))).timestamp()),
                        "score": rng.randrange(0, 80), "demo_label": sentiment, "demo_aspect": aspect})
    print(f"Wrote {OUT}")

if __name__ == "__main__":
    main()
