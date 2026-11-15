"""Export the harmonized product as the static JSON files the website reads.

    uv run export-web            # data/product/ -> frontend/public/data/

The shape of every file is specified in docs/web-data-contract.md. In short:

    manifest.json                 methods, scores, regions (world + one per country)
    series/{region}.json          monthly values for the whole record
    daily/{region}/{year}.json    daily values, one file per year
    months/{YYYY-MM}.json         every region for one month, with its seasonal normal
    cells/{YYYY-MM}.json          1-degree map layer for one month, with its seasonal normal
    cells/land.json               every 0.5-degree cell that ever burned, with its country
    status.json                   satellite outages
    uncertainty.json              error bands and anomaly agreement, from validation.json

Two methods are exported side by side, each under its key "<id>@<version>":

    hierarchical-shrinkage@1.0   the shipped method (the `harmonized` columns of the product)
    single-world-ratio@1.0       baseline: the same daily source, but converted with one
                                 world-wide factor per predictor (k_world)

Arrays are columnar (one array per field) and counts are rounded to integers so that the
browser downloads as little as possible. `null` means "no satellite delivered", never zero.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import UTC, date, datetime
from pathlib import Path

import polars as pl

from nasa_curious_explorers.harmonize import (
    ALPHA,
    CALIBRATION,
    FACTOR_CELLS,
    K_CAP,
    PREDICTORS,
    PRODUCT_DIR,
    TARGET,
    VIIRS_START,
    scan_cells,
    source_expr,
)

WEB_DIR = Path("frontend/public/data")

NORMAL_YEARS = (2003, 2022)  # seasonal normal = median of these years
SHIPPED = "hierarchical-shrinkage@1.0"
BASELINE = "single-world-ratio@1.0"
METHODS = [SHIPPED, BASELINE]
SOURCES = ["snpp", "n20", "modis", "terra", "aqua", "none"]
SATELLITES = {"terra": "ok_terra", "aqua": "ok_aqua", "snpp": "ok_snpp", "n20": "ok_n20"}
WORLD = {"id": "world", "name": "World", "kind": "world", "bbox": [-180, -60, 180, 75]}
LAND_DEG = 0.5
MAP_DEG = 1  # = FACTOR_CELLS land cells


# --------------------------------------------------------------------------- helpers


def region_id(country: str) -> str:
    """"Democratic_Republic_of_the_Congo" -> "democratic-republic-of-the-congo"."""
    return country.lower().replace("_", "-")


def region_name(country: str) -> str:
    return country.replace("_", " ")


def dump(path: Path, obj: dict) -> int:
    """Write compact JSON; return the number of bytes written."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, separators=(",", ":"), allow_nan=False)
    path.write_text(text)
    return len(text)


def as_int(values: pl.Series) -> list:
    """Round to integers, keeping nulls."""
    return values.round(0).cast(pl.Int64).to_list()


def num(x: float) -> int | float:
    """100.0 -> 100, 4.3881 -> 4.388."""
    return int(x) if float(x).is_integer() else round(x, 3)


