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

"""

# ══════════════════════════════════════════════════════════════════════════════
# IMPORTS
# ══════════════════════════════════════════════════════════════════════════════
import os
import time
import logging
import re
from contextlib import asynccontextmanager  # For async startup/shutdown lifecycle
from typing import Optional

import uvicorn  # ASGI server
from fastapi import FastAPI, HTTPException  # Web framework
from fastapi.middleware.cors import CORSMiddleware  # Cross-origin requests
from pydantic import BaseModel, Field  # Data validation & serialization
from transformers import pipeline  # Hugging Face models

# ──────────────────────────────────────────────────────────────────────────────
# LOGGING SETUP
# ──────────────────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")
log = logging.getLogger("responsight.sentiment")

# ──────────────────────────────────────────────────────────────────────────────
# MODEL HANDLES (loaded on startup)
# ──────────────────────────────────────────────────────────────────────────────
# These hold the neural network models; initialized as None and populated
# in the lifespan() function when the app starts.
_emotion_clf   = None   # go_emotions: 28-emotion fine-grained classifier
_sentiment_clf = None   # XLM-RoBERTa: multilingual valence (pos/neg/neutral)

# ──────────────────────────────────────────────────────────────────────────────
# EMOTION MAPPING: go_emotions (28 classes) → ResponSight (7 core emotions)
# ──────────────────────────────────────────────────────────────────────────────
# The go_emotions model outputs 28 different emotions (e.g., amusement, grief, 
# nervousness). We group them into 7 core emotions for simpler frontend radar charts.
# Emotions in same cluster get their max score so multiple classifier outputs
# map correctly (e.g., "amusement" and "excitement" both → "joy").
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

# ──────────────────────────────────────────────────────────────────────────────
# VALENCE MAPPING: Normalize XLM-RoBERTa model label variations
# ──────────────────────────────────────────────────────────────────────────────
# Different checkpoint versions output labels in different formats (case variants,
# LABEL_0/1/2, etc.). This map normalizes them all to lowercase: negative/neutral/positive.
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

# ──────────────────────────────────────────────────────────────────────────────
# LANGUAGE DETECTION: Tagalog marker words
# ──────────────────────────────────────────────────────────────────────────────
# Simple token-based heuristic to detect Tagalog/Taglish without an extra model.
# Includes function words ("ang", "ng", "sa") and common content words used in
# feedback contexts ("maganda", "salamat", "galit", etc.).
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

# ──────────────────────────────────────────────────────────────────────────────
# LANGUAGE DETECTION: English marker words
# ──────────────────────────────────────────────────────────────────────────────
ENGLISH_MARKERS = {
    "the", "a", "an", "is", "was", "were", "are", "been", "have", "has",
    "this", "that", "they", "their", "with", "for", "not", "very", "so",
    "but", "and", "or", "it", "its", "he", "she", "we", "you", "i",
}

def detect_language(text: str) -> str:
    """
    Simple heuristic language detector — no extra neural model needed.
    
    Logic:
      1. Tokenize text (remove punctuation, lowercase)
      2. Count hits against TAGALOG_MARKERS and ENGLISH_MARKERS
      3. Return 'english' (only English words found)
             | 'tagalog' (only Tagalog words found)
             | 'taglish' (mix of both — code-switched text)
    
    This helps the final decision logic: Tagalog/Taglish text relies more on
    valence than emotion, so we adjust confidence thresholds accordingly.
    """
    # Remove punctuation and split into lowercase tokens
    tokens = set(re.sub(r"[^\w\s]", " ", text.lower()).split())
    
    # Count how many Tagalog and English markers appear in text
    tl_hits = len(tokens & TAGALOG_MARKERS)
    en_hits = len(tokens & ENGLISH_MARKERS)

    # Pure English: no Tagalog words found
    if tl_hits == 0:
        return "english"
    # Pure Tagalog: no English words found
    if en_hits == 0:
        return "tagalog"
    # Code-switched: both languages present
    return "taglish"


# ──────────────────────────────────────────────────────────────────────────────
# STARTUP & SHUTDOWN LIFECYCLE
# ──────────────────────────────────────────────────────────────────────────────
# FastAPI calls this on startup (before "yield") and shutdown (after "yield").
# We load both neural models into memory here — this happens once at service start.
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _emotion_clf, _sentiment_clf

    # ────────────────────────────────────────────────────────────────────────────
    # STARTUP: Load the two transformer models (happens when service starts)
    # ────────────────────────────────────────────────────────────────────────────
    
    # MODEL 1: Valence (sentiment polarity) — trained on 198M multilingual tweets
    # Detects: positive / neutral / negative (works for English, Tagalog, Taglish)
    log.info("Loading valence model (cardiffnlp/twitter-xlm-roberta-base-sentiment) — multilingual…")
    t0 = time.time()
    _sentiment_clf = pipeline(
        "text-classification",
        model="cardiffnlp/twitter-xlm-roberta-base-sentiment",
        truncation=True,
        max_length=512,  # Truncate input to 512 tokens (model limit)
    )
    log.info(f"Valence model ready in {time.time()-t0:.1f}s")

    # MODEL 2: Emotion (fine-grained) — 28 emotions on code-switched text
    # Detects: joy, anger, sadness, fear, disgust, surprise, neutral, etc.
    log.info("Loading emotion model (SamLowe/roberta-base-go_emotions)…")
    t1 = time.time()
    _emotion_clf = pipeline(
        "text-classification",
        model="SamLowe/roberta-base-go_emotions",
        top_k=None,  # Return scores for all 28 emotions
        truncation=True,
        max_length=512,
    )
    log.info(f"Emotion model ready in {time.time()-t1:.1f}s")
    log.info("✅ Both models loaded — multilingual service ready")
    
    # "yield" means: service is now live, ready to handle requests
    yield
    
    # ────────────────────────────────────────────────────────────────────────────
    # SHUTDOWN: Cleanup (when service stops)
    # ────────────────────────────────────────────────────────────────────────────
    log.info("Shutting down sentiment service")


# ──────────────────────────────────────────────────────────────────────────────
# CREATE FASTAPI APP & CONFIGURE CORS
# ──────────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="ResponSight Sentiment API",
    version="2.0.0",
    lifespan=lifespan,  # Attach startup/shutdown lifecycle
)

# Allow frontend to make cross-origin (CORS) requests to this API
# Default: localhost frontend. Can add env var for production domain.
_allowed_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
_extra = os.environ.get("ALLOWED_ORIGIN", "")  # e.g., from Render/production
if _extra:
    _allowed_origins.append(_extra)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,  # Which domains can call this API
    allow_methods=["GET", "POST"],  # Allow health check (GET) and analyze (POST)
    allow_headers=["*"],  # Accept any request headers
)

# ──────────────────────────────────────────────────────────────────────────────
# REQUEST / RESPONSE MODELS (Pydantic — for validation & JSON serialization)
# ──────────────────────────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    """Frontend sends this to /analyze endpoint."""
    text:   str           = Field(..., min_length=1, max_length=2048)  # The feedback text
    rating: Optional[int] = Field(None, ge=1, le=5)  # Optional 1-5 star rating

class BatchAnalyzeRequest(BaseModel):
    """Frontend sends this to /analyze/batch endpoint (up to 50 items)."""
    items: list[AnalyzeRequest] = Field(..., max_length=50)

class EmotionScore(BaseModel):
    """One emotion with its score in the 7-emotion breakdown."""
    label: str    # e.g., "joy", "anger", "sadness"
    score: float  # 0.0 to 1.0 confidence

class AnalyzeResult(BaseModel):
    """API response for single /analyze call. Contains all sentiment insights."""
    # Emotion-level (fine-grained, 7 core emotions):
    emotion:        str  # Top emotion, e.g., "joy", "anger"
    emotion_score:  float  # Confidence in top emotion (0.0-1.0)
    all_emotions:   list[EmotionScore]  # All 7 emotions ranked by score
    
    # Valence-level (sentiment polarity):
    valence:        str  # "positive" | "negative" | "neutral"
    valence_score:  float  # Confidence in valence (0.0-1.0)
    
    # Final decision (what we recommend to use):
    label:          str  # Final emotion/sentiment label to display
    confidence:     float  # How confident in final label (0.0-1.0)
    
    # Metadata:
    rating_used:    bool  # Was the star rating used in final decision?
    language:       str  # "english" | "tagalog" | "taglish"

class BatchAnalyzeResult(BaseModel):
    """API response for /analyze/batch call."""
    results:    list[AnalyzeResult]  # Array of results, one per input item
    latency_ms: float  # How long the batch took to process


# ══════════════════════════════════════════════════════════════════════════════
# CORE ANALYSIS FUNCTION (the heart of the sentiment service)
# ══════════════════════════════════════════════════════════════════════════════
def _analyze_one(text: str, rating: Optional[int]) -> AnalyzeResult:
    """
    Analyze a single piece of text and return comprehensive sentiment insights.
    
    Pipeline:
      1. Detect language (English/Tagalog/Taglish via heuristic)
      2. Run emotion classifier (go_emotions: 28 → 7 emotions)
      3. Run valence classifier (XLM-RoBERTa: positive/negative/neutral)
      4. Blend results + star rating to produce final label
    
    Args:
        text (str): The feedback/review text to analyze (1-2048 chars)
        rating (int or None): Optional 1-5 star rating from user
    
    Returns:
        AnalyzeResult: Comprehensive sentiment breakdown with confidence scores
    """
    # ────────────────────────────────────────────────────────────────────────────
    # STEP 1: Detect text language
    # ────────────────────────────────────────────────────────────────────────────
    language = detect_language(text)

    # ────────────────────────────────────────────────────────────────────────────
    # STEP 2: Emotion Classification (fine-grained, 28 → 7 emotions)
    # ────────────────────────────────────────────────────────────────────────────
    # The go_emotions model outputs 28 emotion classes with scores.
    # We get the raw output: [{ "label": "amusement", "score": 0.95 }, ...]
    raw_emotions: list[dict] = _emotion_clf(text)[0]  # Get top-k=None output
    raw_emotions = [{"label": e["label"].lower(), "score": round(e["score"], 4)} for e in raw_emotions]

    # Collapse 28 emotions → 7 core emotions using GO_EMOTION_MAP
    # For each of the 7 clusters, we take the max score among all emotions mapping to it.
    # Example: "amusement" (0.92) + "excitement" (0.85) both map to "joy" → "joy": 0.92
    collapsed: dict[str, float] = {}
    for e in raw_emotions:
        mapped = GO_EMOTION_MAP.get(e["label"], "neutral")  # Map 28 → 7
        collapsed[mapped] = max(collapsed.get(mapped, 0.0), e["score"])  # Keep max

    # Sort collapsed emotions by score (descending) for frontend radar/charts
    sorted_emotions = sorted(collapsed.items(), key=lambda x: x[1], reverse=True)
    all_emotions    = [EmotionScore(label=k, score=round(v, 4)) for k, v in sorted_emotions]

    # Extract the top (highest-scoring) emotion
    top_emotion       = sorted_emotions[0][0] if sorted_emotions else "neutral"
    top_emotion_score = sorted_emotions[0][1] if sorted_emotions else 0.0

    # ────────────────────────────────────────────────────────────────────────────
    # STEP 3: Valence Classification (multilingual sentiment polarity)
    # ────────────────────────────────────────────────────────────────────────────
    # The XLM-RoBERTa model outputs sentiment polarity: positive/negative/neutral.
    # Trained on 198M multilingual tweets (handles code-switched text well).
    val_raw      = _sentiment_clf(text)[0]  # Get top result
    valence_label = XLM_LABEL_MAP.get(val_raw["label"], "neutral")  # Normalize label
    valence_score = round(val_raw["score"], 4)  # 0.0-1.0 confidence

    # ────────────────────────────────────────────────────────────────────────────
    # STEP 4a: Calculate "star rating push" (modulate decision with user rating)
    # ────────────────────────────────────────────────────────────────────────────
    # A 5-star rating nudges decisions toward positive (+0.30)
    # A 1-star rating nudges decisions toward negative (-0.30)
    # A 3-star (middle) rating has no push (neutral, 0.0)
    # This helps disambiguate borderline cases.
    rating_used = rating is not None
    star_push   = (rating - 3) * 0.15 if rating is not None else 0.0  # -0.30 to +0.30

    # ────────────────────────────────────────────────────────────────────────────
    # STEP 4b: Final Label Decision (blend emotion + valence into one label)
    # ────────────────────────────────────────────────────────────────────────────
    # Decision tree with language-specific thresholds:
    #   • English: trust emotion model more (lower threshold: 0.60)
    #   • Tagalog/Taglish: trust valence model more (higher threshold: 0.70)
    # This is because valence models trained on multilingual Twitter data are more
    # robust to code-switching, while fine-grained emotion detection is trickier.
    emotion_threshold = 0.60 if language == "english" else 0.70

    # ────────────────────────────────────────────────────────────────────────────
    # DECISION BRANCH 1: Strong emotion signal (high-confidence emotion detected)
    # ────────────────────────────────────────────────────────────────────────────
    # If top emotion is above threshold and it's a strong sentiment (not neutral/positive),
    # use the emotion as the final label. Examples: "anger", "sadness", "fear", "disgust".
    if top_emotion_score >= emotion_threshold and top_emotion not in ("neutral", "positive"):
        final_label = top_emotion
        confidence  = round(top_emotion_score, 4)

    # ────────────────────────────────────────────────────────────────────────────
    # DECISION BRANCH 2: Strong valence signal (high-confidence sentiment)
    # ────────────────────────────────────────────────────────────────────────────
    # If valence model is confident (≥0.75), trust it and use fine-grained emotion as hint.
    elif valence_score >= 0.75:
        adj = valence_score + star_push  # Adjust with rating
        
        if valence_label == "positive":
            # Positive valence: check if strong enough to call it "joy" (vs generic "positive")
            final_label = "joy" if adj >= 0.90 else "positive"
        
        elif valence_label == "negative":
            # Negative valence: see if emotion model suggests a specific negative emotion
            # (anger/sadness/fear/disgust). If so, use it for finer-grained feedback.
            if top_emotion in ("anger", "sadness", "fear", "disgust") and top_emotion_score >= 0.35:
                final_label = top_emotion  # Use emotion hint
            else:
                final_label = "negative"  # Generic negative
        
        else:  # valence_label == "neutral"
            final_label = "neutral"
        
        confidence = round(min(0.95, adj), 4)  # Cap at 0.95

    # ────────────────────────────────────────────────────────────────────────────
    # DECISION BRANCH 3: Fallback — models are uncertain, use star rating if available
    # ────────────────────────────────────────────────────────────────────────────
    # Neither emotion nor valence reached high confidence.
    # If user provided a rating, use that as tiebreaker.
    elif rating is not None:
        if rating >= 4:
            # 4-5 stars → positive
            final_label = "positive"
            confidence  = round(0.55 + star_push, 4)
        elif rating <= 2:
            # 1-2 stars → negative (specific emotion if available, else generic "negative")
            final_label = top_emotion if top_emotion in ("anger", "sadness", "fear", "disgust") else "negative"
            confidence  = round(0.55 + abs(star_push), 4)
        else:
            # 3 stars (middle) → neutral
            final_label = "neutral"
            confidence  = 0.50
    
    # ────────────────────────────────────────────────────────────────────────────
    # DECISION BRANCH 4: Last resort — no rating provided, rely on valence
    # ────────────────────────────────────────────────────────────────────────────
    # If valence is weak but above minimal threshold (0.55), use it. Otherwise, neutral.
    else:
        final_label = valence_label if valence_score >= 0.55 else "neutral"
        confidence  = round(max(0.45, valence_score * 0.9), 4)  # Floor at 0.45

    # Return the complete analysis result with all signals and the final recommendation
    return AnalyzeResult(
        emotion       = top_emotion,  # Single strongest emotion
        emotion_score = top_emotion_score,  # Its confidence
        all_emotions  = all_emotions,  # All 7 emotions (for radar chart)
        valence       = valence_label,  # Polarity: pos/neg/neutral
        valence_score = valence_score,  # Its confidence
        label         = final_label,  # FINAL RECOMMENDATION (what to display)
        confidence    = confidence,  # How confident in final label
        rating_used   = rating_used,  # Did we use the star rating in decision?
        language      = language,  # What language was detected
    )


# ══════════════════════════════════════════════════════════════════════════════
# API ROUTES (Endpoints exposed to frontend)
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/health")
def health():
    """Health check endpoint — verify service is up and models are loaded."""
    return {
        "status": "ok",
        "models": {
            "valence": _sentiment_clf is not None,  # XLM-RoBERTa ready?
            "emotion": _emotion_clf   is not None,  # go_emotions ready?
        },
        "multilingual": True,
        "languages":    ["english", "tagalog", "taglish"],  # Supported languages
    }


@app.post("/analyze", response_model=AnalyzeResult)
def analyze(req: AnalyzeRequest):
    """
    Main endpoint: Analyze a single piece of feedback text.
    
    Request JSON: { "text": "...", "rating": 5 }
    Response JSON: Full AnalyzeResult with emotion, valence, language, confidence.
    """
    # Safety check: models must be loaded before we can analyze
    if not _emotion_clf or not _sentiment_clf:
        raise HTTPException(503, "Models not loaded yet")
    
    # Validate text: strip whitespace and check it's not empty
    text = req.text.strip()
    if not text:
        raise HTTPException(422, "text must not be empty")
    
    # Perform full sentiment analysis
    return _analyze_one(text, req.rating)


@app.post("/analyze/batch", response_model=BatchAnalyzeResult)
def analyze_batch(req: BatchAnalyzeRequest):
    """
    Batch endpoint: Analyze up to 50 feedback items in one request.
    More efficient than calling /analyze 50 times.
    
    Request JSON: { "items": [{ "text": "...", "rating": 5 }, ...] }
    Response JSON: List of AnalyzeResults + total latency_ms.
    """
    # Safety check
    if not _emotion_clf or not _sentiment_clf:
        raise HTTPException(503, "Models not loaded yet")
    
    # Time the entire batch processing
    t0 = time.time()
    results = []
    
    for item in req.items:
        text = item.text.strip()
        if text:
            # Analyze this item
            results.append(_analyze_one(text, item.rating))
        else:
            # Handle empty text: return neutral placeholder
            results.append(AnalyzeResult(
                emotion="neutral", emotion_score=0.0, all_emotions=[],
                valence="neutral", valence_score=0.0,
                label="neutral", confidence=0.5,
                rating_used=False, language="english",
            ))
    
    # Return results + total processing time
    return BatchAnalyzeResult(
        results=results,
        latency_ms=round((time.time()-t0)*1000, 1),  # Convert seconds to milliseconds
    )


# ══════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    # Start the ASGI server (uvicorn)
    # Port: Read from PORT env var (Render, HF Spaces) or default to 8000 (localhost)
    port = int(os.environ.get("PORT", 8000))
    
    # Run the FastAPI app on all network interfaces (0.0.0.0)
    # reload=False because we're in production; change to True for local development
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
