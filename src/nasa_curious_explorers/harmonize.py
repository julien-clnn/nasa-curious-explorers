"""Harmonize MODIS and VIIRS hotspots into one "VIIRS-equivalent" time series.

    uv run harmonize            # aggregate -> fit -> validate -> build product tables
    uv run harmonize --skip-aggregate   # reuse data/product/cell_daily

Method, in one paragraph. VIIRS (375 m) sees about 3-4x more hotspots than MODIS
(1 km), so raw counts cannot be chained. During the years both flew we learn a
conversion factor k = VIIRS / MODIS per 1-degree cell and calendar month. Cells with
few hotspots borrow strength from their country, then from the world (shrinkage).
The harmonized series is MODIS x k before VIIRS existed, and observed VIIRS after.
Factors are fitted on 2013-2019 only, so that 2020-2025 (and 2012) remain unseen
years on which the method is scored.

Satellites have outages (Suomi-NPP lost 15 days in mid-2022, Terra 13 days in
October 2022, ...). They are detected from the data itself, excluded from fitting
and scoring, and bridged in the product by the next best source for that day:
Suomi-NPP, else NOAA-20, else Terra+Aqua, else Terra or Aqua alone.

Outputs (data/product/):

    cell_daily/year=YYYY/*.parquet   hotspots per 0.5-degree cell, day and satellite
    satellite_status.parquet         which satellites delivered normally, per day
    factors.parquet                  k per predictor, 1-degree cell and month
    country_daily.parquet            raw + harmonized counts per country and day
    cell_monthly.parquet             raw + harmonized counts per 0.5-degree cell and month
    validation.json                  hold-out scores and error bands
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import UTC, date, datetime
from pathlib import Path

import polars as pl

DATA_DIR = Path("data")
PRODUCT_DIR = DATA_DIR / "product"

CELL_DEG = 0.5  # aggregation grid
FACTOR_CELLS = 2  # a factor region is FACTOR_CELLS x FACTOR_CELLS aggregation cells (1 degree)

# Satellite name in the detections -> count column in the aggregates.
SAT_COLS = {"Terra": "n_terra", "Aqua": "n_aqua", "Suomi-NPP": "n_snpp", "NOAA-20": "n_n20"}

# A predictor is what we convert *from*; the target is always Suomi-NPP VIIRS.
#   modis: Terra + Aqua, the normal case
#   terra: Terra alone (before Aqua was launched, or during an Aqua outage)
#   aqua:  Aqua alone (during a Terra outage)
#   n20:   NOAA-20 VIIRS, which carries the series now that Suomi-NPP has stopped
PREDICTORS = {
    "modis": pl.col("n_terra") + pl.col("n_aqua"),
    "terra": pl.col("n_terra"),
    "aqua": pl.col("n_aqua"),
    "n20": pl.col("n_n20"),
}
# Satellites a predictor needs to be delivering normally on a given day.
NEEDS = {"modis": ["ok_terra", "ok_aqua"], "terra": ["ok_terra"], "aqua": ["ok_aqua"], "n20": ["ok_n20"]}
TARGET = "n_snpp"

VIIRS_START = date(2012, 2, 1)  # first full month of Suomi-NPP VIIRS
CALIBRATION = {"modis": (2013, 2019), "terra": (2013, 2019), "aqua": (2013, 2019), "n20": (2019, 2021)}
HOLDOUT = {"modis": (2020, 2025), "terra": (2020, 2025), "aqua": (2020, 2025), "n20": (2022, 2025)}
JUNCTION_YEAR = 2012  # first VIIRS year, before the calibration window: a second unseen test

# A satellite is "out" on days where its world count is below this share of its own
# 31-day rolling median.
OUTAGE_SHARE = 0.5

# Shrinkage strength, in predictor hotspots: a cell-month with ALPHA hotspots over the
# calibration years gets a factor half-way between its own ratio and its parent's.
# 100 gave the lowest cell-month error when fitting on 2013-2016 and scoring on 2017-2019.
ALPHA = 100.0
# At every level a factor may not stray further than this multiple from its parent's.
# Without it, places VIIRS sees constantly and MODIS almost never get factors of several
# hundred, and a single stray MODIS detection becomes a spike in the harmonized series.
K_CAP = 4.0


# --------------------------------------------------------------------------- aggregate


def aggregate(detections: Path, out: Path) -> None:
    """Count vegetation-fire hotspots per country, 0.5-degree cell, day and satellite."""
    lf = pl.scan_parquet(detections / "**/*.parquet", hive_partitioning=True)
    sat = pl.col("satellite").cast(pl.String)
    agg = (
        lf.filter(pl.col("type") == 0)  # 0 = presumed vegetation fire
        .select(
            "country",
            iy=(pl.col("latitude") / CELL_DEG).floor().cast(pl.Int16),
            ix=(pl.col("longitude") / CELL_DEG).floor().cast(pl.Int16),
            date=pl.col("acq_date"),
            sat=sat,
        )
        .group_by("country", "iy", "ix", "date")
        .agg(*[(pl.col("sat") == s).sum().cast(pl.UInt32).alias(c) for s, c in SAT_COLS.items()])
        .with_columns(year=pl.col("date").dt.year().cast(pl.Int16))
    )
    if out.exists():
        shutil.rmtree(out)
    agg.sink_parquet(pl.PartitionBy(out, key="year", include_key=False), mkdir=True)


def scan_cells(cell_daily: Path) -> pl.LazyFrame:
    return pl.scan_parquet(cell_daily / "**/*.parquet", hive_partitioning=True).drop("year")


def with_keys(lf: pl.LazyFrame) -> pl.LazyFrame:
    """Add the factor-region (fy, fx) and calendar keys used by fit and apply."""
    return lf.with_columns(
        fy=pl.col("iy") // FACTOR_CELLS,
        fx=pl.col("ix") // FACTOR_CELLS,
        year=pl.col("date").dt.year().cast(pl.Int16),
        month=pl.col("date").dt.month().cast(pl.Int8),
    )


# --------------------------------------------------------------------------- outages


def satellite_status(cells: pl.LazyFrame) -> pl.DataFrame:
    """One row per calendar day with ok_terra / ok_aqua / ok_snpp / ok_n20 flags."""
    daily = cells.group_by("date").agg(*[pl.col(c).sum() for c in SAT_COLS.values()]).collect()
    calendar = pl.DataFrame({"date": pl.date_range(daily["date"].min(), daily["date"].max(), "1d", eager=True)})
    daily = calendar.join(daily, on="date", how="left").fill_null(0).sort("date")
    flags = []
    for col in SAT_COLS.values():
        median = pl.col(col).rolling_median(31, center=True, min_samples=5)
        flags.append(((pl.col(col) > 0) & (pl.col(col) >= OUTAGE_SHARE * median)).alias(col.replace("n_", "ok_")))
    return daily.with_columns(flags)


def source_expr() -> pl.Expr:
    """Best available source for a day, from the ok_* flags."""
    return (
        pl.when((pl.col("date") >= VIIRS_START) & pl.col("ok_snpp")).then(pl.lit("snpp"))
        .when((pl.col("date") >= VIIRS_START) & pl.col("ok_n20")).then(pl.lit("n20"))
        .when(pl.col("ok_terra") & pl.col("ok_aqua")).then(pl.lit("modis"))
        .when(pl.col("ok_terra")).then(pl.lit("terra"))
        .when(pl.col("ok_aqua")).then(pl.lit("aqua"))
        .otherwise(pl.lit("none"))
    )  # fmt: skip


def valid_days(cells: pl.LazyFrame, status: pl.DataFrame, predictor: str) -> pl.LazyFrame:
    """Keep the days on which both the predictor and the target delivered normally."""
    ok = status.filter(pl.all_horizontal("ok_snpp", *NEEDS[predictor])).select("date")
    return cells.join(ok.lazy(), on="date", how="semi")


# --------------------------------------------------------------------------- fit


def fit_factors(
    cells: pl.LazyFrame, status: pl.DataFrame, predictor: str, years: tuple[int, int], alpha: float = ALPHA
) -> pl.DataFrame:
    """Shrunk ratio target/predictor per (country, 1-degree cell, month).

    Each level is pulled toward its parent with weight `alpha`:
        k = (V + alpha * k_parent) / (M + alpha)
    where V and M are target and predictor hotspots summed over the calibration years,
    then kept within a factor K_CAP of that parent.
    Chain: world -> country -> country x month -> cell x month.
    """
    sums = (
        with_keys(valid_days(cells, status, predictor))
        .filter(pl.col("year").is_between(*years))
        .group_by("country", "fy", "fx", "month")
        .agg(m=PREDICTORS[predictor].sum().cast(pl.Float64), v=pl.col(TARGET).sum().cast(pl.Float64))
        .collect()
    )

    def shrink(df: pl.DataFrame, name: str, parent: str) -> pl.DataFrame:
        k = (pl.col("v") + alpha * pl.col(parent)) / (pl.col("m") + alpha)
        return df.with_columns(k.clip(pl.col(parent) / K_CAP, pl.col(parent) * K_CAP).alias(name))

    def level(keys: list[str]) -> pl.DataFrame:
        return sums.group_by(keys).agg(pl.col("m").sum(), pl.col("v").sum())

    k_world = sums["v"].sum() / sums["m"].sum()
    country = shrink(level(["country"]).with_columns(k_world=pl.lit(k_world)), "k_country", "k_world")
    country_month = shrink(
        level(["country", "month"]).join(country.select("country", "k_country", "k_world"), on="country"),
        "k_country_month",
        "k_country",
    )
    out = shrink(
        sums.join(
            country_month.select("country", "month", "k_country_month", "k_country", "k_world"),
            on=["country", "month"],
        ),
        "k",
        "k_country_month",
    )
    return out.select(
        pl.lit(predictor).alias("predictor"), "country", "fy", "fx", "month",
        "k", "k_country_month", "k_country", "k_world",
        pl.col("m").alias("n_predictor"), pl.col("v").alias("n_target"),
    )  # fmt: skip


def attach_factor(cells: pl.LazyFrame, factors: pl.DataFrame, by: str = "predictor") -> pl.LazyFrame:
    """Add column `k`: the factor of the predictor named in column `by`.

    A cell-month never seen during calibration has no row in `factors`: it takes its
    country-month factor, then its country factor, then the world factor. Rows whose
    `by` is not a predictor (e.g. "snpp") get a null `k`.
    """
    cell = factors.select("predictor", "country", "fy", "fx", "month", pl.col("k").alias("_k_cell"))
    cm = factors.select("predictor", "country", "month", pl.col("k_country_month").alias("_k_cm")).unique()
    c = factors.select("predictor", "country", pl.col("k_country").alias("_k_c")).unique()
    w = factors.select("predictor", pl.col("k_world").alias("_k_w")).unique()
    return (
        cells.join(cell.lazy(), left_on=[by, "country", "fy", "fx", "month"], right_on=["predictor", "country", "fy", "fx", "month"], how="left")
        .join(cm.lazy(), left_on=[by, "country", "month"], right_on=["predictor", "country", "month"], how="left")
        .join(c.lazy(), left_on=[by, "country"], right_on=["predictor", "country"], how="left")
        .join(w.lazy(), left_on=by, right_on="predictor", how="left")
        .with_columns(k=pl.coalesce("_k_cell", "_k_cm", "_k_c", "_k_w"))
        .drop("_k_cell", "_k_cm", "_k_c", "_k_w")
    )


def predict(cells: pl.LazyFrame, factors: pl.DataFrame, predictor: str) -> pl.LazyFrame:
    """Add `pred`: the VIIRS-equivalent count obtained from `predictor` alone."""
    lf = attach_factor(with_keys(cells).with_columns(predictor=pl.lit(predictor)), factors)
    return lf.with_columns(pred=PREDICTORS[predictor] * pl.col("k"))


# --------------------------------------------------------------------------- validate

MIN_ACTUAL = 100  # percentage errors are only meaningful above a minimum count
ANOMALY_CLASSES = [0.5, 1.5, 3.0]  # ratio to the seasonal normal: low | normal | high | exceptional


def error_stats(df: pl.DataFrame, keys: list[str]) -> dict:
    """Compare `pred` with observed VIIRS after summing both over `keys`."""
    g = df.group_by(keys).agg(pl.col("pred").sum(), pl.col(TARGET).sum()).filter(pl.col(TARGET) >= MIN_ACTUAL)
    err = (g["pred"] - g[TARGET]).abs()
    return {
        "n": g.height,
        "median_abs_error_pct": round((err / g[TARGET]).median() * 100, 1),
        "weighted_abs_error_pct": round(err.sum() / g[TARGET].sum() * 100, 1),
        "bias_pct": round((g["pred"].sum() / g[TARGET].sum() - 1) * 100, 1),
    }


def anomaly_agreement(monthly: pl.DataFrame, normal: pl.DataFrame) -> dict:
    """Do converted MODIS and observed VIIRS flag the same country-months as unusual?"""

    def ratio(col: str) -> pl.Expr:
        return pl.col(col) / pl.col("normal")

    def klass(col: str) -> pl.Expr:
        return ratio(col).cut(ANOMALY_CLASSES, labels=["low", "normal", "high", "exceptional"])

    x = (
        monthly.group_by("country", "year", "month")
        .agg(pl.col("pred").sum(), pl.col(TARGET).sum())
        .join(normal, on=["country", "month"])
        .filter(pl.col("normal") >= MIN_ACTUAL)
    )
    unusual = x.filter(klass(TARGET).is_in(["high", "exceptional"]))
    return {
        "n": x.height,
        "spearman": round(x.select(pl.corr(ratio("pred"), ratio(TARGET), method="spearman")).item(), 3),
        "same_class_pct": round(x.select((klass("pred") == klass(TARGET)).mean()).item() * 100, 1),
        "unusual_months": unusual.height,
        "unusual_months_also_flagged_pct": round(
            unusual.select(klass("pred").is_in(["high", "exceptional"]).mean()).item() * 100, 1
        ),
    }


def error_bands(monthly: pl.DataFrame) -> list[dict]:
    """Observed / predicted quantiles per size of the predicted country-month total."""
    g = (
        monthly.group_by("country", "year", "month")
        .agg(pl.col("pred").sum(), pl.col(TARGET).sum())
        .filter(pl.col("pred") >= 10)
        .with_columns(decade=pl.col("pred").log10().floor().clip(1, 5).cast(pl.Int8))
    )
    r = pl.col(TARGET) / pl.col("pred")
    bands = g.group_by("decade").agg(
        n=pl.len(), p10=r.quantile(0.1).round(2), p50=r.median().round(2), p90=r.quantile(0.9).round(2)
    )
    return bands.sort("decade").select(predicted_from=10 ** pl.col("decade").cast(pl.Int64), n="n", p10="p10", p50="p50", p90="p90").to_dicts()


def monthly_predictions(cells: pl.LazyFrame, status: pl.DataFrame, factors: pl.DataFrame, predictor: str, years) -> pl.DataFrame:
    lf = valid_days(cells, status, predictor).filter(pl.col("date").dt.year().is_between(*years))
    return (
        predict(lf, factors, predictor)
        .with_columns(world_pred=PREDICTORS[predictor] * factors.filter(pl.col("predictor") == predictor)["k_world"][0])
        .group_by("country", "fy", "fx", "year", "month")
        .agg(pl.col("pred").sum(), pl.col("world_pred").sum(), pl.col(TARGET).sum())
        .collect()
    )


def validate(cells: pl.LazyFrame, status: pl.DataFrame, factors: pl.DataFrame) -> dict:
    """Score every predictor on years the factors have never seen."""
    levels = {
        "world_month": ["year", "month"],
        "country_month": ["country", "year", "month"],
        "country_year": ["country", "year"],
        "cell_month": ["country", "fy", "fx", "year", "month"],
    }
    report: dict = {"predictors": {}}
    for p in PREDICTORS:
        m = monthly_predictions(cells, status, factors, p, HOLDOUT[p])
        report["predictors"][p] = {
            "calibration_years": CALIBRATION[p],
            "holdout_years": HOLDOUT[p],
            "k_world": round(factors.filter(pl.col("predictor") == p)["k_world"][0], 3),
            "holdout": {name: error_stats(m, keys) for name, keys in levels.items()},
        }
        if p == "modis":
            # Baseline: what a single world-wide ratio would have given.
            base = m.with_columns(pred=pl.col("world_pred"))
            report["baseline_single_world_ratio"] = {name: error_stats(base, keys) for name, keys in levels.items()}
            # Seasonal normal of observed VIIRS over the calibration years.
            lo, hi = CALIBRATION[p]
            normal = (
                with_keys(cells).filter(pl.col("year").is_between(lo, hi))
                .group_by("country", "month").agg(normal=pl.col(TARGET).sum() / (hi - lo + 1))
                .collect()
            )  # fmt: skip
            report["anomaly_agreement"] = anomaly_agreement(m, normal)
            report["error_bands_country_month"] = error_bands(m)
            j = monthly_predictions(cells, status, factors, p, (JUNCTION_YEAR, JUNCTION_YEAR))
            j = j.filter(pl.col("month") >= VIIRS_START.month)
            report["junction_2012"] = {name: error_stats(j, keys) for name, keys in levels.items()}
    return report


# --------------------------------------------------------------------------- product


def harmonized_cells(cells: pl.LazyFrame, status: pl.DataFrame, factors: pl.DataFrame) -> pl.LazyFrame:
    """Add `source` (which satellite the day relies on) and `harmonized` to every row."""
    flags = status.select("date", source=source_expr())
    lf = attach_factor(with_keys(cells).join(flags.lazy(), on="date", how="left"), factors, by="source")
    count = (
        pl.when(pl.col("source") == "snpp").then(pl.col(TARGET).cast(pl.Float64))
        .when(pl.col("source") == "n20").then(PREDICTORS["n20"] * pl.col("k"))
        .when(pl.col("source") == "modis").then(PREDICTORS["modis"] * pl.col("k"))
        .when(pl.col("source") == "terra").then(PREDICTORS["terra"] * pl.col("k"))
        .when(pl.col("source") == "aqua").then(PREDICTORS["aqua"] * pl.col("k"))
    )  # fmt: skip
    return lf.with_columns(harmonized=count, n_modis=PREDICTORS["modis"], n_viirs=pl.col(TARGET))


def build_products(cells: pl.LazyFrame, status: pl.DataFrame, factors: pl.DataFrame, out: Path) -> None:
    h = harmonized_cells(cells, status, factors)
    sums = [
        pl.col("n_modis").sum(), pl.col("n_viirs").sum(), pl.col("n_n20").sum(),
        pl.col("harmonized").sum().cast(pl.Float32),
    ]  # fmt: skip
    # On a day no satellite delivered normally, the harmonized value is unknown, not zero.
    known = pl.when(pl.col("source") != "none").then(pl.col("harmonized"))
    (
        h.group_by("country", "date").agg(*sums, pl.col("source").first())
        .with_columns(harmonized=known)
        .sort("country", "date").sink_parquet(out / "country_daily.parquet")
    )  # fmt: skip
    (
        h.group_by("iy", "ix", "year", "month").agg(*sums)
        .sort("year", "month", "iy", "ix").sink_parquet(out / "cell_monthly.parquet")
    )  # fmt: skip


# --------------------------------------------------------------------------- CLI


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="harmonize", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--detections", type=Path, default=DATA_DIR / "detections")
    p.add_argument("--out", type=Path, default=PRODUCT_DIR)
    p.add_argument("--skip-aggregate", action="store_true", help="reuse OUT/cell_daily from a previous run")
    args = p.parse_args(argv)
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)

    if not args.skip_aggregate:
        print("1/5 aggregating detections per cell and day ...")
        aggregate(args.detections, out / "cell_daily")
    cells = scan_cells(out / "cell_daily")

    print("2/5 detecting satellite outages ...")
    status = satellite_status(cells)
    status.write_parquet(out / "satellite_status.parquet")

    print("3/5 fitting conversion factors ...")
    factors = pl.concat([fit_factors(cells, status, p_, CALIBRATION[p_]) for p_ in PREDICTORS])
    factors.write_parquet(out / "factors.parquet")

    print("4/5 validating on unseen years ...")
    report = validate(cells, status, factors)
    report |= {"generated_at": datetime.now(UTC).isoformat(), "alpha": ALPHA, "k_cap": K_CAP, "cell_deg": CELL_DEG}
    (out / "validation.json").write_text(json.dumps(report, indent=2) + "\n")

    print("5/5 building harmonized tables ...")
    build_products(cells, status, factors, out)

    m = report["predictors"]["modis"]["holdout"]
    print(
        f"done -> {out}\n"
        f"  MODIS -> VIIRS on {HOLDOUT['modis'][0]}-{HOLDOUT['modis'][1]} (unseen): median error "
        f"{m['country_month']['median_abs_error_pct']}% per country-month, "
        f"{m['world_month']['median_abs_error_pct']}% per world-month"
    )


if __name__ == "__main__":
    sys.exit(main())
