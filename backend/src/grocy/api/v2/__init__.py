from fastapi import APIRouter

from grocy.api.v2 import (
    access,
    calendar,
    content,
    files,
    localization,
    mcp_http,
    mealplan,
    nutrition,
    recipes,
    settings,
    setup,
    shopping,
)

router = APIRouter(prefix="/api/v2")
router.include_router(nutrition.router)
router.include_router(shopping.router)
router.include_router(mcp_http.router)
router.include_router(access.router)
router.include_router(mealplan.router)
router.include_router(files.router)
router.include_router(settings.router)
router.include_router(setup.router)
router.include_router(calendar.router)
router.include_router(content.router)
router.include_router(recipes.router)
router.include_router(localization.router)
