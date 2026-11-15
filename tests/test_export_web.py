from datetime import date

import polars as pl
import pytest

from nasa_curious_explorers import export_web as ew

K = {"modis": 4.0, "terra": 10.0, "aqua": 6.0, "n20": 1.0}


def sources(rows: list[tuple[date, str]]) -> pl.DataFrame:
    return pl.DataFrame({"date": [d for d, _ in rows], "source": [s for _, s in rows]})


def country_daily(rows: list[dict]) -> pl.DataFrame:
    base = {"country": "A", "n_modis": 0, "n_viirs": 0, "n_n20": 0, "harmonized": 0.0}
    return pl.DataFrame([base | r for r in rows])


def test_region_slug_and_name():
    c = "Democratic_Republic_of_the_Congo"
    assert ew.region_id(c) == "democratic-republic-of-the-congo"
    assert ew.region_name(c) == "Democratic Republic of the Congo"
    assert ew.region_id("Guinea-Bissau") == "guinea-bissau"


def test_baseline_uses_k_world_per_predictor_and_keeps_observed_snpp():
    df = pl.DataFrame({
        "source": ["snpp", "modis", "terra", "aqua", "n20", "none"],
        "n_terra": [5, 5, 5, 5, 5, 5], "n_aqua": [3, 3, 3, 3, 3, 3],
        "n_snpp": [40, 40, 40, 40, 40, 40], "n_n20": [7, 7, 7, 7, 7, 7],
    })  # fmt: skip
    out = df.select(v=ew.baseline_value(K))["v"].to_list()
    assert out[:5] == pytest.approx([40.0, 8 * 4.0, 5 * 10.0, 3 * 6.0, 7 * 1.0])
    assert out[5] is None


def test_monthly_sum_skips_none_days_and_counts_gap_days():
    days = [date(2005, 6, d) for d in (1, 2, 3)] + [date(2005, 7, 1)]
    src = sources([(days[0], "modis"), (days[1], "none"), (days[2], "terra"), (days[3], "none")])
    cd = country_daily([
        {"date": days[0], "n_modis": 10, "harmonized": 40.0},
        {"date": days[1], "n_modis": 2, "harmonized": 999.0},  # must be ignored
        {"date": days[2], "n_modis": 1, "harmonized": 10.0},
    ])  # fmt: skip
    base = pl.DataFrame({"country": ["A", "A"], "date": [days[0], days[2]], "baseline": [44.0, 13.0]})
    daily = ew.daily_by_region(cd, base, src)
    m = ew.monthly_series(daily).filter(region="a").sort("month")
    assert m["gapDays"].to_list() == [1, 1]
    assert m["days"].to_list() == [3, 1]
    assert m["hs"].to_list() == [50.0, None]  # July: only a "none" day -> unknown, not zero
    assert m["base"].to_list() == [57.0, None]
    assert m["modis"].to_list() == [13.0, 0.0]  # raw counts keep every day
    assert m["viirs"].to_list() == [None, None]  # before Suomi-NPP
    world = ew.monthly_series(daily).filter(region="world").sort("month")
    assert world["hs"].to_list() == [50.0, None]


def test_world_is_sum_of_countries_and_missing_days_are_zero():
    d1, d2 = date(2015, 1, 1), date(2015, 1, 2)
    src = sources([(d1, "snpp"), (d2, "snpp")])
    cd = country_daily([
        {"country": "A", "date": d1, "n_viirs": 3, "harmonized": 3.0},
        {"country": "B_C", "date": d1, "n_viirs": 4, "harmonized": 4.0},
        {"country": "B_C", "date": d2, "n_viirs": 1, "harmonized": 1.0},
    ])  # fmt: skip
    base = cd.select("country", "date", baseline="harmonized")
    daily = ew.daily_by_region(cd, base, src)
    assert set(daily["region"]) == {"a", "b-c", "world"}
    assert daily.filter(region="a")["harmonized"].to_list() == [3.0, 0.0]
    assert daily.filter(region="world")["harmonized"].to_list() == [7.0, 1.0]


def test_columnar_arrays_are_aligned():
    days = [date(2024, 1, d) for d in range(1, 11)]
    src = sources([(d, "none" if i == 4 else "snpp") for i, d in enumerate(days)])
    cd = country_daily([{"date": d, "n_viirs": i, "harmonized": float(i)} for i, d in enumerate(days) if i % 3])
    daily = ew.daily_by_region(cd, cd.select("country", "date", baseline="harmonized"), src)
    d = ew.daily_json("a", 2024, daily.filter(region="a"))
    arrays = [d["source"], d["modis"], d["viirs"], *d["harmonized"].values()]
    assert {len(a) for a in arrays} == {10}
    assert d["start"] == "2024-01-01"
    assert d["source"][4] == "none" and d["harmonized"][ew.SHIPPED][4] is None
    assert d["harmonized"][ew.SHIPPED][:3] == [0, 1, 2]

    s = ew.series_json("a", ew.monthly_series(daily).filter(region="a"))
    lengths = {len(s[k]) for k in ("months", "days", "gapDays", "modis", "viirs", "n20")}
    lengths |= {len(v) for v in s["harmonized"].values()} | {len(v) for v in s["sourceDays"].values()}
    assert lengths == {1}
    assert s["sourceDays"]["none"] == [1] and s["sourceDays"]["snpp"] == [9]


def test_cell_normal_counts_missing_years_as_zero():
    cm = pl.DataFrame(
        {"fy": [1, 1, 1], "fx": [2, 2, 2], "year": [2003, 2004, 2005], "month": [8, 8, 8], "hs": [10.0, 20.0, 30.0], "base": [1.0, 2.0, 3.0]},
        schema_overrides={"year": pl.Int16, "month": pl.Int8},
    )
    n = ew.cell_normals(cm, (2003, 2007))  # 5 years: 10, 20, 30, 0, 0 -> median 10
    assert n["normal_hs"].to_list() == [10.0]
    assert n["normal_base"].to_list() == [1.0]


def test_month_json_follows_region_order_and_median_normal():
    monthly = pl.DataFrame({
        "region": ["a"] * 3 + ["world"] * 3,
        "month": [date(2003, 8, 1), date(2004, 8, 1), date(2005, 8, 1)] * 2,
        "hs": [1.0, 3.0, 100.0, 10.0, None, 30.0], "base": [1.0, 3.0, 100.0, 10.0, None, 30.0],
    })  # fmt: skip
    t = ew.month_table(monthly, (2003, 2004)).filter(pl.col("month") == date(2005, 8, 1))
    j = ew.month_json(date(2005, 8, 1), t, ["world", "a", "b"])
    assert j["ym"] == "2005-08" and j["regions"] == ["world", "a", "b"]
    assert j["value"][ew.SHIPPED] == [30, 100, None]
    assert j["normal"][ew.SHIPPED] == [10, 2, None]  # world: null year skipped; a: median(1, 3)


def test_last_complete_month():
    assert ew.last_complete_month(date(2025, 12, 31)) == date(2025, 12, 1)
    assert ew.last_complete_month(date(2025, 12, 30)) == date(2025, 11, 1)
    assert ew.next_month(date(2025, 12, 1)) == date(2026, 1, 1)
