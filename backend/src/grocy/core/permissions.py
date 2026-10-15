"""Permission IDs from Grocy v4.5.0 migration 0110."""

PERMISSIONS = {
    1: ("ADMIN", None),
    2: ("USERS", 1),
    3: ("USERS_CREATE", 2),
    4: ("USERS_EDIT", 3),
    5: ("USERS_READ", 4),
    6: ("USERS_EDIT_SELF", 1),
    7: ("STOCK", 1),
    8: ("SHOPPINGLIST", 1),
    9: ("RECIPES", 1),
    10: ("CHORES", 1),
    11: ("BATTERIES", 1),
    12: ("TASKS", 1),
    13: ("EQUIPMENT", 1),
    14: ("CALENDAR", 1),
    15: ("STOCK_PURCHASE", 7),
    16: ("STOCK_CONSUME", 7),
    17: ("STOCK_INVENTORY", 7),
    18: ("STOCK_TRANSFER", 7),
    19: ("STOCK_OPEN", 7),
    20: ("STOCK_EDIT", 7),
    21: ("SHOPPINGLIST_ITEMS_ADD", 8),
    22: ("SHOPPINGLIST_ITEMS_DELETE", 8),
    23: ("RECIPES_MEALPLAN", 9),
    24: ("CHORE_TRACK_EXECUTION", 10),
    25: ("CHORE_UNDO_EXECUTION", 10),
    26: ("BATTERIES_TRACK_CHARGE_CYCLE", 11),
    27: ("BATTERIES_UNDO_CHARGE_CYCLE", 11),
    28: ("TASKS_UNDO_EXECUTION", 12),
    29: ("TASKS_MARK_COMPLETED", 12),
    30: ("MASTER_DATA_EDIT", 1),
}


def resolve_permissions(ids: set[int]) -> frozenset[str]:
    resolved = set(ids)
    while True:
        children = {i for i, (_, parent) in PERMISSIONS.items() if parent in resolved}
        if children <= resolved:
            break
        resolved.update(children)
    return frozenset(PERMISSIONS[i][0] for i in resolved if i in PERMISSIONS)
