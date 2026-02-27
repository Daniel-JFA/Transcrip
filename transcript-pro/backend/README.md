# Backend (Python / FastAPI)

## Setup

```bash
cd transcript-pro/backend
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
```

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

## Endpoints

- `POST /api/v1/transcriptions` -> creates a transcription job
- `GET /api/v1/transcriptions/{job_id}` -> job status
- `GET /api/v1/transcriptions/{job_id}/result` -> text/SRT when completed
- `WS /api/v1/transcriptions/{job_id}/ws` -> progress stream

## Notes

- Default behavior tries CUDA (`device=cuda`) and falls back to CPU automatically.
- Uploaded files are stored in `storage/uploads`.
