# transcript-pro

Monorepo scaffold for:

- `backend/`: Python FastAPI + WebSocket progress for transcription jobs.
- `frontend/`: Angular app with `core/features/shared` architecture.

## Run Backend

```bash
cd transcript-pro/backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Run Frontend

```bash
cd transcript-pro/frontend
npm install
npm start
```

Frontend URL: `http://localhost:4200`
Backend URL: `http://localhost:8000`
