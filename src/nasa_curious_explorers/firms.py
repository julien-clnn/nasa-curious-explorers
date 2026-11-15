"""NASA FIRMS yearly country files: sources and normalization to a common schema.

FIRMS publishes standard-processing (SP) hotspots as one CSV per country and year,
either individually or bundled in one zip per sensor and year:

    https://firms.modaps.eosdis.nasa.gov/data/country/{sensor}/{year}/{sensor}_{year}_{Country}.csv
    https://firms.modaps.eosdis.nasa.gov/data/country/zips/{sensor}_{year}_all_countries.zip

MODIS and VIIRS files share the same layout except for the brightness columns and
the confidence encoding (0-100 for MODIS, l/n/h for VIIRS). `normalize` maps both
to one schema so downstream code never has to care which sensor a row came from.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import polars as pl

BASE_URL = "https://firms.modaps.eosdis.nasa.gov/data/country"


@dataclass(frozen=True)
class Sensor:
    key: str  # FIRMS path segment, also used as the Hive `sensor=` value
    instrument: str  # MODIS | VIIRS
    first_year: int
    bt_mir_col: str  # mid-infrared brightness temperature column (~4 µm)
    bt_tir_col: str  # thermal-infrared brightness temperature column (~11 µm)


SENSORS: dict[str, Sensor] = {
    s.key: s
    for s in (
        Sensor("modis", "MODIS", 2000, "brightness", "bright_t31"),
        Sensor("viirs-snpp", "VIIRS", 2012, "bright_ti4", "bright_ti5"),
        Sensor("viirs-jpss1", "VIIRS", 2018, "bright_ti4", "bright_ti5"),
    )
}

SATELLITES = pl.Enum(["Terra", "Aqua", "Suomi-NPP", "NOAA-20", "NOAA-21"])
_SATELLITE_NAMES = {"Terra": "Terra", "Aqua": "Aqua", "N": "Suomi-NPP", "N20": "NOAA-20", "N21": "NOAA-21"}
INSTRUMENTS = pl.Enum(["MODIS", "VIIRS"])
CONFIDENCE = pl.Enum(["low", "nominal", "high"])
DAYNIGHT = pl.Enum(["D", "N"])

# Normalized schema (partition columns sensor/year/month live in the Hive path).
SCHEMA: dict[str, pl.DataType] = {
    "acq_datetime": pl.Datetime("ms", "UTC"),
    "acq_date": pl.Date(),
    "latitude": pl.Float32(),
    "longitude": pl.Float32(),
    "country": pl.String(),
    "satellite": SATELLITES,
    "instrument": INSTRUMENTS,
    "daynight": DAYNIGHT,
    "confidence_class": CONFIDENCE,
    "confidence_raw": pl.String(),
    "confidence_pct": pl.Int8(),  # MODIS only, null for VIIRS
    "frp_mw": pl.Float32(),
    "bt_mir_k": pl.Float32(),
    "bt_tir_k": pl.Float32(),
    "scan_km": pl.Float32(),
    "track_km": pl.Float32(),
    "type": pl.Int8(),  # 0 vegetation fire (presumed), 1 volcano, 2 static land source, 3 offshore
    "version": pl.String(),
}

# Every raw column is read as text: the normalization does all the typing, so a
# malformed value in one country file fails loudly instead of being guessed.
RAW_COLUMNS = [
    "latitude", "longitude", "{bt_mir}", "scan", "track", "acq_date", "acq_time",
    "satellite", "instrument", "confidence", "version", "{bt_tir}", "frp", "daynight", "type",
]


def raw_schema(sensor: Sensor) -> dict[str, pl.DataType]:
    cols = [c.format(bt_mir=sensor.bt_mir_col, bt_tir=sensor.bt_tir_col) for c in RAW_COLUMNS]
    return {c: pl.String() for c in cols}


def country_url(sensor: str, year: int, country: str) -> str:
    return f"{BASE_URL}/{sensor}/{year}/{sensor}_{year}_{country}.csv"


def world_zip_url(sensor: str, year: int) -> str:
    return f"{BASE_URL}/zips/{sensor}_{year}_all_countries.zip"


_COUNTRY_FILE = re.compile(r"^(?P<sensor>[a-z0-9-]+)_(?P<year>\d{4})_(?P<country>.+)\.csv$")


def country_from_filename(name: str) -> str:
    """`modis_2000_Cote_d_Ivoire.csv` -> `Cote_d_Ivoire`."""
    m = _COUNTRY_FILE.match(name.rsplit("/", 1)[-1])
    if not m:
        raise ValueError(f"not a FIRMS country file name: {name!r}")
    return m["country"]


def modis_confidence_class(pct: pl.Expr) -> pl.Expr:
    """MODIS C6 user guide classes: <30 low, 30-79 nominal, >=80 high."""
    return (
        pl.when(pct < 30).then(pl.lit("low"))
        .when(pct < 80).then(pl.lit("nominal"))
        .otherwise(pl.lit("high"))
        .cast(CONFIDENCE)
    )


def normalize(raw: pl.LazyFrame, sensor: Sensor, country: pl.Expr) -> pl.LazyFrame:
    """Map a raw FIRMS frame (all-string columns) to `SCHEMA` plus `year`/`month`."""
    f32 = pl.Float32
    hhmm = pl.col("acq_time").str.zfill(4)
    date = pl.col("acq_date").str.to_date("%Y-%m-%d", strict=True)

    if sensor.instrument == "MODIS":
        pct = pl.col("confidence").cast(pl.Int8, strict=True)
        conf_class, conf_pct = modis_confidence_class(pct), pct
    else:
        conf_class = pl.col("confidence").replace_strict(
            {"l": "low", "n": "nominal", "h": "high"}, return_dtype=CONFIDENCE
        )
        conf_pct = pl.lit(None, dtype=pl.Int8)

    out = raw.select(
        acq_datetime=(
            pl.col("acq_date") + pl.lit(" ") + hhmm
        ).str.to_datetime("%Y-%m-%d %H%M", time_unit="ms", time_zone="UTC", strict=True),
        acq_date=date,
        latitude=pl.col("latitude").cast(f32, strict=True),
        longitude=pl.col("longitude").cast(f32, strict=True),
        country=country,
        satellite=pl.col("satellite").replace_strict(_SATELLITE_NAMES, return_dtype=SATELLITES),
        instrument=pl.col("instrument").cast(INSTRUMENTS, strict=True),
        daynight=pl.col("daynight").cast(DAYNIGHT, strict=True),
        confidence_class=conf_class,
        confidence_raw=pl.col("confidence"),
        confidence_pct=conf_pct,
        frp_mw=pl.col("frp").cast(f32, strict=True),
        bt_mir_k=pl.col(sensor.bt_mir_col).cast(f32, strict=True),
        bt_tir_k=pl.col(sensor.bt_tir_col).cast(f32, strict=True),
        scan_km=pl.col("scan").cast(f32, strict=True),
        track_km=pl.col("track").cast(f32, strict=True),
        type=pl.col("type").cast(pl.Int8, strict=True),
        version=pl.col("version"),
    )
    return out.with_columns(
        year=pl.col("acq_date").dt.year().cast(pl.Int16),
        month=pl.col("acq_date").dt.month().cast(pl.Int8),
    )
