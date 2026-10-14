from fastapi import APIRouter

from grocy.api.v2 import mcp_http, nutrition, shopping

router = APIRouter(prefix="/api/v2")
router.include_router(nutrition.router)
router.include_router(shopping.router)
router.include_router(mcp_http.router)
