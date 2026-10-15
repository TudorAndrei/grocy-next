"""Purchase history used by stock details and calculated catalog records."""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from grocy.db.models.stock import StockLog

ORIGIN_TYPES = {"purchase", "inventory-correction", "self-production"}


@dataclass(frozen=True)
class Purchase:
    log: StockLog
    amount: Decimal


class StockHistory:
    def __init__(self, logs: list[StockLog]) -> None:
        edits: dict[str, StockLog] = {}
        for log in logs:
            if log.transaction_type == "stock-edit-new":
                edits[log.stock_id] = log
        self.purchases = []
        self.shelf_lives = []
        for log in logs:
            if log.undone:
                continue
            origin = log.transaction_type in ORIGIN_TYPES and log.stock_id not in edits
            edit = log.transaction_type == "stock-edit-new"
            if (origin or edit) and log.best_before_date and log.purchased_date:
                self.shelf_lives.append((log.best_before_date - log.purchased_date).days)
            if origin or (edit and edits[log.stock_id].id == log.id):
                consumed = (
                    sum(
                        (
                            -previous.amount
                            for previous in logs
                            if not previous.undone
                            and previous.stock_id == log.stock_id
                            and previous.id < log.id
                            and previous.amount < 0
                            and previous.transaction_type in {"consume", "inventory-correction"}
                        ),
                        Decimal("0"),
                    )
                    if edit
                    else Decimal("0")
                )
                self.purchases.append(Purchase(log, log.amount + consumed))
        self.priced = sorted(
            (
                purchase
                for purchase in self.purchases
                if purchase.log.price is not None
                and purchase.log.price > 0
                and purchase.log.amount > 0
            ),
            key=lambda purchase: (purchase.log.purchased_date or date.min, -purchase.log.id),
            reverse=True,
        )
        self.last = max(
            self.purchases,
            key=lambda purchase: (purchase.log.purchased_date or date.min, purchase.log.id),
            default=None,
        )

    @property
    def last_price(self) -> Decimal | None:
        if self.priced:
            return self.priced[0].log.price
        return Decimal("0") if self.last else None

    @property
    def average_price(self) -> Decimal | None:
        amount = sum((purchase.amount for purchase in self.priced), Decimal("0"))
        if not amount:
            return None
        total = sum(
            (purchase.amount * (purchase.log.price or Decimal("0")) for purchase in self.priced),
            Decimal("0"),
        )
        average = total / amount
        # The pinned SQLite view uses integer division when both sums are integers.
        integral = all(
            purchase.amount == purchase.amount.to_integral_value()
            and purchase.log.price is not None
            and purchase.log.price == purchase.log.price.to_integral_value()
            for purchase in self.priced
        )
        return Decimal(int(average)) if integral else average

    @property
    def average_shelf_life(self) -> float:
        return sum(self.shelf_lives) / len(self.shelf_lives) if self.shelf_lives else -1

    def last_purchased_row(self, product_id: int) -> dict | None:
        if self.last is None:
            return None
        log = self.last.log
        return {
            "id": 1,
            "product_id": product_id,
            "amount": float(log.amount),
            "best_before_date": log.best_before_date.isoformat() if log.best_before_date else None,
            "purchased_date": log.purchased_date.isoformat() if log.purchased_date else None,
            "price": float(self.last_price) if self.last_price is not None else None,
            "location_id": log.location_id,
            "shopping_location_id": log.shopping_location_id,
        }
