import pytest
from sqlalchemy import text

from grocy.compatibility.php import php_date
from grocy.core.config import get_settings
from grocy.db.session import get_session_factory


@pytest.fixture
def calendar_data(client, api_headers):
    def create(table, **values):
        response = client.post(f"/api/objects/{table}", headers=api_headers, json=values)
        response.raise_for_status()
        return int(response.json()["created_object_id"])

    stock = create("quantity_units", name="Calendar Zulu unit", name_plural="Calendar Zulu units")
    hidden_unit = create("quantity_units", name="Calendar alpha unit", active=0)
    product = create(
        "products",
        name="Calendar Zulu ingredient",
        location_id=1,
        qu_id_stock=stock,
        qu_id_purchase=stock,
    )
    inactive = create(
        "products",
        name="Calendar alpha inactive",
        location_id=1,
        qu_id_stock=hidden_unit,
        qu_id_purchase=hidden_unit,
        active=0,
    )
    create(
        "quantity_unit_conversions",
        product_id=product,
        from_qu_id=stock,
        to_qu_id=hidden_unit,
        factor=0.5,
    )
    client.post(
        f"/api/stock/products/{product}/add",
        headers=api_headers,
        json={"amount": 5, "price": 2, "best_before_date": "2099-01-01"},
    ).raise_for_status()
    first = create("recipes", name="Calendar Zulu meal")
    second = create("recipes", name="Calendar alpha meal")
    create("recipes_pos", recipe_id=first, product_id=product, amount=2, qu_id=stock)
    section = create("meal_plan_sections", name="Calendar second", sort_number=2, time_info="08:30")
    earlier_section = create("meal_plan_sections", name="Calendar first", sort_number=1)
    unused_section = create("meal_plan_sections", name="Calendar unused", sort_number=3)
    center = create(
        "meal_plan",
        day="2021-01-01",
        type="product",
        product_id=product,
        product_amount=1.5,
        product_qu_id=stock,
        section_id=earlier_section,
        note="<b>Raw note</b>",
        done=1,
    )
    right = create(
        "meal_plan",
        day="2021-01-03",
        type="note",
        note="In range",
        section_id=section,
    )
    left = create(
        "meal_plan",
        day="2020-12-30",
        recipe_id=first,
        recipe_servings=2,
        section_id=section,
        note="",
        row_created_timestamp=None,
    )
    outside_left = create(
        "meal_plan",
        day="2020-12-29",
        type="note",
        note="Outside",
        section_id=unused_section,
    )
    outside_right = create(
        "meal_plan",
        day="2021-01-04",
        recipe_id=second,
        section_id=unused_section,
    )
    orphan = create("recipes", name="2021-01-02", type="mealplan-day")

    async def retain_saved_state():
        async with get_session_factory()() as session:
            rows = (
                (
                    await session.execute(
                        text("SELECT id,name,type FROM recipes WHERE type<>'normal'")
                    )
                )
                .mappings()
                .all()
            )
            internal = {(row["type"], row["name"]): row["id"] for row in rows}
            week = internal[("mealplan-week", "2021-00")]
            missing = internal[("mealplan-day", "2021-01-03")]
            # The page reads persisted internal recipes; it must not repair a missing day.
            await session.execute(text("DELETE FROM recipes WHERE id=:id"), {"id": missing})
            await session.execute(
                text("UPDATE recipes SET desired_servings=2 WHERE id=:id"), {"id": week}
            )
            await session.execute(
                text(
                    "UPDATE cache__quantity_unit_conversions_resolved SET factor='9.125' "
                    "WHERE product_id=:product AND from_qu_id=:stock AND to_qu_id=:unit"
                ),
                {"product": product, "stock": stock, "unit": hidden_unit},
            )
            await session.commit()
            return internal, week, missing

    assert client.portal is not None
    internal, week, missing = client.portal.call(retain_saved_state)
    return {
        "client": client,
        "product": product,
        "inactive": inactive,
        "stock": stock,
        "hidden_unit": hidden_unit,
        "first": first,
        "second": second,
        "section": section,
        "earlier_section": earlier_section,
        "unused_section": unused_section,
        "center": center,
        "right": right,
        "left": left,
        "outside_left": outside_left,
        "outside_right": outside_right,
        "orphan": orphan,
        "internal": internal,
        "week": week,
        "missing": missing,
    }


