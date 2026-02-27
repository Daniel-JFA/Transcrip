import asyncio
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect, status

from app.core.config import get_settings
from app.schemas.transcription import (
    JobCreatedResponse,
    JobResultResponse,
    JobStatus,
    TranscriptionOptions,
)
from app.services.transcription_service import transcription_service
from app.services.websocket_manager import ws_manager

router = APIRouter()
settings = get_settings()


@router.post("", response_model=JobCreatedResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_transcription_job(
    file: UploadFile = File(...),
    lang: str = Form("es"),
    model: str = Form("medium"),
    device: str = Form("cuda"),
    compute_type: str = Form("float16"),
    beam_size: int = Form(5),
    generate_srt: bool = Form(True),
    diarization: bool = Form(False),
    diarization_speakers: int | None = Form(None),
) -> JobCreatedResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="File name is required")

    job_id = str(uuid4())
    filename = Path(file.filename).name
    target_path = settings.storage_dir / f"{job_id}_{filename}"

    with target_path.open("wb") as buffer:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            buffer.write(chunk)

    options = TranscriptionOptions(
        lang=lang,
        model=model,
        device=device,
        compute_type=compute_type,
        beam_size=beam_size,
        generate_srt=generate_srt,
        diarization=diarization,
        diarization_speakers=diarization_speakers,
    )
    job = transcription_service.create_job(
        job_id=job_id,
        filename=filename,
        source_path=target_path,
        options=options,
    )
    ws_url = f"{settings.api_prefix}/transcriptions/{job.id}/ws"
    return JobCreatedResponse(job=job, ws_url=ws_url)


@router.get("/{job_id}")
async def get_transcription_job(job_id: str):
    job = transcription_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/{job_id}/result", response_model=JobResultResponse)
async def get_transcription_result(job_id: str) -> JobResultResponse:
    job = transcription_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status == JobStatus.FAILED:
        raise HTTPException(status_code=409, detail=job.error or "Job failed")
    if job.status != JobStatus.COMPLETED:
        raise HTTPException(status_code=409, detail="Job is not completed")
    return JobResultResponse(text=job.text or "", srt=job.srt, segments=job.segments)


@router.websocket("/{job_id}/ws")
async def transcription_updates(websocket: WebSocket, job_id: str) -> None:
    await ws_manager.connect(job_id, websocket)
    try:
        job = transcription_service.get_job(job_id)
        if job:
            await websocket.send_json(
                {"type": "job.update", "data": job.model_dump(mode="json")}
            )

        while True:
            await asyncio.sleep(30)
            await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        ws_manager.disconnect(job_id, websocket)
    except Exception:
        ws_manager.disconnect(job_id, websocket)
