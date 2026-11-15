"""Export the hotspots themselves (not 1-degree totals) for the globe.

    uv run export-points                 # data/detections + data/product -> frontend/public/data/points
    uv run export-points --years 2020    # only some years

Each detection is kept only if it comes from the satellite that carries the harmonized
series that day (Suomi-NPP, else NOAA-20, else MODIS; same rule as the product), and gets
a weight: 1 for Suomi-NPP, else the MODIS/NOAA-20 -> VIIRS factor of its 1-degree cell and
month. So the brightness of a point is in VIIRS-equivalent hotspots, comparable across
2005 and 2020, and the points of a month add up to the harmonized total.

Detections are then summed on a fine grid, small enough to look like points on screen:

    points/{YYYY-MM}.bin   0.05 degree (about 5 km), one file per month
    points/{YYYY}.bin      0.1 degree, one file per year

Binary layout, little-endian, n points: n x uint16 column, then n x uint16 row, then
n x uint16 weight (VIIRS-equivalent hotspots, rounded, at least 1).
Column = floor((lon + 180) / deg), row = floor((lat + 90) / deg); the point is the cell centre.

With --exact, every detection is also kept at its own position (the centre of the sensor
pixel: 375 m for VIIRS, 1 km for MODIS), for the country view:

    exact/{YYYY-MM}/{tx}_{ty}.bin   one 10-degree tile, tx = floor((lon + 180) / 10), ty = floor((lat + 90) / 10)
    exact/{YYYY-MM}/index.json      {"tileDeg": 10, "tiles": {"tx_ty": n, ...}} (only non-empty tiles)

Tile layout, little-endian, n detections: n x uint16 x, n x uint16 y (position inside the
tile, 0..65535 over 10 degrees, ~17 m steps), n x uint16 weight x 100, n x uint8 day of month.
"""

from __future__ import annotations

import argparse
import array
import json
import sys
from pathlib import Path

import polars as pl

from nasa_curious_explorers.harmonize import PRODUCT_DIR, attach_factor, source_expr

DETECTIONS = Path("data/detections")
OUT = Path("frontend/public/data/points")
EXACT = Path("frontend/public/data/exact")
TILE_DEG = 10
MONTH_DEG = 0.05
YEAR_DEG = 0.1

# Satellites whose detections carry the series, per day source.
SOURCE_SATS = {"snpp": ["Suomi-NPP"], "n20": ["NOAA-20"], "modis": ["Terra", "Aqua"], "terra": ["Terra"], "aqua": ["Aqua"]}


def weighted_detections(detections: Path, product: Path, year: int) -> pl.DataFrame:
    """lat, lon, month, day, w for every detection of `year` that carries the harmonized series."""
    status = pl.read_parquet(product / "satellite_status.parquet")
    sources = status.select("date", source=source_expr())
    factors = pl.read_parquet(product / "factors.parquet")
    pairs = pl.DataFrame(
        [(s, sat) for s, sats in SOURCE_SATS.items() for sat in sats], schema=["source", "sat"], orient="row"
    )
    lf = (
        pl.scan_parquet(detections / "**/*.parquet", hive_partitioning=True)
        .filter((pl.col("year") == year) & (pl.col("type") == 0))
        .select(
            "country", "latitude", "longitude",
            date=pl.col("acq_date"), sat=pl.col("satellite").cast(pl.String),
        )
        .join(sources.lazy(), on="date")
        .join(pairs.lazy(), on=["source", "sat"], how="semi")
        .with_columns(
            fy=pl.col("latitude").floor().cast(pl.Int16),
            fx=pl.col("longitude").floor().cast(pl.Int16),
            month=pl.col("date").dt.month().cast(pl.Int8),
            day=pl.col("date").dt.day().cast(pl.UInt8),
        )
    )  # fmt: skip
    lf = attach_factor(lf, factors, by="source")
    return lf.select(
        "latitude", "longitude", "month", "day", w=pl.when(pl.col("source") == "snpp").then(1.0).otherwise(pl.col("k"))
    ).collect()