def test_mealplan_calendar_reads_native_range_persisted_internal_recipes_and_references(
    calendar_data, api_headers
):
    data = calendar_data
    client = data["client"]
    response = client.get("/api/v2/meal-plan/calendar?start=2021-01-01&days=2", headers=api_headers)
    response.raise_for_status()
    view = response.json()
    assert view["start"] == "2021-01-01"
    assert view["days"] == "2"
    assert [event["id"] for event in view["events"]] == [
        data["center"],
        data["right"],
        data["left"],
    ]
    center, note, recipe = view["events"]
    assert center["start"] == "2021-01-01"
    assert center["type"] == "product"
    assert center["title"] == "" and center["recipe"] is None
    assert center["entry"]["note"] == "<b>Raw note</b>"
    assert center["entry"]["done"] == 1
    details = center["product_details"]
    assert details["product"]["id"] == data["product"]
    assert details["stock_amount"] == 5
    assert details["last_price"] == 2
    assert details["quantity_unit_stock"]["id"] == data["stock"]
    assert note["product_details"] is None
    assert note["entry"]["note"] == "In range"
    assert recipe["title"] == "Calendar Zulu meal"
    assert recipe["recipe"]["id"] == data["first"]
    assert recipe["entry"]["recipe_servings"] == 2
    assert recipe["entry"]["note"] is None
    assert recipe["entry"]["row_created_timestamp"] is None
    expected_internal = {
        data["internal"][(kind, name)]
        for kind, name in [
            ("mealplan-day", "2020-12-30"),
            ("mealplan-day", "2021-01-01"),
            ("mealplan-week", "2020-52"),
            ("mealplan-week", "2021-00"),
            ("mealplan-shadow", f"2020-12-30#{data['left']}"),
        ]
    }
    assert {row["id"] for row in view["internal_recipes"]} == expected_internal
    assert {row["recipe_id"] for row in view["recipes_resolved"]} == expected_internal
    assert view["week_recipe"]["id"] == data["week"]
    assert view["week_recipe"]["name"] == "2021-00"
    assert view["week_recipe"]["desired_servings"] == 2
    week_summary = next(row for row in view["recipes_resolved"] if row["recipe_id"] == data["week"])
    assert week_summary["costs"] == 6
    assert [
        row["id"] for row in view["recipes"] if row["id"] in {data["first"], data["second"]}
    ] == [
        data["first"],
        data["second"],
    ]
    assert all(row["type"] == "normal" for row in view["recipes"])
    assert [
        row["id"] for row in view["products"] if row["id"] in {data["product"], data["inactive"]}
    ] == [
        data["inactive"],
        data["product"],
    ]
    assert [
        row["id"] for row in view["units"] if row["id"] in {data["stock"], data["hidden_unit"]}
    ] == [
        data["hidden_unit"],
        data["stock"],
    ]
    assert any(row["id"] == -1 for row in view["sections"])
    assert [row["id"] for row in view["used_sections"]] == [
        data["earlier_section"],
        data["section"],
    ]
    saved = next(
        row
        for row in view["conversions"]
        if row["product_id"] == data["product"]
        and row["from_qu_id"] == data["stock"]
        and row["to_qu_id"] == data["hidden_unit"]
    )
    assert saved["factor"] == "9.125"
    assert (
        client.get(f"/api/objects/recipes/{data['missing']}", headers=api_headers).status_code
        == 404
    )


