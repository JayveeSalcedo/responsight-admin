"""
ResponSight Sentiment Analysis Microservice
============================================
Multilingual-aware — handles English, Tagalog, and Taglish natively.

Models:
  Valence  : cardiffnlp/twitter-xlm-roberta-base-sentiment
             → Trained on 198M multilingual tweets incl. Filipino/Taglish
             → Outputs: Negative / Neutral / Positive
  Emotion  : SamLowe/roberta-base-go_emotions
             → 28 fine-grained emotions, better on code-switched text
             → We map down to our 7-emotion system

Language detection:
  Simple heuristic using known Tagalog function words — no extra model needed.
  Labels each text as "english" | "tagalog" | "taglish"

Start:
  pip install -r requirements.txt
  python main.py
  # or: uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

import os
import time
import logging
import re
from contextlib import asynccontextmanager
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from transformers import pipeline

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")
log = logging.getLogger("responsight.sentiment")

# ── Model handles ──────────────────────────────────────────────────────────────
_emotion_clf   = None   # go_emotions: 28-class
_sentiment_clf = None   # xlm-roberta: multilingual valence

# ── go_emotions → our 7-emotion mapping ───────────────────────────────────────
# go_emotions has 28 labels; we collapse them into our 7 + neutral
GO_EMOTION_MAP: dict[str, str] = {
    # joy cluster
    "joy":          "joy",
    "amusement":    "joy",
    "excitement":   "joy",
    "gratitude":    "joy",
    "pride":        "joy",
    "optimism":     "joy",
    "love":         "joy",
    "caring":       "joy",
    "admiration":   "joy",
    "relief":       "joy",
    # sadness cluster
    "sadness":      "sadness",
    "grief":        "sadness",
    "disappointment": "sadness",
    "remorse":      "sadness",
    # anger cluster
    "anger":        "anger",
    "annoyance":    "anger",
    "disapproval":  "anger",
    # fear cluster
    "fear":         "fear",
    "nervousness":  "fear",
    # disgust cluster
    "disgust":      "disgust",
    # surprise cluster
    "surprise":     "surprise",
    "confusion":    "surprise",
    "realization":  "surprise",
    # neutral / other
    "neutral":      "neutral",
    "curiosity":    "neutral",
    "approval":     "positive",   # maps to positive valence hint
    "desire":       "neutral",
    "embarrassment": "neutral",
}

# XLM-RoBERTa outputs these label names
XLM_LABEL_MAP = {
    "negative": "negative",
    "neutral":  "neutral",
    "positive": "positive",
    # some versions use these casing variants
    "Negative": "negative",
    "Neutral":  "neutral",
    "Positive": "positive",
    "NEGATIVE": "negative",
    "NEUTRAL":  "neutral",
    "POSITIVE": "positive",
    # cardiffnlp uses label_0/1/2 in some checkpoints
    "LABEL_0":  "negative",
    "LABEL_1":  "neutral",
    "LABEL_2":  "positive",
}

# ── Language detection heuristic ──────────────────────────────────────────────
# High-frequency Tagalog function words and common content words.
# If ≥2 of these appear → Tagalog component is present.
TAGALOG_MARKERS = {
    # function words
    "ang", "ng", "sa", "na", "ay", "at", "mga", "ko", "mo", "namin", "nila",
    "siya", "sila", "kami", "kayo", "ito", "iyon", "dito", "doon", "hindi",
    "huwag", "wala", "walang", "mayroon", "may", "pero", "kasi", "dahil",
    "kung", "kapag", "para", "lang", "din", "rin", "naman", "po", "opo",
    "ba", "nga", "eh", "yung", "yun", "daw", "raw", "pa", "pala",
    # common content words likely in feedback
    "magaling", "mabilis", "matagal", "masama", "maganda", "pangit",
    "mabuti", "ayos", "galing", "husay", "salamat", "natuwa", "galit",
    "masaya", "malungkot", "takot", "nakakainis", "nakatulong", "hindi",
    "sobrang", "napaka", "talaga", "grabe", "kadiri", "bastos",
    "kawawa", "masakit", "mahal", "mura", "bilis", "tagal",
    "responde", "dumating", "pumunta", "nagpadala", "nagsimula",
}

ENGLISH_MARKERS = {
    "the", "a", "an", "is", "was", "were", "are", "been", "have", "has",
    "this", "that", "they", "their", "with", "for", "not", "very", "so",
    "but", "and", "or", "it", "its", "he", "she", "we", "you", "i",
}

def detect_language(text: str) -> str:
    """
    Returns 'english' | 'tagalog' | 'taglish'
    Simple token-overlap heuristic — no extra model needed.
    """
    tokens = set(re.sub(r"[^\w\s]", " ", text.lower()).split())
    tl_hits = len(tokens & TAGALOG_MARKERS)
    en_hits = len(tokens & ENGLISH_MARKERS)

    if tl_hits == 0:
        return "english"
    if en_hits == 0:
        return "tagalog"
    return "taglish"


# ── Startup / shutdown ─────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _emotion_clf, _sentiment_clf

    log.info("Loading valence model (cardiffnlp/twitter-xlm-roberta-base-sentiment) — multilingual…")
    t0 = time.time()
    _sentiment_clf = pipeline(
        "text-classification",
        model="cardiffnlp/twitter-xlm-roberta-base-sentiment",
        truncation=True,
        max_length=512,
    )
    log.info(f"Valence model ready in {time.time()-t0:.1f}s")

    log.info("Loading emotion model (SamLowe/roberta-base-go_emotions)…")
    t1 = time.time()
    _emotion_clf = pipeline(
        "text-classification",
        model="SamLowe/roberta-base-go_emotions",
        top_k=None,
        truncation=True,
        max_length=512,
    )
    log.info(f"Emotion model ready in {time.time()-t1:.1f}s")
    log.info("✅ Both models loaded — multilingual service ready")
    yield
    log.info("Shutting down sentiment service")


app = FastAPI(title="ResponSight Sentiment API", version="2.0.0", lifespan=lifespan)

_allowed_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
_extra = os.environ.get("ALLOWED_ORIGIN", "")
if _extra:
    _allowed_origins.append(_extra)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── Request / response models ──────────────────────────────────────────────────
class AnalyzeRequest(BaseModel):
    text:   str           = Field(..., min_length=1, max_length=2048)
    rating: Optional[int] = Field(None, ge=1, le=5)

class BatchAnalyzeRequest(BaseModel):
    items: list[AnalyzeRequest] = Field(..., max_length=50)

class EmotionScore(BaseModel):
    label: str
    score: float

class AnalyzeResult(BaseModel):
    emotion:        str
    emotion_score:  float
    all_emotions:   list[EmotionScore]
    valence:        str    # "positive" | "negative" | "neutral"
    valence_score:  float
    label:          str
    confidence:     float
    rating_used:    bool
    language:       str    # "english" | "tagalog" | "taglish"

class BatchAnalyzeResult(BaseModel):
    results:    list[AnalyzeResult]
    latency_ms: float


# ── Core analysis ──────────────────────────────────────────────────────────────
def _analyze_one(text: str, rating: Optional[int]) -> AnalyzeResult:
    """
    1. Detect language (heuristic)
    2. Run go_emotions for fine-grained emotion (collapse to 7)
    3. Run XLM-RoBERTa for multilingual valence (Neg/Neu/Pos)
    4. Blend with star rating for final label
    """
    language = detect_language(text)

    # ── Emotion classifier (go_emotions) ──────────────────────────────────
    raw_emotions: list[dict] = _emotion_clf(text)[0]
    raw_emotions = [{"label": e["label"].lower(), "score": round(e["score"], 4)} for e in raw_emotions]

    # Collapse 28 → 7 by taking max score within each cluster
    collapsed: dict[str, float] = {}
    for e in raw_emotions:
        mapped = GO_EMOTION_MAP.get(e["label"], "neutral")
        collapsed[mapped] = max(collapsed.get(mapped, 0.0), e["score"])

    # Sort collapsed emotions for the frontend radar
    sorted_emotions = sorted(collapsed.items(), key=lambda x: x[1], reverse=True)
    all_emotions    = [EmotionScore(label=k, score=round(v, 4)) for k, v in sorted_emotions]

    top_emotion       = sorted_emotions[0][0] if sorted_emotions else "neutral"
    top_emotion_score = sorted_emotions[0][1] if sorted_emotions else 0.0

    # ── Valence classifier (XLM-RoBERTa, multilingual) ───────────────────
    val_raw      = _sentiment_clf(text)[0]
    valence_label = XLM_LABEL_MAP.get(val_raw["label"], "neutral")
    valence_score = round(val_raw["score"], 4)

    # ── Star rating push ───────────────────────────────────────────────────
    rating_used = rating is not None
    star_push   = (rating - 3) * 0.15 if rating is not None else 0.0

    # ── Final label decision ───────────────────────────────────────────────
    # For Tagalog/Taglish, the valence model is more reliable than the
    # emotion model, so we raise the emotion threshold slightly.
    emotion_threshold = 0.60 if language == "english" else 0.70

    if top_emotion_score >= emotion_threshold and top_emotion not in ("neutral", "positive"):
        final_label = top_emotion
        confidence  = round(top_emotion_score, 4)

    elif valence_score >= 0.75:
        adj = valence_score + star_push
        if valence_label == "positive":
            final_label = "joy" if adj >= 0.90 else "positive"
        elif valence_label == "negative":
            # Use emotion hint if strong enough
            if top_emotion in ("anger", "sadness", "fear", "disgust") and top_emotion_score >= 0.35:
                final_label = top_emotion
            else:
                final_label = "negative"
        else:
            final_label = "neutral"
        confidence = round(min(0.95, adj), 4)

    elif rating is not None:
        if rating >= 4:
            final_label = "positive"
            confidence  = round(0.55 + star_push, 4)
        elif rating <= 2:
            final_label = top_emotion if top_emotion in ("anger", "sadness", "fear", "disgust") else "negative"
            confidence  = round(0.55 + abs(star_push), 4)
        else:
            final_label = "neutral"
            confidence  = 0.50
    else:
        final_label = valence_label if valence_score >= 0.55 else "neutral"
        confidence  = round(max(0.45, valence_score * 0.9), 4)

    return AnalyzeResult(
        emotion       = top_emotion,
        emotion_score = top_emotion_score,
        all_emotions  = all_emotions,
        valence       = valence_label,
        valence_score = valence_score,
        label         = final_label,
        confidence    = confidence,
        rating_used   = rating_used,
        language      = language,
    )


# ── Routes ─────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status": "ok",
        "models": {
            "valence": _sentiment_clf is not None,
            "emotion": _emotion_clf   is not None,
        },
        "multilingual": True,
        "languages":    ["english", "tagalog", "taglish"],
    }


@app.post("/analyze", response_model=AnalyzeResult)
def analyze(req: AnalyzeRequest):
    if not _emotion_clf or not _sentiment_clf:
        raise HTTPException(503, "Models not loaded yet")
    text = req.text.strip()
    if not text:
        raise HTTPException(422, "text must not be empty")
    return _analyze_one(text, req.rating)


@app.post("/analyze/batch", response_model=BatchAnalyzeResult)
def analyze_batch(req: BatchAnalyzeRequest):
    if not _emotion_clf or not _sentiment_clf:
        raise HTTPException(503, "Models not loaded yet")
    t0 = time.time()
    results = []
    for item in req.items:
        text = item.text.strip()
        if text:
            results.append(_analyze_one(text, item.rating))
        else:
            results.append(AnalyzeResult(
                emotion="neutral", emotion_score=0.0, all_emotions=[],
                valence="neutral", valence_score=0.0,
                label="neutral", confidence=0.5,
                rating_used=False, language="english",
            ))
    return BatchAnalyzeResult(results=results, latency_ms=round((time.time()-t0)*1000, 1))


if __name__ == "__main__":
    # HF Spaces expects port 7860; locally we use 8000
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
