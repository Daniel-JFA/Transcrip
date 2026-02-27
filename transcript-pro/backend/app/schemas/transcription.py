from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class TranscriptionOptions(BaseModel):
    lang: str = "es"
    model: str = "medium"
    device: str = "cuda"
    compute_type: str = "float16"
    beam_size: int = Field(default=5, ge=1, le=20)
    generate_srt: bool = True
    diarization: bool = False
    diarization_speakers: int | None = None


class TranscriptionSegment(BaseModel):
    start: float
    end: float
    text: str
    speaker: str | None = None


class TranscriptionJob(BaseModel):
    id: str
    filename: str
    status: JobStatus = JobStatus.QUEUED
    progress: float = 0.0
    message: str = "Queued"
    created_at: datetime
    updated_at: datetime
    text: str | None = None
    srt: str | None = None
    segments: list[TranscriptionSegment] = Field(default_factory=list)
    error: str | None = None


class JobCreatedResponse(BaseModel):
    job: TranscriptionJob
    ws_url: str


class JobResultResponse(BaseModel):
    text: str
    srt: str | None = None
    segments: list[TranscriptionSegment] = Field(default_factory=list)
