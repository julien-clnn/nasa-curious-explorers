"""Download the globe's imagery once, so the site does not depend on NASA's servers.

    uv run fetch-tiles             # zoom 0-5, day + night -> frontend/public/data/tiles
    uv run fetch-tiles --max-zoom 4

Two NASA GIBS layers in Web Mercator 256 px tiles:
    day/   Blue Marble Next Generation (light theme), JPEG as served
    night/ VIIRS Black Marble 2016 (dark theme), served as PNG (~70 kB), re-encoded to JPEG

Zoom 0-5 is enough for the world view and most countries (1365 tiles per layer, about
40 MB in all). Deeper zooms still come from GIBS when online: the frontend stacks a remote
source above the local one, so offline it just stays a bit blurrier.
Already downloaded tiles are skipped, so the command can be re-run.
"""

from __future__ import annotations

import argparse
import io
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
from PIL import Image

GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best"
LAYERS = {
    "day": f"{GIBS}/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{{z}}/{{y}}/{{x}}.jpeg",
    "night": f"{GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{{z}}/{{y}}/{{x}}.png",
}
OUT = Path("frontend/public/data/tiles")


def fetch(client: httpx.Client, layer: str, z: int, y: int, x: int) -> int:
    path = OUT / layer / str(z) / str(y) / f"{x}.jpg"
    if path.exists():
        return 0
    r = client.get(LAYERS[layer].format(z=z, y=y, x=x))
    r.raise_for_status()
    data = r.content
    if layer == "night":
        buf = io.BytesIO()
        Image.open(io.BytesIO(data)).convert("RGB").save(buf, "JPEG", quality=82, optimize=True)
        data = buf.getvalue()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return len(data)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--max-zoom", type=int, default=5)
    args = ap.parse_args()
    jobs = [(layer, z, y, x) for layer in LAYERS for z in range(args.max_zoom + 1) for y in range(2**z) for x in range(2**z)]
    total = 0
    with httpx.Client(timeout=30, headers={"User-Agent": "fire-calendar-tile-cache"}) as client, ThreadPoolExecutor(6) as pool:
        for i, n in enumerate(pool.map(lambda j: fetch(client, *j), jobs), 1):
            total += n
            if i % 200 == 0 or i == len(jobs):
                print(f"{i}/{len(jobs)} tiles, {total / 1e6:.1f} MB new", file=sys.stderr)


if __name__ == "__main__":
    main()
