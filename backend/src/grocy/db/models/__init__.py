from grocy.db.grocy_references import configure_native_references
from grocy.db.models.base import Base
from grocy.db.models.catalog import (
    Location,
    Product,
    ProductBarcode,
    ProductGroup,
    QuantityUnit,
    ShoppingLocation,
)
from grocy.db.models.equipment import Equipment
from grocy.db.models.household import (
    Battery,
    BatteryChargeCycle,
    Chore,
    ChoreLog,
    Task,
    TaskCategory,
)
from grocy.db.models.mealplan import MealPlanEntry, MealPlanSection
from grocy.db.models.nutrition import (
    NutritionEvidence,
    NutritionProposal,
    NutritionRevision,
    ProductNutrition,
)
from grocy.db.models.recipes import Recipe, RecipeNesting, RecipePosition
from grocy.db.models.settings import (
    UserEntity,
    UserfieldDefinition,
    UserfieldValue,
    UserObject,
    UserSetting,
)
from grocy.db.models.shopping import ShoppingList, ShoppingListItem
from grocy.db.models.stock import StockEntry, StockLog
from grocy.db.models.units import QuantityUnitConversion
from grocy.db.models.users import ApiKey, ImportedApiKey, User, UserPermission
from grocy.db.native_columns import configure_native_columns

configure_native_references(Base.metadata)
configure_native_columns(Base.metadata)

__all__ = [
    "ApiKey",
    "Base",
    "Battery",
    "BatteryChargeCycle",
    "Chore",
    "ChoreLog",
    "Equipment",
    "ImportedApiKey",
    "Location",
    "MealPlanEntry",
    "MealPlanSection",
    "NutritionEvidence",
    "NutritionProposal",
    "NutritionRevision",
    "Product",
    "ProductBarcode",
    "ProductGroup",
    "ProductNutrition",
    "QuantityUnit",
    "QuantityUnitConversion",
    "Recipe",
    "RecipeNesting",
    "RecipePosition",
    "ShoppingList",
    "ShoppingListItem",
    "ShoppingLocation",
    "StockEntry",
    "StockLog",
    "Task",
    "TaskCategory",
    "User",
    "UserEntity",
    "UserObject",
    "UserPermission",
    "UserSetting",
    "UserfieldDefinition",
    "UserfieldValue",
]
