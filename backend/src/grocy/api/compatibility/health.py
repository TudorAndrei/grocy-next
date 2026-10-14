from fastapi import APIRouter
from pydantic import BaseModel

from grocy import __version__

router = APIRouter(tags=["system"])


class HealthResponse(BaseModel):
    status: str
    version: str
    service: str


@router.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", version=__version__, service="grocy-next")
