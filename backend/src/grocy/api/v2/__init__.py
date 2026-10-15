from fastapi import APIRouter

from grocy.api.v2 import access, files, mcp_http, mealplan, nutrition, shopping

router = APIRouter(prefix="/api/v2")
router.include_router(nutrition.router)
router.include_router(shopping.router)
router.include_router(mcp_http.router)
router.include_router(access.router)
router.include_router(mealplan.router)
router.include_router(files.router)
