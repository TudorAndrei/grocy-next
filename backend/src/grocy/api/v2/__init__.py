from fastapi import APIRouter

from grocy.api.v2 import (
    access,
    battery_overview,
    calendar,
    chore_overview,
    codes,
    content,
    custom_data,
    files,
    household,
    household_forms,
    localization,
    mcp_http,
    mealplan,
    mealplan_calendar,
    mealplan_sections,
    nutrition,
    products,
    recipe_forms,
    recipes,
    settings,
    setup,
    shopping,
    stock,
    system,
    task_overview,
    users_access,
)

router = APIRouter(prefix="/api/v2")
router.include_router(nutrition.router)
router.include_router(shopping.router)
router.include_router(mcp_http.router)
router.include_router(access.router)
router.include_router(mealplan.router)
router.include_router(mealplan_calendar.router)
router.include_router(mealplan_sections.router)
router.include_router(files.router)
router.include_router(battery_overview.router)
router.include_router(chore_overview.router)
router.include_router(task_overview.router)
router.include_router(users_access.router)
router.include_router(household.router)
router.include_router(household_forms.router)
router.include_router(settings.router)
router.include_router(setup.router)
router.include_router(calendar.router)
router.include_router(codes.router)
router.include_router(content.router)
router.include_router(custom_data.router)
router.include_router(recipe_forms.router)
router.include_router(recipes.router)
router.include_router(localization.router)
router.include_router(products.router)
router.include_router(stock.router)
router.include_router(system.router)
