from fastapi import APIRouter

from grocy.api.compatibility import (
    calendar,
    files,
    health,
    household,
    objects,
    print as print_api,
    recipes,
    stock,
    system,
    userfields,
    users,
)

router = APIRouter()
router.include_router(health.router)
router.include_router(objects.router)
router.include_router(stock.router)
router.include_router(recipes.router)
router.include_router(household.router)
router.include_router(system.router)
router.include_router(users.router)
router.include_router(userfields.router)
router.include_router(files.router)
router.include_router(calendar.router)
router.include_router(print_api.router)
