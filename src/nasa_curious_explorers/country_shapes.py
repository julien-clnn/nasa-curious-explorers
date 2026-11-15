"""Country outlines for the web map, keyed by our region ids.

The map colours whole countries instead of 1° cells. Outlines come from Natural Earth
(1:50m admin-0, public domain); each feature gets the id of the matching FIRMS region
(the slug of its name, as in manifest.json). Coordinates are rounded to 0.05° and
repeated points dropped, which keeps the file small while staying sharp at country zoom.

    uv run country-shapes                       # download Natural Earth, write frontend/public/geo/countries.json
    uv run country-shapes --source ne50.geojson # use a local copy
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
import urllib.request
from pathlib import Path

NE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson"
ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "frontend/public/data/manifest.json"
OUT = ROOT / "frontend/public/geo/countries.json"
STEP = 0.05

# Natural Earth name -> FIRMS region id, where the names differ.
ALIASES = {
    "Cabo Verde": "cape-verde",
    "North Macedonia": "macedonia-former-yugoslav-republic-of",
    "Republic of the Congo": "republic-of-congo",
    "eSwatini": "swaziland",
    "Somaliland": "somalia",
    "Northern Cyprus": "cyprus",
}
NAME_FIELDS = ["ADMIN", "NAME", "NAME_LONG", "GEOUNIT", "SOVEREIGNT", "FORMAL_EN", "NAME_SORT", "BRK_NAME", "NAME_CIAWF"]


def slug(s: str) -> str:
    ascii_ = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", ascii_).strip("-")


def region_id(props: dict, ids: set[str]) -> str | None:
    if props["ADMIN"] in ALIASES:
        return ALIASES[props["ADMIN"]]
    for k in NAME_FIELDS:
        v = props.get(k)
        if v and slug(v) in ids:
            return slug(v)
    return None


def simplify_ring(ring: list[list[float]]) -> list[list[float]] | None:
    out: list[list[float]] = []
    for x, y in ring:
        p = [round(round(x / STEP) * STEP, 2), round(round(y / STEP) * STEP, 2)]
        if not out or out[-1] != p:
            out.append(p)
    if out[0] != out[-1]:
        out.append(out[0])
    return out if len(out) >= 4 else None


def simplify(geom: dict) -> dict | None:
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    kept = []
    for poly in polys:
        rings = [r for r in (simplify_ring(r) for r in poly) if r]
        if rings and rings[0]:
            kept.append(rings)
    if not kept:
        return None
    return {"type": "MultiPolygon", "coordinates": kept}


def build(source: dict, ids: set[str]) -> tuple[dict, list[str]]:
    features, missing = [], []
    for f in source["features"]:
        rid = region_id(f["properties"], ids)
        if rid is None:
            missing.append(f["properties"]["ADMIN"])
            continue
        geom = simplify(f["geometry"])
        if geom:
            features.append({"type": "Feature", "properties": {"id": rid}, "geometry": geom})
    return {"type": "FeatureCollection", "features": features}, missing


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="country-shapes", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--source", type=Path, help="local Natural Earth 50m admin-0 GeoJSON (default: download)")
    p.add_argument("--manifest", type=Path, default=MANIFEST)
    p.add_argument("--out", type=Path, default=OUT)
    args = p.parse_args(argv)

    if args.source:
        source = json.loads(args.source.read_text())
    else:
        with urllib.request.urlopen(NE_URL) as r:
            source = json.load(r)
    ids = {r["id"] for r in json.loads(args.manifest.read_text())["regions"] if r["kind"] == "country"}
    fc, missing = build(source, ids)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(fc, separators=(",", ":")))
    covered = {f["properties"]["id"] for f in fc["features"]}
    print(f"{len(fc['features'])} outlines for {len(covered)}/{len(ids)} regions -> {args.out} ({args.out.stat().st_size / 1e6:.2f} MB)")
    print(f"  Natural Earth features without a region: {', '.join(missing) or 'none'}")
    print(f"  regions without an outline: {', '.join(sorted(ids - covered)) or 'none'}")


if __name__ == "__main__":
    main()
