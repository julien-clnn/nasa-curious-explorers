# Figma Make prompt — Fire Activity Calendar

> Paste everything below the line into Figma Make. All numbers in it are real results
> from `uv run harmonize` (world, 2000-2025), so the mock data is realistic.

---

Build a production-quality web application called **Fire Activity Calendar**. It is a real operational tool, not a demo or a landing page. Desktop first (1440×900), usable down to tablet (768 px). UI copy in English.

## 1. Context

Satellites have recorded active fires ("hotspots") for 25 years with two instrument families that cannot be compared directly:

- **MODIS** (Terra, Aqua): 2000 to today, 1 km pixels, being retired, orbits drifting.
- **VIIRS** (Suomi-NPP 2012-2026, NOAA-20 since 2018): 375 m pixels, sees about 4.4× more hotspots.

Chaining raw counts creates a false jump in 2012. Our pipeline converts everything into one unit, the **VIIRS-equivalent hotspot**, giving one continuous series from November 2000 to today. This app is the interface to that series. It was built for the NASA Space Apps 2026 challenge set by CONAE, the Argentine space agency.

## 2. Users and goals

1. **Fire managers and emergency analysts** (CONAE and similar agencies). Question: "Is fire activity in my region, this month, normal for the season?" They need an answer in under 10 seconds, with a number, a comparison to normal, and a stated uncertainty.
2. **Fire scientists.** Question: "Can I trust this series and reuse it?" They need the method, the validation, the limits, and a download.
3. **A hackathon jury.** They must understand the problem and see that the method is validated within one minute.

Tone: sober, precise, scientific. No decorative hero, no marketing copy, no stock imagery, no emojis.

## 3. Design principles

- Data first. Every chart has a title, units, a legend and a source line.
- Never show a harmonized number without a way to see its uncertainty and its source.
- Missing data is shown as missing (hatched cell, "No data"), never as zero.
- Sequential colorblind-safe scale for counts (light yellow to dark red). Diverging colorblind-safe scale for anomalies (blue = below normal, neutral = normal, orange to red = above). Never rely on color alone: add labels or patterns.
- Light theme by default, dark theme toggle. WCAG AA contrast. Full keyboard navigation; every chart has a "View as table" option.
- Neutral UI chrome (greys, one blue accent). Fire colors are reserved for data.
- Typography: one sans-serif (Inter), tabular numerals for all figures.

## 4. Information architecture

Top navigation bar: **Explorer** (default), **Method**, **Benchmark**, **Data**. On the right: method selector (see 9), theme toggle. A thin dismissible notice under the bar: "Suomi-NPP stopped delivering data on 2 Nov 2026. The series continues with NOAA-20."

All view state lives in the URL query string (region, year, month, source, metric, method) so any view can be shared or bookmarked.

## 5. Page: Explorer

Two-column layout: left 40 % map and region, right 60 % calendar and analytics.

**5.1 Region selector.** Searchable combobox of countries, plus "World". Clicking a country on the map selects it. Show the selected region as a chip with a clear button. Default: Argentina.

**5.2 Map.** 2D world map with pan and zoom (MapLibre GL JS if available; otherwise an SVG world map behind the same `<FireMap>` component so it can be swapped). Shows a 0.5° grid heat layer of hotspots for the month selected in the calendar. Legend with units. Toggle: "Count" / "Anomaly vs normal". Selected country outlined.

**5.3 Source toggle** (segmented control): **Harmonized** (default) · MODIS raw · VIIRS raw. When a raw source is selected, show an inline warning: "Raw counts are not comparable across sensors."

**5.4 Calendar heatmap (main element).** Rows = years 2000 to 2025, columns = Jan to Dec. Cell color = hotspots in VIIRS-equivalents, or anomaly class when the metric toggle is on "Anomaly". Hover tooltip: month, value, 80 % interval, % vs seasonal normal, anomaly class, main source. A thin vertical marker between 2011 and 2012 labelled "MODIS converted | VIIRS observed". Months with data gaps carry a small hatched corner. A "Normal" row at the bottom shows the seasonal normal (median 2003-2022). Clicking a cell selects that month.

**5.5 Daily view.** For the selected month: a calendar grid (weeks × weekdays), one cell per day, same color scale, plus a small dot coding the source of the day (S-NPP, NOAA-20, MODIS converted, none). Days with no working satellite are hatched and read "No data". Previous/next month arrows.

**5.6 Key figures** (four cards) for the selected month and region: total hotspots with 80 % interval (e.g. "18,420 · 16,900 to 22,100"); difference vs seasonal normal ("+62 %"); anomaly class badge (Low / Normal / High / Exceptional); rank ("3rd highest September of 26").

**5.7 Season chart.** Line chart of cumulative hotspots through the year for the selected year, over a shaded band (10th to 90th percentile of all years) and the median line. Up to three other years can be added for comparison.

