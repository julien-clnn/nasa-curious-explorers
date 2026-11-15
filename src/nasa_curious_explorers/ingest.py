"""Ingest NASA FIRMS hotspots into a Hive-partitioned Parquet dataset.

    uv run firms world                                  # every sensor, every year (~10 GB download)
    uv run firms world --sensor modis --years 2000-2002
    uv run firms country Argentina Chile --years 2020   # small-scale sample, separate folder
    uv run firms publish                                # push to the Hugging Face dataset
    uv run firms publish --only product                 # only the harmonized layer

Output layout (one run per sensor/year, re-runs replace that partition):

    data/detections/sensor=modis/year=2003/month=7/*.parquet
    data/manifests/detections/modis_2003.json           # provenance + row counts

Downloads are streamed to data/_tmp and deleted once converted, so disk usage stays
at roughly one yearly zip plus the Parquet output.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import httpx
import polars as pl

from nasa_curious_explorers import firms

DATA_DIR = Path("data")
TMP_DIR = DATA_DIR / "_tmp"
HF_REPO = "cexplorers/firms-hotspots"
LAST_YEAR = 2025  # last complete year of FIRMS standard-processing yearly files


# --------------------------------------------------------------------------- download


def download(url: str, dest: Path, client: httpx.Client) -> bool:
    """Stream `url` to `dest`. Returns False on 404 (file not published)."""
    part = dest.with_suffix(dest.suffix + ".part")
    with client.stream("GET", url) as r:
        if r.status_code == 404:
            return False
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        done, next_report = 0, 0.0
        with part.open("wb") as fh:
            for chunk in r.iter_bytes(1 << 20):
                fh.write(chunk)
                done += len(chunk)
                if total and done / total >= next_report:
                    print(f"\r  {dest.name}: {done / 1e6:,.0f}/{total / 1e6:,.0f} MB", end="", flush=True)
                    next_report += 0.1
    if total:
        print()
    part.rename(dest)
    return True


# --------------------------------------------------------------------------- convert


def convert(csv_files: list[Path], sensor: firms.Sensor, year: int, out: Path) -> int:
    """Normalize the CSVs of one sensor/year and write them under out/sensor=/year=/."""
    expected = list(firms.raw_schema(sensor))
    for f in csv_files[:1]:
        header = f.open().readline().strip().split(",")
        if header != expected:
            raise ValueError(f"unexpected FIRMS header in {f.name}: {header}")

    raw = pl.scan_csv(csv_files, infer_schema=False, include_file_paths="_path")
    country = pl.col("_path").str.extract(r"_\d{4}_([^/\\]+)\.csv$", 1)  # file name only, not dirs
    lf = firms.normalize(raw, sensor, country).filter(pl.col("year") == year).drop("year")

    target = out / f"sensor={sensor.key}" / f"year={year}"
    if target.exists():
        shutil.rmtree(target)
    lf.sink_parquet(pl.PartitionBy(target, key="month", include_key=False), mkdir=True)
    return pl.scan_parquet(target / "**/*.parquet").select(pl.len()).collect().item()


def write_manifest(out: Path, sensor: firms.Sensor, year: int, **info) -> None:
    path = DATA_DIR / "manifests" / out.name / f"{sensor.key}_{year}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    info |= {"sensor": sensor.key, "year": year, "ingested_at": datetime.now(UTC).isoformat()}
    path.write_text(json.dumps(info, indent=2) + "\n")


def manifest_exists(out: Path, sensor: firms.Sensor, year: int) -> bool:
    return (DATA_DIR / "manifests" / out.name / f"{sensor.key}_{year}.json").exists()


# --------------------------------------------------------------------------- jobs


def ingest_world(sensor: firms.Sensor, year: int, out: Path, client: httpx.Client) -> None:
    url = firms.world_zip_url(sensor.key, year)
    work = TMP_DIR / f"{sensor.key}_{year}"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    try:
        zip_path = work / "all_countries.zip"
        if not download(url, zip_path, client):
            print(f"  {sensor.key} {year}: not published, skipped")
            return
        with zipfile.ZipFile(zip_path) as zf:
            members = [m for m in zf.namelist() if m.endswith(".csv")]
            zf.extractall(work / "csv", members)
        zip_bytes = zip_path.stat().st_size
        zip_path.unlink()
        csv_files = sorted((work / "csv").rglob("*.csv"))
        rows = convert(csv_files, sensor, year, out)
        write_manifest(out, sensor, year, source=url, zip_bytes=zip_bytes, country_files=len(csv_files), rows=rows)
        print(f"  {sensor.key} {year}: {rows:,} hotspots from {len(csv_files)} country files")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def ingest_countries(
    sensor: firms.Sensor, year: int, countries: list[str], out: Path, client: httpx.Client
) -> None:
    work = TMP_DIR / f"{sensor.key}_{year}_countries"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    try:
        files, missing = [], []
        for c in countries:
            url = firms.country_url(sensor.key, year, c)
            dest = work / url.rsplit("/", 1)[-1]
            (files if download(url, dest, client) else missing).append(dest if dest.exists() else c)
        if missing:
            print(f"  {sensor.key} {year}: no file for {', '.join(map(str, missing))}")
        if not files:
            return
        rows = convert(files, sensor, year, out)
        write_manifest(out, sensor, year, countries=countries, missing=[str(m) for m in missing], rows=rows)
        print(f"  {sensor.key} {year}: {rows:,} hotspots ({', '.join(countries)})")
    finally:
        shutil.rmtree(work, ignore_errors=True)


# What `firms publish` can send, as glob patterns relative to data/.
PUBLISH_SETS = {
    "detections": ["detections/**/*.parquet", "manifests/detections/*.json"],  # raw hotspots, ~8 GB
    "product": ["product/*.parquet", "product/**/*.parquet", "product/*.json"],  # output of `uv run harmonize`, ~230 MB
}


def publish(repo_id: str, private: bool, only: str | None = None) -> None:
    from huggingface_hub import HfApi

    api = HfApi()
    api.create_repo(repo_id, repo_type="dataset", private=private, exist_ok=True)
    # With hf_xet (huggingface_hub >= 2), upload_folder streams, splits the ~8 GB into
    # several commits and resumes an interrupted upload when re-run.
    api.upload_folder(
        repo_id=repo_id,
        repo_type="dataset",
        folder_path=DATA_DIR,
        allow_patterns=[p for name in ([only] if only else PUBLISH_SETS) for p in PUBLISH_SETS[name]],
        commit_message=f"Upload FIRMS {only or 'detections and product'}",
    )


# --------------------------------------------------------------------------- CLI


def parse_years(spec: str) -> list[int]:
    """`2003` -> [2003]; `2000-2002` -> [2000, 2001, 2002]."""
    lo, _, hi = spec.partition("-")
    return list(range(int(lo), int(hi or lo) + 1))


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="firms", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    def add_common(sp: argparse.ArgumentParser, default_out: str) -> None:
        sp.add_argument("--sensor", choices=list(firms.SENSORS), action="append", help="repeatable; default: all")
        sp.add_argument("--years", type=parse_years, help=f"YYYY or YYYY-YYYY; default: first available-{LAST_YEAR}")
        sp.add_argument("--out", type=Path, default=DATA_DIR / default_out)
        sp.add_argument("--force", action="store_true", help="re-ingest partitions that already have a manifest")

    add_common(sub.add_parser("world", help="all countries, from the yearly zips"), "detections")
    sp_c = sub.add_parser("country", help="a few countries, from the per-country CSVs")
    sp_c.add_argument("countries", nargs="+", help="FIRMS file names, e.g. Argentina United_States")
    add_common(sp_c, "detections_sample")
    sp_p = sub.add_parser("publish", help="upload data/detections and data/manifests to Hugging Face")
    sp_p.add_argument("--repo", default=HF_REPO)
    sp_p.add_argument("--private", action="store_true")
    sp_p.add_argument("--only", choices=list(PUBLISH_SETS), help="send one set only; default: all")

    args = p.parse_args(argv)
    if args.cmd == "publish":
        publish(args.repo, args.private, args.only)
        return

    sensors = [firms.SENSORS[s] for s in (args.sensor or firms.SENSORS)]
    with httpx.Client(timeout=httpx.Timeout(60, read=300), follow_redirects=True) as client:
        for sensor in sensors:
            years = [y for y in (args.years or range(sensor.first_year, LAST_YEAR + 1)) if y >= sensor.first_year]
            for year in years:
                if not args.force and manifest_exists(args.out, sensor, year):
                    print(f"  {sensor.key} {year}: already ingested, skipped (--force to redo)")
                    continue
                if args.cmd == "world":
                    ingest_world(sensor, year, args.out, client)
                else:
                    ingest_countries(sensor, year, args.countries, args.out, client)


if __name__ == "__main__":
    sys.exit(main())
