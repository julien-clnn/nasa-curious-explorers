# Web data contract

The website (`frontend/`) is static: it only reads JSON files from `frontend/public/data/`.
They are produced from `data/product/` by:

    uv run export-web            # writes frontend/public/data/

Or downloaded ready-made from the Hugging Face dataset `cexplorers/fire-activity-web`
with `uv run fetch-web-data` (and published there with `uv run upload-web-data`).

Everything below is the exact shape the frontend relies on. Arrays are **columnar**
(one array per field, aligned on an index) to keep files small. `null` always means
"no data" (no satellite delivered), never zero.

A method is always referred to by its **key** `"<id>@<version>"`, e.g.
`"hierarchical-shrinkage@1.0"`. Every harmonized value is stored under the key of the
method that produced it, so a second method can be added without changing any shape.

## `manifest.json`

```jsonc
{
  "generatedAt": "2026-11-14T16:00:00Z",
  "firstMonth": "2000-11",            // first month with data
  "lastMonth": "2025-12",             // last complete month
  "normalYears": [2003, 2022],        // seasonal normal = median of these years
  "defaultMethod": "hierarchical-shrinkage@1.0",
  "methods": [
    {
      "key": "hierarchical-shrinkage@1.0",
      "id": "hierarchical-shrinkage", "version": "1.0",
      "name": "Hierarchical shrinkage",
      "status": "shipped",                       // "shipped" | "baseline" | "experimental"
      "summary": "Factor per world → country → month → 1° cell, shrunk toward its parent.",
      "params": { "alpha": 100, "cap": 4, "calibration": [2013, 2019] },
      "scores": {                                // median abs. error %, unseen years
        "holdout": { "world": 4.0, "country": 14.2, "cell": 18.2 },   // 2020-2025
        "junction": { "world": 1.1, "country": 11.3, "cell": 16.2 }   // 2012
      }
    },
    {
      "key": "single-world-ratio@1.0",
      "id": "single-world-ratio", "version": "1.0",
      "name": "Single world ratio",
      "status": "baseline",
      "summary": "One factor per satellite for the whole planet.",
      "params": { "k": { "modis": 4.388, "terra": 13.019, "aqua": 6.621, "n20": 1.01 } },
      "scores": { "holdout": { "world": 8.2, "country": 26.6, "cell": 27.6 }, "junction": null }
    }
  ],
  "regions": [
    { "id": "world", "name": "World", "kind": "world", "bbox": [-180, -60, 180, 75] },
    { "id": "argentina", "name": "Argentina", "kind": "country", "bbox": [-73.5, -55, -53.5, -21.5] }
    // ... one per country present in country_daily; id = lower-case slug of the
    // country column ("Democratic_Republic_of_the_Congo" -> "democratic-republic-of-the-congo"),
    // name = column with "_" replaced by " "; bbox = [west, south, east, north] from its cells.
  ]
}
```

## `series/{regionId}.json` — monthly, whole record

```jsonc
{
  "region": "world",
  "months": ["2000-11", "2000-12", ...],         // every month firstMonth..lastMonth
  "days":     [30, 31, ...],                      // days in month
  "gapDays":  [0, 0, ...],                        // days with source "none"
  "modis":    [12345, ...],                       // raw Terra+Aqua hotspots
  "viirs":    [null, ..., 1600000, ...],          // raw Suomi-NPP (null before Feb 2012)
  "n20":      [null, ..., ...],                   // raw NOAA-20 (null before 2018)
  "harmonized": {                                  // VIIRS-equivalent hotspots, per method
    "hierarchical-shrinkage@1.0": [ ... ],
    "single-world-ratio@1.0": [ ... ]
  },
  "sourceDays": {                                  // how many days each source carried
    "snpp": [...], "n20": [...], "modis": [...], "terra": [...], "aqua": [...], "none": [...]
  }
}
```

Monthly harmonized = sum of the daily harmonized values of days with a source
(`none` days are left out and counted in `gapDays`). World = sum over all countries.

## `daily/{regionId}/{year}.json`

```jsonc
{
  "region": "world", "year": 2024,
  "start": "2024-01-01",                         // dates are start + index
  "source": ["snpp", "snpp", "n20", ...],        // best source that day, or "none"
  "modis": [...], "viirs": [...],
  "harmonized": { "hierarchical-shrinkage@1.0": [...], "single-world-ratio@1.0": [...] }
}
```

## `cells/{YYYY-MM}.json` — map layer, 1° grid

