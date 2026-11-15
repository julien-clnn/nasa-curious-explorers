"""Sort the harmonization outputs into small CSV tables a teammate can open in a spreadsheet.

    uv run python scripts/export_results.py      # data/product/ -> results/

Writes:
    results/world_monthly.csv          world hotspots per month: raw MODIS, raw VIIRS, harmonized
    results/country_monthly.csv        same per country and month
    results/country_factors.csv        MODIS -> VIIRS factor per country (and per country x month)
    results/holdout_country_month.csv  2020-2025 test: predicted vs observed VIIRS per country-month
    results/scores.csv                 hold-out errors per predictor and level, vs the baseline
    results/outages.csv                satellite outage periods detected in the data
    results/summary.json               everything the results page needs, in one file
"""

from __future__ import annotations

import json
from pathlib import Path

import polars as pl

from nasa_curious_explorers.harmonize import (
    CALIBRATION,
    HOLDOUT,
    PRODUCT_DIR,
    TARGET,
    monthly_predictions,
    scan_cells,
)

OUT = Path("results")
OUT.mkdir(exist_ok=True)
P = PRODUCT_DIR

daily = pl.read_parquet(P / "country_daily.parquet")
factors = pl.read_parquet(P / "factors.parquet")
status = pl.read_parquet(P / "satellite_status.parquet")
val = json.loads((P / "validation.json").read_text())

# ---------------------------------------------------------------- monthly series
m = daily.with_columns(year=pl.col("date").dt.year(), month=pl.col("date").dt.month())
cols = [pl.col("n_modis").sum().alias("modis_raw"), pl.col("n_viirs").sum().alias("viirs_snpp_raw"),
        pl.col("n_n20").sum().alias("viirs_noaa20_raw"), pl.col("harmonized").sum().round(0).alias("harmonized")]
country_monthly = m.group_by("country", "year", "month").agg(cols).sort("country", "year", "month")
world_monthly = m.group_by("year", "month").agg(cols).sort("year", "month")
country_monthly.write_csv(OUT / "country_monthly.csv")
world_monthly.write_csv(OUT / "world_monthly.csv")

# ---------------------------------------------------------------- factors
fm = factors.filter(pl.col("predictor") == "modis")
country_f = (
    fm.group_by("country").agg(pl.col("k_country").first(), pl.col("n_predictor").sum().alias("modis_hotspots_2013_2019"),
                               pl.col("n_target").sum().alias("viirs_hotspots_2013_2019"))
    .with_columns(raw_ratio=(pl.col("viirs_hotspots_2013_2019") / pl.col("modis_hotspots_2013_2019")).round(3),
                  k_country=pl.col("k_country").round(3))
    .sort("viirs_hotspots_2013_2019", descending=True)
)
country_f.write_csv(OUT / "country_factors.csv")
cm = (fm.select("country", "month", "k_country_month").unique().sort("country", "month")
      .with_columns(pl.col("k_country_month").round(3)))
cm.write_csv(OUT / "country_month_factors.csv")

# ---------------------------------------------------------------- hold-out predictions
cells = scan_cells(P / "cell_daily")
pred = monthly_predictions(cells, status, factors, "modis", HOLDOUT["modis"])
ho = (pred.group_by("country", "year", "month")
      .agg(pl.col("pred").sum().round(0).alias("predicted_viirs"),
           pl.col("world_pred").sum().round(0).alias("predicted_baseline"),
           pl.col(TARGET).sum().alias("observed_viirs"))
      .sort("country", "year", "month"))
ho.write_csv(OUT / "holdout_country_month.csv")

# ---------------------------------------------------------------- scores
rows = []
for p, d in val["predictors"].items():
    for lvl, s in d["holdout"].items():
        rows.append({"method": "hierarchical-shrinkage", "predictor": p, "test": f"{d['holdout_years'][0]}-{d['holdout_years'][1]}", "level": lvl, **s})
for lvl, s in val["junction_2012"].items():
    rows.append({"method": "hierarchical-shrinkage", "predictor": "modis", "test": "2012 (junction)", "level": lvl, **s})
for lvl, s in val["baseline_single_world_ratio"].items():
    rows.append({"method": "single-world-ratio (baseline)", "predictor": "modis", "test": "2020-2025", "level": lvl, **s})
pl.DataFrame(rows).write_csv(OUT / "scores.csv")

# ---------------------------------------------------------------- outages
launch = {"ok_terra": "2000-11-01", "ok_aqua": "2002-07-04", "ok_snpp": "2012-01-20", "ok_n20": "2018-04-01"}
outs = []
for c, start in launch.items():
    s = status.filter(pl.col("date") >= pl.lit(start).str.to_date()).select("date", ok=pl.col(c))
    s = s.with_columns(run=(pl.col("ok") != pl.col("ok").shift()).cum_sum()).filter(~pl.col("ok"))
    for r in s.group_by("run").agg(start=pl.col("date").min(), end=pl.col("date").max(), days=pl.len()).sort("start").iter_rows(named=True):
        outs.append({"satellite": c.replace("ok_", ""), "start": str(r["start"]), "end": str(r["end"]), "days": r["days"]})
outages = pl.DataFrame(outs)
outages.write_csv(OUT / "outages.csv")

# ---------------------------------------------------------------- summary for the page
def series(df):
    return {k: df[k].to_list() for k in df.columns}

top = ["Brazil", "Argentina", "Australia", "Russian_Federation", "Canada", "Indonesia", "India", "United_States"]
annual = (country_monthly.filter(pl.col("country").is_in(top))
          .group_by("country", "year").agg(pl.col("modis_raw", "viirs_snpp_raw", "harmonized").sum()).sort("country", "year"))
arg = country_monthly.filter(pl.col("country") == "Argentina")
summary = {
    "validation": val,
    "world_monthly": series(world_monthly),
    "argentina_monthly": series(arg.drop("country")),
    "annual_top": {c: series(annual.filter(pl.col("country") == c).drop("country")) for c in top},
    "country_factors": series(country_f.head(30)),
    "argentina_month_factors": cm.filter(pl.col("country") == "Argentina")["k_country_month"].to_list(),
    "brazil_month_factors": cm.filter(pl.col("country") == "Brazil")["k_country_month"].to_list(),
    "australia_month_factors": cm.filter(pl.col("country") == "Australia")["k_country_month"].to_list(),
    "holdout_scatter": series(ho.filter(pl.col("observed_viirs") >= 100).select("country", "year", "month", "predicted_viirs", "predicted_baseline", "observed_viirs")),
    "outages": outs,
    "n_factors": {p: factors.filter(pl.col("predictor") == p).height for p in ["modis", "terra", "aqua", "n20"]},
}
(OUT / "summary.json").write_text(json.dumps(summary, default=str))
print(world_monthly.tail(3)); print(country_f.head(10)); print(outages.filter(pl.col("days") >= 3)); print(ho.height)
