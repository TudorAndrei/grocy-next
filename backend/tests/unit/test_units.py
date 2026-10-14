from decimal import Decimal

import pytest

from grocy.db.models.catalog import QuantityUnit
from grocy.db.models.units import QuantityUnitConversion
from grocy.domains.units.service import UnitsService


@pytest.mark.asyncio
async def test_conversion_factor_and_inverse(session) -> None:
    gram = QuantityUnit(name="g", name_plural="g")
    kg = QuantityUnit(name="kg", name_plural="kg")
    session.add_all([gram, kg])
    await session.flush()
    session.add(
        QuantityUnitConversion(
            from_qu_id=kg.id,
            to_qu_id=gram.id,
            factor=Decimal("1000"),
        )
    )
    await session.commit()

    service = UnitsService(session)
    assert await service.convert(Decimal("1.5"), kg.id, gram.id) == Decimal("1500")
    assert await service.convert(Decimal("500"), gram.id, kg.id) == Decimal("0.5")
