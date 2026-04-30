---
title: ResponSight Sentiment API
emoji: 🚨
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
pinned: true
license: mit
---

# ResponSight Sentiment Analysis Microservice

Multilingual sentiment analysis for English, Tagalog, and Taglish.

Used by the ResponSight Emergency Response Dashboard (City of Urdaneta, Pangasinan).

## Models
- **Valence**: `cardiffnlp/twitter-xlm-roberta-base-sentiment`
- **Emotion**: `SamLowe/roberta-base-go_emotions`

## API Endpoints
- `GET /health` — service status  
- `POST /analyze` — analyze a single text  
- `POST /analyze/batch` — analyze up to 50 texts