def ym(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def day_sources(status: pl.DataFrame) -> pl.DataFrame:
    """One row per calendar day: the best source that day (same rule as the product)."""
    return status.select("date", source=source_expr()).sort("date")


def baseline_value(k_world: dict[str, float]) -> pl.Expr:
    """single-world-ratio: observed Suomi-NPP on snpp days, else predictor x k_world.

    Needs columns `source` and the per-satellite counts n_terra / n_aqua / n_snpp / n_n20.
    Days with source "none" give null.
    """
    expr = pl.when(pl.col("source") == "snpp").then(pl.col(TARGET).cast(pl.Float64))
    for p, count in PREDICTORS.items():
        expr = expr.when(pl.col("source") == p).then(count.cast(pl.Float64) * k_world[p])
    return expr


def next_month(d: date) -> date:
    return date(d.year + d.month // 12, d.month % 12 + 1, 1)


def last_complete_month(last_day: date) -> date:
    """First day of the last month fully covered by data ending on `last_day`."""
    first = last_day.replace(day=1)
    if date.fromordinal(last_day.toordinal() + 1).month != last_day.month:
        return first
    return date.fromordinal(first.toordinal() - 1).replace(day=1)


# --------------------------------------------------------------------------- daily / monthly


def daily_by_region(
    country_daily: pl.DataFrame, baseline_daily: pl.DataFrame, sources: pl.DataFrame
) -> pl.DataFrame:
    """Dense table: one row per region (countries + "world") and calendar day.

    country_daily: country, date, n_modis, n_viirs, n_n20, harmonized (shipped method)
    baseline_daily: country, date, baseline
    sources: date, source (calendar of the export)
    Days without any hotspot in a country count as 0, except on "none" days where the
    harmonized values are null.
    """
    countries = country_daily.select("country").unique()
    data = country_daily.select("country", "date", "n_modis", "n_viirs", "n_n20", "harmonized").join(
        baseline_daily.select("country", "date", "baseline"), on=["country", "date"], how="full", coalesce=True
    )
    grid = countries.join(sources, how="cross").join(data, on=["country", "date"], how="left")
    counts = ["n_modis", "n_viirs", "n_n20", "harmonized", "baseline"]
    grid = grid.with_columns(pl.col(c).cast(pl.Float64).fill_null(0) for c in counts)
    world = grid.group_by("date", "source").agg(pl.col(c).sum() for c in counts).with_columns(country=pl.lit(None, pl.String))
    out = pl.concat([grid, world.select(grid.columns)])
    gap = pl.col("source") == "none"
    return out.with_columns(
        region=pl.when(pl.col("country").is_null()).then(pl.lit("world")).otherwise(
            pl.col("country").str.to_lowercase().str.replace_all("_", "-")
        ),
        harmonized=pl.when(~gap).then("harmonized"),
        baseline=pl.when(~gap).then("baseline"),
    ).sort("region", "date")


def monthly_series(daily: pl.DataFrame) -> pl.DataFrame:
    """Monthly sums per region. Harmonized sums skip "none" days, counted in gapDays."""
    known_days = (pl.col("source") != "none").sum()

    def harm(col: str) -> pl.Expr:
        return pl.when(known_days > 0).then(pl.col(col).sum())

    m = (
        daily.with_columns(month=pl.col("date").dt.truncate("1mo"))
        .group_by("region", "month")
        .agg(
            days=pl.len(),
            gapDays=(pl.col("source") == "none").sum(),
            modis=pl.col("n_modis").sum(),
            viirs=pl.col("n_viirs").sum(),
            n20=pl.col("n_n20").sum(),
            hs=harm("harmonized"),
            base=harm("baseline"),
            **{f"src_{s}": (pl.col("source") == s).sum() for s in SOURCES},
        )
        .sort("region", "month")
    )
    # Raw counts of a satellite not yet in service are "no data", not zero.
    world_n20 = m.filter((pl.col("region") == "world") & (pl.col("n20") > 0))
    n20_start = world_n20["month"].min() if world_n20.height else date(9999, 1, 1)
    return m.with_columns(
        viirs=pl.when(pl.col("month") >= VIIRS_START.replace(day=1)).then("viirs"),
        n20=pl.when(pl.col("month") >= n20_start).then("n20"),
    )


def series_json(region: str, m: pl.DataFrame) -> dict:
    return {
        "region": region,
        "months": [ym(d) for d in m["month"]],
        "days": m["days"].to_list(),
        "gapDays": m["gapDays"].to_list(),
        "modis": as_int(m["modis"]),
        "viirs": as_int(m["viirs"]),
        "n20": as_int(m["n20"]),
        "harmonized": {SHIPPED: as_int(m["hs"]), BASELINE: as_int(m["base"])},
        "sourceDays": {s: m[f"src_{s}"].to_list() for s in SOURCES},
    }


def daily_json(region: str, year: int, d: pl.DataFrame) -> dict:
    viirs = d.select(pl.when(pl.col("date") >= VIIRS_START).then("n_viirs"))["n_viirs"]
    return {
        "region": region,
        "year": year,
        "start": d["date"][0].isoformat(),
        "source": d["source"].to_list(),
        "modis": as_int(d["n_modis"]),
        "viirs": as_int(viirs),
        "harmonized": {SHIPPED: as_int(d["harmonized"]), BASELINE: as_int(d["baseline"])},
    }


def month_table(monthly: pl.DataFrame, years: tuple[int, int]) -> pl.DataFrame:
    """Monthly values per region plus the median of the same calendar month over `years`."""
    cal = pl.col("month").dt.month().alias("cal")
    normal = (
        monthly.filter(pl.col("month").dt.year().is_between(*years))
        .group_by("region", cal)
        .agg(normal_hs=pl.col("hs").median(), normal_base=pl.col("base").median())
    )
    return monthly.with_columns(cal).join(normal, on=["region", "cal"], how="left")


def month_json(month: date, m: pl.DataFrame, region_ids: list[str]) -> dict:
    """Every region for one month, in manifest order (null where a region has no row)."""
    m = pl.DataFrame({"region": region_ids}).join(m, on="region", how="left", maintain_order="left")
    return {
        "ym": ym(month),
        "regions": region_ids,
        "value": {SHIPPED: as_int(m["hs"]), BASELINE: as_int(m["base"])},
        "normal": {SHIPPED: as_int(m["normal_hs"]), BASELINE: as_int(m["normal_base"])},
    }


# --------------------------------------------------------------------------- map cells


def cell_normals(cm: pl.DataFrame, years: tuple[int, int]) -> pl.DataFrame:
    """Median of each (fy, fx, month) over `years`, a missing year counting as 0.

    cm: fy, fx, year, month, hs, base (one row per cell-month with data).
    """
    yrs = pl.DataFrame({"year": list(range(years[0], years[1] + 1))}, schema={"year": pl.Int16})
    inside = cm.filter(pl.col("year").is_between(*years))
    keys = inside.select("fy", "fx", "month").unique()
    full = keys.join(yrs, how="cross").join(inside, on=["fy", "fx", "month", "year"], how="left")
    return full.group_by("fy", "fx", "month").agg(
        normal_hs=pl.col("hs").fill_null(0).median(), normal_base=pl.col("base").fill_null(0).median()
    )


def cells_json(month: date, rows: pl.DataFrame) -> dict:
    rows = rows.sort("fy", "fx")
    return {
        "ym": ym(month),
        "deg": MAP_DEG,
        "lat": (rows["fy"].cast(pl.Float64) * MAP_DEG + MAP_DEG / 2).to_list(),
        "lon": (rows["fx"].cast(pl.Float64) * MAP_DEG + MAP_DEG / 2).to_list(),
        "harmonized": {SHIPPED: as_int(rows["hs"].fill_null(0)), BASELINE: as_int(rows["base"].fill_null(0))},
        "normal": {SHIPPED: as_int(rows["normal_hs"].fill_null(0)), BASELINE: as_int(rows["normal_base"].fill_null(0))},
    }


# --------------------------------------------------------------------------- status


def outages(status: pl.DataFrame) -> list[dict]:
    """Runs of consecutive not-ok days of each satellite, between its first and last ok day."""
    out = []
    for sat, flag in SATELLITES.items():
        s = status.select("date", ok=pl.col(flag)).sort("date")
        if sat == "snpp":
            s = s.filter(pl.col("date") >= VIIRS_START)
        ok_days = s.filter("ok")["date"]
        if ok_days.is_empty():
            continue
        s = s.filter(pl.col("date").is_between(ok_days.min(), ok_days.max()))
        runs = (
            s.with_columns(run=pl.col("ok").rle_id())
            .filter(~pl.col("ok"))
            .group_by("run")
            .agg(start=pl.col("date").min(), end=pl.col("date").max())
            .sort("start")
        )
        out += [{"satellite": sat, "from": a.isoformat(), "to": b.isoformat()} for a, b in runs.select("start", "end").iter_rows()]
    return sorted(out, key=lambda o: (o["from"], o["satellite"]))


# --------------------------------------------------------------------------- manifest


def scores(levels: dict | None) -> dict | None:
    if not levels:
        return None
    return {
        "world": levels["world_month"]["median_abs_error_pct"],
        "country": levels["country_month"]["median_abs_error_pct"],
        "cell": levels["cell_month"]["median_abs_error_pct"],
    }


def methods(validation: dict, k_world: dict[str, float]) -> list[dict]:
    return [
        {
            "key": SHIPPED,
            "id": "hierarchical-shrinkage",
            "version": "1.0",
            "name": "Hierarchical shrinkage",
            "status": "shipped",
            "summary": "Factor per world → country → month → 1° cell, shrunk toward its parent.",
            "params": {"alpha": num(ALPHA), "cap": num(K_CAP), "calibration": list(CALIBRATION["modis"])},
            "scores": {
                "holdout": scores(validation["predictors"]["modis"]["holdout"]),
                "junction": scores(validation.get("junction_2012")),
            },
        },
        {
            "key": BASELINE,
            "id": "single-world-ratio",
            "version": "1.0",
            "name": "Single world ratio",
            "status": "baseline",
            "summary": "One factor per satellite for the whole planet.",
            "params": {"k": {p: round(k, 3) for p, k in k_world.items()}},
            "scores": {"holdout": scores(validation.get("baseline_single_world_ratio")), "junction": None},
        },
    ]


# --------------------------------------------------------------------------- export


def export(product: Path, out: Path) -> dict[str, int]:
    """Write every file of the contract; return {folder: bytes}."""
    validation = json.loads((product / "validation.json").read_text())
    k_world = {p: validation["predictors"][p]["k_world"] for p in PREDICTORS}
    status = pl.read_parquet(product / "satellite_status.parquet")
    country_daily = pl.read_parquet(product / "country_daily.parquet")
    cells = scan_cells(product / "cell_daily")

    first_day = status["date"].min()
    last_month = last_complete_month(status["date"].max())
    last_day = date.fromordinal(next_month(last_month).toordinal() - 1)
    sources = day_sources(status).filter(pl.col("date").is_between(first_day, last_day))
    lazy_src = sources.lazy()

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    sizes: dict[str, int] = {}

    def add(key: str, n: int) -> None:
        sizes[key] = sizes.get(key, 0) + n

    print("1/5 baseline per country-day and 1° cell-month ...")
    base_rows = cells.join(lazy_src, on="date", how="inner").with_columns(baseline=baseline_value(k_world))
    baseline_daily = base_rows.group_by("country", "date").agg(pl.col("baseline").sum()).collect(engine="streaming")
    baseline_cells = (
        base_rows.group_by(
            fy=pl.col("iy") // FACTOR_CELLS,
            fx=pl.col("ix") // FACTOR_CELLS,
            year=pl.col("date").dt.year().cast(pl.Int16),
            month=pl.col("date").dt.month().cast(pl.Int8),
        )
        .agg(base=pl.col("baseline").sum())
        .collect(engine="streaming")
    )
    land = (
        cells.group_by("country", "iy", "ix")
        .agg(n=pl.sum_horizontal("n_terra", "n_aqua", "n_snpp", "n_n20").sum())
        .collect(engine="streaming")
    )

    print("2/5 regions, land cells, manifest ...")
    country_daily = country_daily.filter(pl.col("date").is_between(first_day, last_day))
    countries = sorted(country_daily["country"].unique())
    land = land.filter(pl.col("country").is_in(countries))  # same region list everywhere
    bbox = land.group_by("country").agg(
        west=pl.col("ix").min() * LAND_DEG, south=pl.col("iy").min() * LAND_DEG,
        east=(pl.col("ix").max() + 1) * LAND_DEG, north=(pl.col("iy").max() + 1) * LAND_DEG,
    )  # fmt: skip
    bbox = {r["country"]: [r["west"], r["south"], r["east"], r["north"]] for r in bbox.iter_rows(named=True)}
    regions = [WORLD] + [
        {"id": region_id(c), "name": region_name(c), "kind": "country", "bbox": bbox.get(c, WORLD["bbox"])} for c in countries
    ]
    index = {c: i + 1 for i, c in enumerate(countries)}
    # A border cell belongs to the country with most hotspots in it.
    owner = land.sort("n", "country", descending=[True, False]).unique(["iy", "ix"], keep="first").sort("iy", "ix")
    add("cells/land.json", dump(out / "cells" / "land.json", {
        "deg": LAND_DEG,
        "lat": (owner["iy"].cast(pl.Float64) * LAND_DEG + LAND_DEG / 2).to_list(),
        "lon": (owner["ix"].cast(pl.Float64) * LAND_DEG + LAND_DEG / 2).to_list(),
        "region": [index[c] for c in owner["country"]],
    }))  # fmt: skip
    manifest = {
        "generatedAt": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "firstMonth": ym(first_day),
        "lastMonth": ym(last_month),
        "normalYears": list(NORMAL_YEARS),
        "defaultMethod": SHIPPED,
        "methods": methods(validation, k_world),
        "regions": regions,
    }
    add("manifest.json", dump(out / "manifest.json", manifest))
    add("status.json", dump(out / "status.json", {"outages": outages(status)}))
    add("uncertainty.json", dump(out / "uncertainty.json", {
        "error_bands_country_month": validation["error_bands_country_month"],
        "anomaly_agreement": validation["anomaly_agreement"],
    }))  # fmt: skip

    print("3/5 monthly series and daily files ...")
    daily = daily_by_region(country_daily, baseline_daily, sources)
    monthly = monthly_series(daily)
    for (region,), m in monthly.partition_by("region", as_dict=True, maintain_order=True).items():
        add("series/", dump(out / "series" / f"{region}.json", series_json(region, m)))
    daily = daily.with_columns(year=pl.col("date").dt.year())
    for (region, year), d in daily.partition_by("region", "year", as_dict=True, maintain_order=True).items():
        add("daily/", dump(out / "daily" / region / f"{year}.json", daily_json(region, year, d)))

    region_ids = [r["id"] for r in regions]
    for (mo,), m in month_table(monthly, NORMAL_YEARS).partition_by("month", as_dict=True).items():
        add("months/", dump(out / "months" / f"{ym(mo)}.json", month_json(mo, m, region_ids)))

    print("4/5 map cells per month ...")
    shipped_cells = (
        pl.scan_parquet(product / "cell_monthly.parquet")
        .group_by(fy=pl.col("iy") // FACTOR_CELLS, fx=pl.col("ix") // FACTOR_CELLS, year="year", month="month")
        .agg(hs=pl.col("harmonized").sum(), raw=pl.sum_horizontal("n_modis", "n_viirs", "n_n20").sum())
        .collect()
    )
    cm = shipped_cells.join(baseline_cells, on=["fy", "fx", "year", "month"], how="full", coalesce=True)
    normals = cell_normals(cm, NORMAL_YEARS).filter((pl.col("normal_hs") > 0) | (pl.col("normal_base") > 0))
    by_month = cm.filter(pl.col("raw") > 0).partition_by("year", "month", as_dict=True)
    norm_by_month = normals.partition_by("month", as_dict=True)
    empty = cm.clear()
    month = first_day.replace(day=1)
    while month <= last_month:
        rows = by_month.get((month.year, month.month), empty).drop("year", "month", "raw")
        norm = norm_by_month.get((month.month,), normals.clear()).drop("month")
        rows = rows.join(norm, on=["fy", "fx"], how="full", coalesce=True)
        add("cells/", dump(out / "cells" / f"{ym(month)}.json", cells_json(month, rows)))
        month = next_month(month)

    print("5/5 done")
    return sizes


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="export-web", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--product", type=Path, default=PRODUCT_DIR)
    p.add_argument("--out", type=Path, default=WEB_DIR)
    args = p.parse_args(argv)
    sizes = export(args.product, args.out)
    files = sum(1 for f in args.out.rglob("*.json"))
    total = sum(sizes.values())
    print(f"wrote {files} files, {total / 1e6:.1f} MB -> {args.out}")
    for k, n in sorted(sizes.items()):
        print(f"  {k:<20} {n / 1e6:8.2f} MB")


if __name__ == "__main__":
    sys.exit(main())
