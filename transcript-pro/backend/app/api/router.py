from fastapi import APIRouter

from app.api.routes.transcriptions import router as transcriptions_router

api_router = APIRouter()
api_router.include_router(transcriptions_router, prefix="/transcriptions", tags=["transcriptions"])
