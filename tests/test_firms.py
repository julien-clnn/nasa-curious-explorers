from pathlib import Path

import polars as pl
import pytest

from nasa_curious_explorers import firms
from nasa_curious_explorers.ingest import convert, parse_years

MODIS_CSV = """latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type
-30.7564,-67.7287,311.3,1.1,1,2024-01-01,0254,Terra,MODIS,69,61.03,289.8,12.1,N,0
-30.7548,-67.7184,318.8,1.1,1,2024-02-01,1405,Aqua,MODIS,97,61.03,289.7,19.5,D,2
-30.7548,-67.7184,318.8,1.1,1,2024-02-01,15,Aqua,MODIS,12,61.03,289.7,19.5,D,0
"""

VIIRS_CSV = """latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type
-26.68897,-61.49561,308.59,0.42,0.38,2024-01-01,0522,N20,VIIRS,n,2,292.55,1.01,N,0
-26.68897,-61.49561,308.59,0.42,0.38,2024-03-01,1730,N20,VIIRS,h,2,292.55,1.01,D,0
"""


def write(tmp: Path, name: str, content: str) -> Path:
    # A parent dir that itself looks like "<sensor>_<year>_..." must not leak into `country`.
    d = tmp / "modis_2024_countries"
    d.mkdir(exist_ok=True)
    p = d / name
    p.write_text(content)
    return p


def test_modis_normalization(tmp_path):
    f = write(tmp_path, "modis_2024_Cote_d_Ivoire.csv", MODIS_CSV)
    out = tmp_path / "out"
    assert convert([f], firms.SENSORS["modis"], 2024, out) == 3

    df = pl.read_parquet(out / "**/*.parquet", hive_partitioning=True).sort("acq_datetime")
    assert df["country"].unique().to_list() == ["Cote_d_Ivoire"]
    assert df["confidence_class"].to_list() == ["nominal", "low", "high"]
    assert df["confidence_pct"].to_list() == [69, 12, 97]
    assert df["satellite"].to_list() == ["Terra", "Aqua", "Aqua"]
    assert str(df["acq_datetime"][1]) == "2024-02-01 00:15:00+00:00"  # "15" is HHMM 0015
    assert sorted(df["month"].unique().to_list()) == [1, 2]
    assert set(firms.SCHEMA) <= set(df.columns)


def test_viirs_normalization(tmp_path):
    f = write(tmp_path, "viirs-jpss1_2024_Argentina.csv", VIIRS_CSV)
    out = tmp_path / "out"
    convert([f], firms.SENSORS["viirs-jpss1"], 2024, out)

    df = pl.read_parquet(out / "**/*.parquet").sort("acq_datetime")
    assert df["satellite"].to_list() == ["NOAA-20", "NOAA-20"]
    assert df["confidence_class"].to_list() == ["nominal", "high"]
    assert df["confidence_pct"].null_count() == 2
    assert df["bt_mir_k"][0] == pytest.approx(308.59)


def test_wrong_header_is_rejected(tmp_path):
    f = write(tmp_path, "modis_2024_Chile.csv", VIIRS_CSV)
    with pytest.raises(ValueError, match="unexpected FIRMS header"):
        convert([f], firms.SENSORS["modis"], 2024, tmp_path / "out")


def test_parse_years():
    assert parse_years("2003") == [2003]
    assert parse_years("2000-2002") == [2000, 2001, 2002]


def test_country_from_filename():
    assert firms.country_from_filename("modis/2000/modis_2000_Cote_d_Ivoire.csv") == "Cote_d_Ivoire"