```jsonc
{
  "ym": "2024-08", "deg": 1,
  "lat": [ -12.5, ... ],                         // cell centre
  "lon": [ 23.5, ... ],
  "harmonized": { "hierarchical-shrinkage@1.0": [...], "single-world-ratio@1.0": [...] },
  "normal":     { "hierarchical-shrinkage@1.0": [...], "single-world-ratio@1.0": [...] }
}
```

Only cells with at least one hotspot in that month or a non-zero normal are listed.
`normal` = median of the same calendar month over `normalYears` for that cell.

## `months/{YYYY-MM}.json` — every region for one month

Used for "most unusual countries this month" without loading every series.

```jsonc
{
  "ym": "2024-08",
  "regions": ["world", "afghanistan", ...],          // same ids as manifest.regions
  "value":  { "hierarchical-shrinkage@1.0": [3424045, 12, ...], "single-world-ratio@1.0": [...] },
  "normal": { "hierarchical-shrinkage@1.0": [2622163, 30, ...], "single-world-ratio@1.0": [...] }
}
```

`value` is exactly the monthly value of `series/{region}.json` for that month (null if
unknown); `normal` is the median of the same calendar month over `normalYears`, computed
from the same monthly series.

## `cells/land.json` — background dots and click-to-select

```jsonc
{ "deg": 0.5, "lat": [...], "lon": [...], "region": [3, 3, 17, ...] }
```

Every 0.5° cell that burned at least once 2000-2025; `region` is an index into
`manifest.regions` (the country the cell belongs to), used to select a country by
clicking the map and to outline it.

## `status.json` — satellite outages

```jsonc
{ "outages": [ { "satellite": "snpp", "from": "2022-07-27", "to": "2022-08-10" }, ... ] }
```

Consecutive days on which a satellite was flagged as not delivering normally, from
`satellite_status.parquet`, while it was in service.

## `uncertainty.json`

Copied from `validation.json`: `error_bands_country_month` (ratio observed/predicted,
p10/p50/p90 by size of the predicted count) plus `anomaly_agreement`. The frontend
applies the band only to the share of a month that was converted (non-`snpp` days).

## Anomaly classes (computed in the browser)

ratio = value / normal: `< 0.5` Low, `0.5–1.5` Normal, `1.5–3` High, `≥ 3` Exceptional.

## points/ — hotspots for the globe (binary)

Written by `uv run export-points` (src/nasa_curious_explorers/export_points.py), separately from `export-web`.

| File | Grid | Content |
|---|---|---|
| `points/{YYYY-MM}.bin` | 0.05° (~5 km) | one month |
| `points/{YYYY}.bin` | 0.1° (~10 km) | one year |
| `points/index.json` | — | grid sizes and layout |

Layout, little-endian, `n` points: `n × uint16` column, then `n × uint16` row, then `n × uint16` weight.
Column = `floor((lon + 180) / deg)`, row = `floor((lat + 90) / deg)`; a point stands at its cell centre.

A detection is kept only if it comes from the satellite that carries the harmonized series that day
(Suomi-NPP, else NOAA-20, else MODIS / Terra / Aqua), with weight 1 for Suomi-NPP and otherwise the
1° cell-month factor of the shipped method. Weights are therefore VIIRS-equivalent hotspots, and the
points of a month sum to its harmonized total (checked: August 2020, 2,474,328 both ways).
Total size ≈ 370 MB for 2000-11 → 2025-12.

The globe merges points into 0.5° blocks for the world view and keeps full resolution, clipped to the
bounding box, for a country over a year.

## exact/ — every detection at its own position (binary, tiled)

Written by `uv run export-points --exact`. Used by the globe for a country over a month or a day,
so points stand where the satellite saw them instead of on a grid.

| File | Content |
|---|---|
| `exact/{YYYY-MM}/index.json` | `{"tileDeg": 10, "tiles": {"tx_ty": n, ...}}`, non-empty tiles only |
| `exact/{YYYY-MM}/{tx}_{ty}.bin` | detections of one 10° tile: `tx = floor((lon + 180) / 10)`, `ty = floor((lat + 90) / 10)` |

Tile layout, little-endian, `n` detections: `n × uint16` x, `n × uint16` y (position inside the tile,
0..65535 over 10°, steps of ~17 m), `n × uint16` weight × 100, `n × uint8` day of month.
Same selection and weights as `points/`. The browser loads only the tiles overlapping the country's
bounding box. Limits: a position is the centre of the sensor pixel (375 m VIIRS, 1 km MODIS), and the
weight still comes from the 1° cell-month factor. Total size ≈ 2 GB; not meant for git (gitignored
with the rest of `public/data/`), to host next to the site or on the dataset.