**5.8 Long-term series.** Annual totals 2000-2025 as bars, with the three sources as selectable lines (MODIS raw, VIIRS raw, Harmonized) to make the 2012 jump and its correction visible, plus a linear trend with its slope in % per decade.

**5.9 Export.** "Download CSV" for the current region, and "Copy link".

Anomaly classes are fixed: ratio to seasonal normal below 0.5 = Low, 0.5 to 1.5 = Normal, 1.5 to 3 = High, above 3 = Exceptional.

## 6. Page: Method

Long-form, readable page with a sticky table of contents. Sections:

1. **The problem**: side-by-side MODIS vs VIIRS table, and a chart of raw world counts showing the 2012 jump (about 4.5 M MODIS vs 19 M VIIRS per year).
2. **Five steps** as a horizontal stepper: Aggregate (548 M detections into 0.5° cell-day counts) → Detect outages (a satellite is out when its world count is under 50 % of its 31-day median) → Fit factors → Validate → Publish.
3. **The conversion factor**: formula in a highlighted block: `k = (V + α · k_parent) / (M + α)`, clipped to `[k_parent / 4, k_parent × 4]`, with α = 100. V and M are VIIRS and MODIS hotspots over 2013-2019. Cascade diagram: world → country → country × month → 1° cell × month. Below it, an **interactive worked example**: three number inputs (M, V, parent k) and a live result showing raw ratio, shrunk k and capped k, with one sentence explaining the outcome.
4. **Best source of the day**: priority list S-NPP → NOAA-20 (×1.01) → MODIS converted (Terra + Aqua, else one alone) → no data. Include an outage timeline (one row per satellite, 2000-2025, gaps marked; e.g. S-NPP 27 Jul to 10 Aug 2022, Terra 11 to 23 Oct 2022).
5. **Validation**: results table and two charts (predicted vs observed scatter on log axes; error by size of the count).

| Test on unseen years | World, per month | Country, per month |
|---|---|---|
| 2012 (first VIIRS year) | 1.1 % | 11.3 % |
| 2020-2025 | 4.0 % | 14.2 % |
| Same test, single world ratio | 8.2 % | 26.6 % |
| NOAA-20 instead of S-NPP (2022-2025) | 0.9 % | 6.4 % |

   Anomaly agreement: same class in 83 % of country-months, rank correlation 0.90. Uncertainty: above 10,000 hotspots the truth is within −8 % to +20 % in 80 % of cases; under 100 hotspots it can vary threefold.
6. **Limits**, stated plainly: not reliable for a single day in a small area; MODIS misses small fires and zero cannot be converted; Terra has drifted since 2020 (−13 % bias); 27 days before mid-2002 have no data; a few local factors are very high.
7. **Sources and code**: NASA FIRMS standard-processing archives, link to the repository, licence.

## 7. Page: Benchmark

Purpose: let anyone check that the shipped configuration is the best of those tested, and see what happens when a parameter is changed. Results are precomputed; the page only reads them.

**7.1 Protocol box** at the top: "Factors are fitted on 2013-2019. Every variant is scored on years it has never seen: 2012 and 2020-2025. Error = median absolute difference between converted MODIS and observed VIIRS, per month."

**7.2 Controls.** Method (dropdown, from the method registry); test set (2012 / 2020-2025); scale (World / Country / 1° cell); error measure (Median / Weighted).

**7.3 Parameter explorer.** One chart per tunable parameter of the selected method. For α: x axis = α on a log scale (0, 10, 30, 100, 300, 1000, 3000, ∞), y axis = error %. The shipped value is marked with a vertical line and a "Shipped" label; the lowest point is marked "Best". A slider under the chart moves a cursor along the variants; a sentence updates live, e.g. "With α = 1000 instead of 100, the error per country-month rises from 14.2 % to 15.2 %." A second control toggles the cap on or off.

**7.4 Leaderboard table.** One row per variant, sortable, with columns for each scale and test set, best value per column in bold, shipped row pinned and highlighted. Include baseline rows: "Single world ratio" and "No shrinkage, no cap".

**7.5 Honest reading.** A short text block generated from the data: where the shipped variant is best, where it is tied, and where another variant wins.

Real results to use as mock data (median error %, 2020-2025 / 2012):

