from datetime import date, timedelta

import polars as pl
import pytest

from nasa_curious_explorers import harmonize as h


def cells(rows: list[dict]) -> pl.LazyFrame:
    """Cell-day rows with zero as the default count for every satellite."""
    base = {"country": "A", "iy": 0, "ix": 0, "n_terra": 0, "n_aqua": 0, "n_snpp": 0, "n_n20": 0}
    schema = {"country": pl.String, "iy": pl.Int16, "ix": pl.Int16, "date": pl.Date} | dict.fromkeys(h.SAT_COLS.values(), pl.UInt32)
    return pl.DataFrame([base | r for r in rows], schema=schema).lazy()


def all_ok(lf: pl.LazyFrame) -> pl.DataFrame:
    dates = lf.select("date").unique().collect()
    return dates.with_columns(ok_terra=True, ok_aqua=True, ok_snpp=True, ok_n20=True)


def test_factor_is_the_ratio_when_data_is_plentiful():
    lf = cells([{"date": date(2015, 6, 1), "n_terra": 20_000, "n_aqua": 30_000, "n_snpp": 150_000}])
    f = h.fit_factors(lf, all_ok(lf), "modis", (2013, 2019))
    assert f["k"][0] == pytest.approx(3.0, rel=1e-6)


def test_sparse_cell_is_pulled_toward_its_country():
    # Cell (0,0) holds almost all the data, ratio 4. Cell (10,10) has 10 MODIS hotspots and
    # a raw ratio of 1: with alpha=100 it must land much closer to 4 than to 1.
    lf = cells([
        {"date": date(2015, 6, 1), "n_aqua": 100_000, "n_snpp": 400_000},
        {"date": date(2015, 6, 1), "iy": 10, "ix": 10, "n_aqua": 10, "n_snpp": 10},
    ])  # fmt: skip
    f = h.fit_factors(lf, all_ok(lf), "modis", (2013, 2019), alpha=100)
    sparse = f.filter(pl.col("fy") == 5)["k"][0]
    assert 3.5 < sparse < 4.0


def test_factor_is_capped_relative_to_parent():
    # Cell (10,10): VIIRS sees 1e6 hotspots, MODIS none. Uncapped k would be ~10,000.
    lf = cells([
        {"date": date(2015, 6, 1), "n_aqua": 100_000, "n_snpp": 400_000},
        {"date": date(2015, 6, 1), "iy": 10, "ix": 10, "n_snpp": 1_000_000},
    ])  # fmt: skip
    f = h.fit_factors(lf, all_ok(lf), "modis", (2013, 2019))
    row = f.filter(pl.col("fy") == 5)
    assert row["k"][0] == pytest.approx(row["k_country_month"][0] * h.K_CAP)


def test_unseen_cell_falls_back_to_country_then_world():
    train = cells([{"date": date(2015, 6, 1), "n_aqua": 100_000, "n_snpp": 400_000}])
    f = h.fit_factors(train, all_ok(train), "modis", (2013, 2019))
    new = cells([
        {"date": date(2005, 6, 1), "iy": 40, "ix": 40, "n_aqua": 10},  # same country, other cell
        {"date": date(2005, 1, 1), "iy": 40, "ix": 40, "n_aqua": 10},  # same country, other month
        {"date": date(2005, 6, 1), "country": "B", "n_aqua": 10},  # unknown country
    ])  # fmt: skip
    pred = h.predict(new, f, "modis").collect()["pred"]
    assert pred.to_list() == pytest.approx([40.0, 40.0, 40.0], rel=1e-3)


def test_outage_days_are_flagged_and_excluded():
    days = [date(2015, 1, 1) + timedelta(days=i) for i in range(60)]
    rows = [{"date": d, "n_terra": 50, "n_aqua": 50, "n_snpp": 0 if 30 <= i < 35 else 400, "n_n20": 400} for i, d in enumerate(days)]
    lf = cells(rows)
    status = h.satellite_status(lf)
    assert status.filter(~pl.col("ok_snpp"))["date"].to_list() == days[30:35]
    # The 5 outage days would drag the ratio below 4 if they were kept.
    f = h.fit_factors(lf, status, "modis", (2013, 2019), alpha=0)
    assert f["k"][0] == pytest.approx(4.0)


def test_source_priority():
    status = pl.DataFrame({
        "date": [date(2005, 1, 1), date(2001, 1, 1), date(2015, 1, 1), date(2022, 8, 1), date(2022, 8, 2), date(2001, 6, 20)],
        "ok_terra": [True, True, True, True, True, False],
        "ok_aqua": [True, False, True, True, True, False],
        "ok_snpp": [False, False, True, False, False, False],
        "ok_n20": [False, False, True, True, False, False],
    })  # fmt: skip
    assert status.select(s=h.source_expr())["s"].to_list() == ["modis", "terra", "snpp", "n20", "modis", "none"]


def test_harmonized_uses_viirs_when_available_and_converted_modis_before():
    lf = cells([
        {"date": date(2015, 6, 1), "n_aqua": 100, "n_snpp": 400},
        {"date": date(2005, 6, 1), "n_aqua": 50},
    ])  # fmt: skip
    status = pl.DataFrame({
        "date": [date(2015, 6, 1), date(2005, 6, 1)],
        "ok_terra": [True, True], "ok_aqua": [True, True], "ok_snpp": [True, False], "ok_n20": [False, False],
    })  # fmt: skip
    f = h.fit_factors(lf, status, "modis", (2013, 2019), alpha=0)
    out = h.harmonized_cells(lf, status, f).sort("date").collect()
    assert out["source"].to_list() == ["modis", "snpp"]
    assert out["harmonized"].to_list() == pytest.approx([200.0, 400.0])
