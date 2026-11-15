# Figma Make prompt — Fire Activity (full brief, v2)

> Paste everything below the line into Figma Make, in a new file. The brief is self-contained:
> Figma knows nothing about the project. All numbers are real outputs of our pipeline, so they can
> be used as mock data as they are.

---

Design a web application called **Fire Activity**. It is a real scientific tool, not a landing page or a demo. Desktop first (1440×900), must also work on tablet (768 px) and phone (390 px). UI copy in English.

## 1. The problem the product solves

Satellites have detected active fires ("hotspots") every day since 2000. A hotspot is one satellite pixel where a fire was burning when the satellite passed over.

Two families of instruments did this, and their counts cannot be compared directly:

- **MODIS** (satellites Terra and Aqua): from November 2000 to today. Coarse pixels (1 km), misses small fires. Being retired.
- **VIIRS** (satellites Suomi-NPP, then NOAA-20): from 2012. Fine pixels (375 m), sees about **4.4 times more hotspots** than MODIS for the same fires.

Simply putting the two together creates a false explosion of fires in 2012. Our team built a method that converts every MODIS count into what VIIRS would have seen, so 2000–2025 becomes **one continuous series**, expressed in a single unit: the **VIIRS-equivalent hotspot**. The conversion was checked on years it had never seen: the error is about 4 % for the world per month and 14 % for a country per month.

The product lets people explore this series. It was built for the NASA Space Apps 2026 challenge set by **CONAE**, the Argentine space agency, whose analysts use a "fire activity calendar" to spot unusual fire seasons.

## 2. Users and what they need

1. **Fire and emergency analysts** (CONAE and similar agencies): *"Was there more fire than usual in my region this month?"* They need an answer in under 10 seconds: a number, a comparison to the normal for that time of year, and where the fires were.
2. **Scientists**: *"Can I trust and reuse this series?"* They need the method, its validation, its limits, and downloads.
3. **A hackathon jury**: they must understand the problem and see the result within one minute.

Tone: sober, precise, beautiful. No marketing copy, no stock photos, no emojis, no decorative hero.

## 3. Key concepts to display

- **Region**: the whole World, or one country (≈ 200 countries).
- **Period**: a whole year (e.g. 2023), a month (August 2020) or a single day (14 August 2020). Data covers November 2000 to December 2025.
- **Count**: number of VIIRS-equivalent hotspots in the region during the period.
- **Normal**: the usual count for the same calendar month (median over 2003–2022). A yearly normal is the sum of the monthly normals.
- **vs normal**: count ÷ normal. Shown as "+36 %", "−45 %", or as "×90" when the ratio is 10 or more (never "+8,900 %").
- **Class**: Low (< 0.5× normal), Normal (0.5–1.5×), High (1.5–3×), Exceptional (> 3×).
- **Source of the day**: which satellite the value relies on: Suomi-NPP observed, NOAA-20 converted, MODIS converted, or none (no data).
- **Rank**: e.g. "highest August on record (1/25)".
- **Method**: the conversion method, with a name and version (e.g. "Hierarchical shrinkage v1.0"). Expert users can switch to a simpler baseline method ("Single world ratio v1.0") to compare.
- Two modes: **Simple** (default; only region, period and the answers) and **Expert** (adds method choice, raw MODIS / raw VIIRS series, uncertainty, sources, downloads).

## 4. Navigation

A slim app bar (48 px): logo "Fire Activity" · tabs **Explorer** (default), **Method**, **Benchmark**, **Data** · on the right: coverage label "FIRMS · Nov 2000 → Dec 2025", Simple / Expert switch, light/dark toggle. All view state (region, period, metric, method, mode) is reflected in the URL so any view can be shared.

## 5. Explorer page (the main screen) — full-screen globe + inspector

The page is a **full-bleed dark canvas showing a 3D globe of the Earth at night**, slowly rotating, with glowing points where fires were detected during the selected period. In the mockups, use a placeholder image of a dark night-side Earth with glowing orange/yellow points (the globe will be rendered by a map library; do not design map tiles). Everything else floats over it **as one coherent system**:

