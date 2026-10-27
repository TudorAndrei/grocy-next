from fastapi import APIRouter, Depends

from grocy.api.compatibility import (
    calendar,
    files,
    health,
    household,
    objects,
    recipes,
    stock,
    system,
    userfields,
    users,
)
from grocy.api.compatibility import (
    print as print_api,
)
from grocy.core.legacy_http import decode_route_arguments

router = APIRouter(dependencies=[Depends(decode_route_arguments)])
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