| α | cap | World | Country | Cell | World 2012 | Country 2012 | Cell 2012 |
|---|---|---|---|---|---|---|---|
| 0 | 4 | 2.3 | 15.5 | 19.0 | 4.6 | 13.9 | 17.5 |
| 10 | 4 | 3.1 | 14.1 | 18.5 | 1.6 | 11.8 | 16.8 |
| 30 | 4 | 3.4 | 14.3 | 18.3 | 1.2 | 11.6 | 16.5 |
| **100 (shipped)** | 4 | 4.0 | 14.2 | 18.2 | 1.1 | 11.3 | 16.2 |
| 300 | 4 | 4.4 | 14.5 | 18.5 | 0.7 | 11.6 | 16.4 |
| 1000 | 4 | 4.7 | 15.2 | 19.4 | 0.5 | 12.1 | 17.2 |
| 3000 | 4 | 4.9 | 16.0 | 20.5 | 0.4 | 12.7 | 18.3 |
| ∞ (single world ratio) | 4 | 8.2 | 26.6 | 27.6 | 5.9 | 24.7 | 25.4 |
| 0 | none | 788 | 52.6 | 19.0 | 1072 | 47.4 | 17.4 |
| 100 | none | 4.1 | 14.1 | 18.2 | 1.1 | 11.3 | 16.2 |

## 8. Page: Data

Dataset cards (country daily, cell monthly, factors, satellite status, validation report) with description, columns, size, date of last update and download button. Citation block. Changelog. Contact.

## 9. Extensibility: several harmonization methods

The app must work unchanged when a second harmonization method is added. Nothing may be hard-coded to the current one.

- A **method registry** (`methods.json`) lists methods: `id`, `name`, `version`, `summary`, `status` (`shipped` | `experimental`), `parameters` (name, label, description, shipped value, tested values, scale `linear` | `log`), and `sections` (markdown blocks for the Method page).
- The global method selector in the top bar only appears when the registry holds more than one method. Explorer, Method and Benchmark all read the selected method id.
- Every series file carries values keyed by method id. The Benchmark page builds its controls from `parameters`, and can overlay two methods on the leaderboard.
- Charts, labels and the worked example are driven by the registry. A method with no tunable parameter simply shows the leaderboard.

## 10. Data contract

Load static JSON from `/data/` through a single typed `dataClient` module. Ship realistic mock files with these exact shapes so real files can replace them without code changes.

```ts
// /data/methods.json
Method[]  // see section 9

// /data/regions.json
{ id: string; name: string; bbox: [number, number, number, number] }[]

// /data/series/{regionId}.json
{
  region: string;
  monthly: { ym: string;            // "2024-09"
             modis: number | null; viirs: number | null;
             harmonized: Record<MethodId, { value: number | null; lo: number; hi: number }>;
             mainSource: "snpp" | "n20" | "modis" | "terra" | "aqua" | "none";
             gapDays: number }[];
  daily:   { d: string;             // "2024-09-14"
             modis: number | null; viirs: number | null;
             harmonized: Record<MethodId, number | null>;
             source: "snpp" | "n20" | "modis" | "terra" | "aqua" | "none" }[];
}

// /data/cells/{ym}.json            0.5° grid for the map
{ ym: string; cells: [iy: number, ix: number, harmonized: number, normal: number][] }

// /data/status.json                satellite outages
{ satellite: "terra" | "aqua" | "snpp" | "n20"; from: string; to: string }[]

// /data/validation.json
Record<MethodId, { tests: { id: string; label: string; world: number; country: number; cell: number }[];
                   anomaly: { spearman: number; sameClassPct: number };
                   bands: { from: number; p10: number; p50: number; p90: number }[] }>

// /data/benchmark.json
{ method: MethodId; params: Record<string, number | string | null>; shipped: boolean; baseline?: string;
  scores: Record<"holdout" | "junction", Record<"world" | "country" | "cell", { median: number; weighted: number }>> }[]
```

Seasonal normal, anomaly class, rank and trend are computed in the browser from `monthly`, in one pure `analytics` module with unit-testable functions.

Realistic mock values for Argentina (harmonized annual totals): 2003 386,796 · 2008 348,318 · 2012 200,292 · 2014 119,913 · 2020 441,019 · 2022 311,794 · 2025 165,316. Peak season August to October. World: about 20 M per year.

## 11. Technical constraints

- React + TypeScript + Tailwind CSS. Recharts (or visx) for charts. No backend, no authentication: static files only.
- Components: `RegionSelector`, `SourceToggle`, `FireMap`, `CalendarHeatmap`, `DailyGrid`, `KeyFigure`, `SeasonChart`, `LongTermChart`, `Legend`, `MethodStepper`, `FormulaPlayground`, `ParameterChart`, `Leaderboard`, `DatasetCard`. Each takes data through props and holds no fetching logic.
- Loading skeletons, empty states and error states for every data-driven component.
- Internationalization from day one: English only for now, but no hard-coded UI string in components. All copy lives in `/locales/en.json` and is read through a `t("key")` helper (react-i18next or equivalent), so a language can be added by dropping in one file. Numbers, percentages and dates are formatted with `Intl.NumberFormat` and `Intl.DateTimeFormat` using the active locale.
- Number formatting with thousands separators; percentages with one decimal; dates in ISO or "Sep 2024" form.