- One visual language for every overlay: dark translucent "glass" surfaces (#0B111C at ~80 % opacity, background blur, 1 px border white at 8 %), radius 12 px, an 8 px spacing grid, one type scale. No mix of white cards and dark pills.
- Overlays must leave most of the globe visible.

### Layout at 1440×900

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ App bar (48px)                                                               │
├──────────────────────────────────────────────┬───────────────────────────────┤
│ [Toolbar, one row]                           │  INSPECTOR (480 px)           │
│                                              │  header (the answer)          │
│                 GLOBE (full bleed)           │  tabs                         │
│                                              │  tab content (scrolls)        │
│ [Legend]                       [+ − ⟲]       │                               │
│ [Time bar 2000 ··········●········· 2025 ▶]  │                               │
└──────────────────────────────────────────────┴───────────────────────────────┘
```

**Toolbar** (top-left, floating, a single row, ≤ 56 px high):
- Region combobox with search ("World" first, hint "or click the globe").
- Period control: ‹ previous · label "Aug 2020" · next ›; clicking the label opens a popover with three levels: pick a year, a month, or a day in a month calendar.
- Metric switch: **Count** / **vs normal**.
- Expert mode only, grouped behind a "⋯" button so the bar stays on one row: Method picker (name, version, status badge "shipped" or "baseline", its error score), Series (Harmonized / MODIS raw / VIIRS raw; raw shows a warning "Raw counts are not comparable across sensors"), Copy link.

**Globe behaviour** (to show in the mockups):
- World view: points are small and dense; the globe rotates slowly until the user drags it.
- Hovering a country shows a tooltip: country, count, % vs normal, "click to select".
- Clicking a country (or choosing it in the toolbar) flies to it, outlines it in white, and shows the fires at full resolution (one point ≈ 5 km).
- A "← Back to world" chip appears next to the toolbar when a country is selected.

**Legend** (bottom-left, glass): title, the color ramp with its end labels, and one line explaining a point: "each point = hotspots within ~5 km, in VIIRS-equivalent units".

**Time bar** (bottom, floating across the globe area): a thin strip of the 302 months from Nov 2000 to Dec 2025, each tick colored by that month's count for the selected region (a heat strip), with a draggable handle on the selected month, a dashed marker at 2012 labelled "VIIRS starts", and a Play ▶ button that animates month by month. Users can scrub time without opening the inspector.

**Globe controls** (bottom-right): zoom in, zoom out, reset view.

**Inspector** (right, 480 px wide, full height under the app bar): collapsible to a 44 px vertical rail with icons; when collapsed the globe uses the whole width.

Inspector header, always visible — the answer in large tabular numerals:
> ARGENTINA · AUGUST 2020
> **113 k** VIIRS-eq. hotspots · **+136 %** vs normal (47.7 k) · `Exceptional` · **1/25** highest August on record
> Source: Suomi-NPP observed, 31/31 days · Method: Hierarchical shrinkage v1.0

Inspector tabs:
1. **Calendar** (default): the fire calendar (§6) and, under it, the daily strip of the selected month.
2. **Trends**: annual totals 2000–2025 as bars, with three lines that can be toggled (MODIS raw, VIIRS raw, Harmonized) to show the false 2012 jump and its correction; a cumulative "season so far" chart for the selected year over a band (10th–90th percentile of all years) and the median.
3. **Hotspots**: for the World, "Most unusual countries" this period (e.g. Argentina 2.4× · Peru 1.9×), each row clickable to fly the globe there; for a country, its busiest areas.
4. **About this figure**: 4-line summary of the method, validation scores, satellite sources used in the period, Download CSV, link to the Method page.

Every tab ends with a small mono line giving the context of the figures: region · period · method name and version · source.

## 6. The fire calendar (the heart of the product)

A grid with **rows = years 2000 → 2025** (26 rows) and **columns = January → December**. Must fit the 480 px inspector without horizontal scroll: cells about 26×18 px, 3 px gaps, 4 px radius.

- Cell color = the month's count, or its ratio to the normal (depending on the Count / vs normal switch).
- Right column "Year": a thin horizontal bar (yearly total) and the yearly value ("+12 %", "×50" or "1.44 M").
- Bottom row "Normal": a mini bar chart of the normal of each month with compact values. It shows the fire season at a glance.
- A dashed separator between 2011 and 2012 labelled "↑ MODIS converted · VIIRS observed ↓".
- Selected month: 2 px ring. Selected year: bold year label and a subtle row highlight. Clicking a cell selects that month; clicking a year label selects the whole year.
- Hover tooltip: "August 2017: 991 · ×90 vs normal (normal 11) · Exceptional · Suomi-NPP observed".
- "View as table" toggle (accessibility).

**Five cell states that must look different** (show them all in the legend):
1. **Colored**: a value that can be compared to its normal.
2. **No fires, as usual**: zero fires in a month that normally has (almost) none (Greenland in January). Empty cell with a thin outline. Never hatched, never colored.
3. **No fires** (Count mode): zero, same empty look.
4. **Too few to compare**: a handful of hotspots against a tiny normal (Greenland in June: 6 vs a normal of 2). Empty outlined cell with a small centered dot; tooltip "too few hotspots to compare".
5. **No data**: no satellite delivered (before November 2000, outages). Diagonal hatching, label "No data".

**Daily strip** under the calendar: one cell per day of the selected month, same color scale, and a 4 px dot under each day giving the satellite used (Suomi-NPP / NOAA-20 / MODIS converted / none). Previous / next month arrows.

## 7. Color

**One sequential fire scale for all fire data, from very light yellow to dark red. No blue anywhere in the data** (blue reads as cold / temperature):

`#FFF7C2 → #FFE08A → #FDBA4D → #F4892F → #E0592A → #B8321F → #7E1416 → #4A0A0E`

- **Count**: on a logarithmic scale, palest = few hotspots, darkest = most.
- **vs normal**: the same ramp on the ratio, log scale: ÷4 or less = palest, normal = middle orange, ×4 or more = darkest. "Darker = more fire than usual." The legend reads "fewer fires … normal … more fires" with a tick at normal.
- On the dark globe the same ramp is used with a soft glow; below-normal points fade out rather than glowing pale yellow.
- UI chrome is neutral (greys + one cool accent for focus and selection). Fire colors are reserved for data. Status badges (Low / Normal / High / Exceptional) use text + shape, not color alone.
- Check contrast (WCAG AA) and color-blind legibility of the ramp on both light and dark surfaces.

## 8. Other pages (light theme by default, same type and components)

**Method** — a readable long-form page with a sticky table of contents:
1. The problem: MODIS vs VIIRS comparison table; chart of raw world counts per year showing the 2012 jump (about 4.5 M MODIS vs 19 M VIIRS per year).
2. Five steps as a horizontal stepper: Aggregate (548 million detections → counts per 0.5° cell and day) → Detect satellite outages → Fit conversion factors → Validate → Publish.
3. The conversion factor: formula block `k = (V + α · k_parent) / (M + α)`, limited to `[k_parent ÷ 4, k_parent × 4]`, α = 100, where V and M are VIIRS and MODIS counts over 2013–2019. A cascade diagram world → country → country × month → 1° cell × month. An interactive worked example: inputs M, V, parent k → raw ratio, shrunk k, capped k, with one explanatory sentence.
4. Best source of the day: priority Suomi-NPP → NOAA-20 (converted) → MODIS converted (Terra + Aqua, else one) → no data; an outage timeline per satellite 2000–2025.
5. Validation table:

| Test on years never used for fitting | World, per month | Country, per month |
|---|---|---|
| 2012 (first VIIRS year) | 1.1 % | 11.3 % |
| 2020–2025 | 4.0 % | 14.2 % |
| Same test, single world ratio (baseline) | 8.2 % | 26.6 % |
| NOAA-20 instead of Suomi-NPP (2022–2025) | 0.9 % | 6.4 % |

   Converted MODIS and observed VIIRS flag the same anomaly class in 83 % of country-months (rank correlation 0.90).
6. Limits, stated plainly: not reliable for a single day in a small area; MODIS misses small fires; Terra has drifted since 2020; FIRMS labels some volcanic activity as fire (Iceland 2010, 2014, 2021–2024).

**Benchmark** — proves the chosen setting is the best tested. A protocol box ("fitted on 2013–2019, scored on 2012 and 2020–2025"); one chart of error vs α (log axis), the shipped value marked "Shipped"; a sortable leaderboard:

| α | World 2020–25 | Country 2020–25 | World 2012 | Country 2012 |
|---|---|---|---|---|
| 0 | 2.3 | 15.5 | 4.6 | 13.9 |
| 10 | 3.1 | 14.1 | 1.6 | 11.8 |
| **100 (shipped)** | 4.0 | 14.2 | 1.1 | 11.3 |
| 1000 | 4.7 | 15.2 | 0.5 | 12.1 |
| ∞ (single world ratio) | 8.2 | 26.6 | 5.9 | 24.7 |

**Data** — dataset cards (country daily, cell monthly, conversion factors, satellite status, validation report) with description, columns, size, download; a citation block.

## 9. Screens to produce

1. **Explorer · World · August 2020**, inspector open on Calendar. World: 2.47 M hotspots, −6 % vs normal, Normal, rank 19/25; most unusual: Argentina 2.4×, Peru 1.9×. Globe centered on Africa (dense fires in Angola, Congo, Zambia).
2. **Explorer · Argentina · August 2020**: globe zoomed on Argentina with fine points along the Paraná delta; header 113 k · +136 % · Exceptional · 1/25.
3. **Explorer · World · 2023 (a year)**, Trends tab: Canada 10.8× its normal year.
4. **Explorer · Greenland · August 2017**, Calendar tab showing all five cell states: 991 hotspots, ×90 vs a normal of 11 (the Sisimiut wildfire); most other months "no fires, as usual".
5. **Explorer, inspector collapsed** to its rail, time bar and legend visible, globe full width.
6. **Tablet (768 px)**: inspector becomes a bottom sheet (60 % height). **Phone (390 px)**: toolbar collapses into one "World · Aug 2020" button opening a sheet.
7. **Light theme variant of screen 1**: the globe stays dark; overlays become light glass.
8. **Method**, **Benchmark** and **Data** pages (desktop).
9. A **component sheet**: app bar, toolbar, region combobox, period popover (year / month / day), metric switch, method picker, inspector header, tabs, calendar with all five states, daily strip, legend (Count and vs normal), time bar, badges, tooltip, buttons, loading skeletons, empty and error states.

## 10. Style

- Explorer dark by default to match the night globe: background #05080F, glass surfaces, text #E8ECF3 (primary) and #93A0B4 (secondary). Other pages light by default (#F5F6F8 background, white surfaces), both themes available everywhere.
- Fonts: Inter for UI with tabular numerals for every figure; Space Grotesk for large answer numbers and page titles; JetBrains Mono for small "context / source" lines.
- Type sizes 11 / 12 / 13 / 14 / 16 / 20 / 32. Controls ≥ 32 px high (44 px on touch). Visible focus rings. Every chart has a title, units, a legend and a source line, and a "View as table" alternative.

## 11. Implementation notes (for code export)

React + TypeScript + Tailwind CSS. The globe is an empty `<FireGlobe />` component filling the canvas; toolbar, legend, time bar, controls and inspector are absolutely positioned overlays. Suggested components: `AppBar`, `Toolbar`, `RegionPicker`, `PeriodPicker`, `MetricToggle`, `MethodPicker`, `TimeBar`, `GlobeLegend`, `GlobeControls`, `Inspector`, `InspectorHeader`, `CalendarHeatmap`, `DailyStrip`, `TrendsTab`, `HotspotsTab`, `AboutTab`. Colors as CSS variables (`--fire-0` … `--fire-7`, `--glass`, `--glass-border`, `--text`, `--text-2`). No hard-coded UI strings: all copy in one `en.json` read through a `t("key")` helper; numbers and dates formatted with `Intl`.