def grid(df: pl.DataFrame, deg: float) -> pl.DataFrame:
    return (
        df.group_by(
            c=((pl.col("longitude") + 180) / deg).floor().clip(0, round(360 / deg) - 1).cast(pl.UInt16),
            r=((pl.col("latitude") + 90) / deg).floor().clip(0, round(180 / deg) - 1).cast(pl.UInt16),
        )
        .agg(pl.col("w").sum())
        .sort("w")  # small first, so the brightest points are drawn last
    )


def write(path: Path, g: pl.DataFrame) -> int:
    w = g["w"].round(0).clip(1, 65535).cast(pl.UInt16)
    buf = array.array("H", [*g["c"].to_list(), *g["r"].to_list(), *w.to_list()])
    if sys.byteorder != "little":
        buf.byteswap()
    data = buf.tobytes()
    path.write_bytes(data)
    return len(data)


def write_exact(out: Path, df: pl.DataFrame) -> int:
    """One month of detections at their own position, split into 10-degree tiles (see module doc)."""
    out.mkdir(parents=True, exist_ok=True)
    df = df.with_columns(
        tx=((pl.col("longitude") + 180) // TILE_DEG).clip(0, 360 // TILE_DEG - 1).cast(pl.Int16),
        ty=((pl.col("latitude") + 90) // TILE_DEG).clip(0, 180 // TILE_DEG - 1).cast(pl.Int16),
    )
    index, total = {}, 0
    for (tx, ty), t in df.partition_by(["tx", "ty"], as_dict=True).items():
        t = t.sort("w")  # small first, so the brightest points are drawn last
        q = lambda v, o: ((v - o) / TILE_DEG * 65535).round(0).clip(0, 65535).cast(pl.UInt16).to_list()  # noqa: E731
        u16 = array.array("H", [
            *q(t["longitude"], tx * TILE_DEG - 180),
            *q(t["latitude"], ty * TILE_DEG - 90),
            *(t["w"] * 100).round(0).clip(1, 65535).cast(pl.UInt16).to_list(),
        ])  # fmt: skip
        if sys.byteorder != "little":
            u16.byteswap()
        data = u16.tobytes() + bytes(t["day"].to_list())
        (out / f"{tx}_{ty}.bin").write_bytes(data)
        index[f"{tx}_{ty}"] = t.height
        total += len(data)
    (out / "index.json").write_text(json.dumps({"tileDeg": TILE_DEG, "tiles": index}, sort_keys=True))
    return total


def export(detections: Path, product: Path, out: Path, years: list[int], exact: Path | None = None) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    total = 0
    for year in years:
        df = weighted_detections(detections, product, year)
        if df.is_empty():
            continue
        total += write(out / f"{year}.bin", grid(df, YEAR_DEG))
        for (month,), part in df.partition_by("month", as_dict=True).items():
            total += write(out / f"{year}-{month:02d}.bin", grid(part, MONTH_DEG))
            if exact is not None:
                total += write_exact(exact / f"{year}-{month:02d}", part)
        print(f"  {year}: {len(df):>10,} detections", flush=True)
    meta = {"monthDeg": MONTH_DEG, "yearDeg": YEAR_DEG, "layout": "u16 col[n], u16 row[n], u16 weight[n]"}
    (out / "index.json").write_text(json.dumps(meta))
    return {"bytes": total}


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="export-points", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--detections", type=Path, default=DETECTIONS)
    p.add_argument("--product", type=Path, default=PRODUCT_DIR)
    p.add_argument("--out", type=Path, default=OUT)
    p.add_argument("--years", type=int, nargs="*", default=list(range(2000, 2026)))
    p.add_argument("--exact", type=Path, nargs="?", const=EXACT, default=None, help=f"also write every detection, tiled (default dir {EXACT})")
    args = p.parse_args(argv)
    r = export(args.detections, args.product, args.out, args.years, args.exact)
    print(f"wrote {r['bytes'] / 1e6:.0f} MB -> {args.out}")


if __name__ == "__main__":
    sys.exit(main())
