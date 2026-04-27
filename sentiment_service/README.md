# ResponSight Sentiment Service

A FastAPI microservice that runs the two HuggingFace models used for
sentiment analysis on citizen feedback in the admin panel.

## Models
- **Emotion:** `j-hartmann/emotion-english-distilroberta-base` — 7 emotions (anger, disgust, fear, joy, neutral, sadness, surprise)
- **Valence:** `distilbert-base-uncased-finetuned-sst-2-english` — positive / negative

## Setup

```bash
cd sentiment_service

# Create a virtual environment (recommended)
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Mac/Linux

# Install dependencies
pip install -r requirements.txt

# Start the service
python main.py
```

The service starts on **http://localhost:8000**.  
Models are downloaded on first run (~500MB) and cached locally — subsequent starts are fast.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/health` | Check if models are loaded |
| POST | `/analyze` | Analyze a single feedback text |
| POST | `/analyze/batch` | Analyze up to 50 texts at once |

### POST /analyze
```json
{
  "text": "The response was very fast and professional!",
  "rating": 5
}
```

Response:
```json
{
  "emotion": "joy",
  "emotion_score": 0.8821,
  "all_emotions": [
    { "label": "joy",      "score": 0.8821 },
    { "label": "neutral",  "score": 0.0541 },
    ...
  ],
  "valence": "positive",
  "valence_score": 0.9987,
  "label": "joy",
  "confidence": 0.95,
  "rating_used": true
}
```

## Integration with Next.js admin

The Next.js app calls this service through the `/api/analyze-sentiment` proxy route.
Make sure the service is running before opening the feedback page.

Set `SENTIMENT_API_URL=http://localhost:8000` in `.env.local` (already added).