def test_mealplan_calendar_projects_safe_note_html_without_rewriting_stored_text(
    calendar_data, api_headers
):
    data = calendar_data
    client = data["client"]
    raw = (
        '<strong>Bring snacks</strong>\nSecond line<script>alert("active")</script>'
        '<img src="photo.jpg" onerror="alert(1)">'
    )

    async def import_note():
        async with get_session_factory()() as session:
            await session.execute(
                text("UPDATE meal_plan SET note=:note WHERE id=:id"),
                {"note": raw, "id": data["right"]},
            )
            await session.commit()

    assert client.portal is not None
    client.portal.call(import_note)
    response = client.get("/api/v2/meal-plan/calendar?start=2021-01-01&days=2", headers=api_headers)
    response.raise_for_status()
    events = response.json()["events"]
    note = next(event for event in events if event["id"] == data["right"])
    assert note["entry"]["note"] == raw
    assert "<strong>Bring snacks</strong>" in note["note_html"]
    assert "\nSecond line" in note["note_html"]
    assert "<br" not in note["note_html"]
    assert "<script" not in note["note_html"]
    assert "onerror" not in note["note_html"]
    assert all(isinstance(event["note_html"], str) for event in events)
    assert next(event for event in events if event["id"] == data["left"])["note_html"] == ""
    assert (
        client.get(f"/api/objects/meal_plan/{data['right']}", headers=api_headers).json()["note"]
        == raw
    )


def test_mealplan_calendar_keeps_raw_days_validation_and_independent_week_selection(
    calendar_data, api_headers
):
    data = calendar_data
    client = data["client"]
    for raw, expected_days, expected_events in [
        ("0", "0", [data["center"]]),
        ("+2", "+2", []),
        ("-2", "-2", []),
        (" 2 ", " 2 ", []),
        (
            "02",
            6,
            [data[key] for key in ["center", "right", "left", "outside_left", "outside_right"]],
        ),
        (
            "2e0",
            6,
            [data[key] for key in ["center", "right", "left", "outside_left", "outside_right"]],
        ),
        (
            "0); DROP TABLE meal_plan;--",
            6,
            [data[key] for key in ["center", "right", "left", "outside_left", "outside_right"]],
        ),
    ]:
        response = client.get(
            "/api/v2/meal-plan/calendar",
            headers=api_headers,
            params={"start": "2021-01-01", "days": raw},
        )
        response.raise_for_status()
        view = response.json()
        assert view["days"] == expected_days
        assert [event["id"] for event in view["events"]] == expected_events
        assert view["week_recipe"]["id"] == data["week"]
        if not expected_events:
            assert [row["id"] for row in view["internal_recipes"]] == [data["week"]]
    before = php_date()[:10]
    for parameters in [{}, {"start": "2021-02-30"}, {"start": "2021-01-01');--"}]:
        response = client.get("/api/v2/meal-plan/calendar", headers=api_headers, params=parameters)
        response.raise_for_status()
        assert response.json()["start"] in {before, php_date()[:10]}
        assert response.json()["days"] == 6


def test_mealplan_calendar_presentation_allows_authenticated_reader_without_mealplan_write_grant(
    calendar_data, api_headers, monkeypatch
):
    data = calendar_data
    client = data["client"]
    path = "/api/v2/meal-plan/calendar?start=2021-01-01&days=0"
    assert client.get(path).status_code == 401
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users", headers=api_headers, json={"username": "Calendar reader", "password": ""}
    ).raise_for_status()
    identity = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Calendar reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": identity}).json()[
        "api_key"
    ]
    headers = {"GROCY-API-KEY": key}
    response = client.get(path, headers=headers)
    response.raise_for_status()
    assert response.json()["events"][0]["product_details"]["stock_amount"] == 5
    assert (
        client.put(
            f"/api/objects/meal_plan/{data['center']}", headers=headers, json={"done": 0}
        ).status_code
        == 403
    )
    assert client.get(path, headers=headers).json()["events"][0]["entry"]["done"] == 1
