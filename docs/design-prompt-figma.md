# Curious Explorers — Fire Activity Calendar: design brief

Create **3 distinct design proposals** (A, B, C below) for the same desktop web app, 1440×900, one frame per proposal. All three must share the same content and features; only the art direction changes.

## Context

This app is built for the NASA Space Apps 2026 challenge proposed by CONAE, the Argentine space agency.

Satellites have been detecting active fires, called "hotspots", for 25 years, using two different sensors:

- **MODIS**: from 2000 to today, 1 km pixels, now being retired.
- **VIIRS**: from 2012 to today, 375 m pixels, detects about 4–5× more hotspots than MODIS.

Because the two sensors do not count fires the same way, their data cannot be compared directly. The app merges both into one consistent, **harmonized** time series. With it, fire managers can see when and where fires happen, and spot trends, seasonal patterns and anomalies.

## Users

- Fire managers and scientists (CONAE, emergency response teams).
- A hackathon jury: the first screen must be visually striking and understandable within 5 seconds.

## Main screen

Build a single page. Do not add a marketing landing page.

1. **Globe.** A simplified 3D Earth globe is the hero element. A stylized look is fine: dotted, low-poly or flat-shaded. Fire hotspots appear as glowing points or heat clusters. The user can rotate the globe and click a region (a country or a drawn area) to select it.
2. **Fire activity calendar.** It sits next to the globe and shows data for the selected region:
   - A year × month heatmap: rows are the years 2000–2025, columns are January–December, and color intensity shows the number of hotspots.
   - Clicking a month opens a daily view: a calendar grid of that month, with one cell per day.
   - Anomalies, meaning months or days much higher than the seasonal normal, are highlighted.
3. **Timeline.** A date selector from 2000 to 2026 drives both the globe and the calendar.
4. **Data source toggle.** It offers three options: MODIS, VIIRS and Harmonized. Harmonized is the default and should feel like the hero feature.
5. **Key figures** for the current selection:
   - total hotspots;
   - peak month;
   - difference vs. the 25-year average;
   - trend, shown as a sparkline.

## Realistic sample content

- Selected region: Argentina. The peak fire season runs from August to October.
- Example figure: "Sep 2024 — 18,420 hotspots, +62% vs. seasonal average".
- World scale: about 4.4 million MODIS hotspots per year, and about 20 million VIIRS hotspots per year.
- Info banner: "Suomi NPP stopped sending data on Nov 2, 2026 — continuity now relies on NOAA-20 and NOAA-21."

## Constraints

- **Data visualization comes first.** Use a sequential, colorblind-friendly color scale for intensity, with a clear legend and units.
- **Clean component structure.** Build cards, the toggle, chips and the legend as reusable components, so the design can be implemented as a real web app (React, with three.js for the globe).
- No stock photos.
- All UI copy in English.

## Proposal A — "Mission Control"

- **Mood:** a satellite operations console. Precise, dense, calm.
- **Background:** dark space theme, near-black navy with a subtle star field.
- **Globe:** glows in the center-left, with orange-to-yellow fire clusters.
- **Data panels:** on the right, in thin-bordered dark cards.
- **Typography:** monospace numbers and small uppercase labels.
- **Colors:** cyan accents for UI controls. Fire colors (amber to red) are reserved for data.

## Proposal B — "Editorial Atlas"

- **Mood:** a National Geographic data story, with generous whitespace.
- **Background:** light and warm, like paper.
- **Typography:** elegant serif headings, with a clean sans-serif for the UI.
- **Globe:** drawn like a scientific atlas illustration, with fine graticule lines, muted land, and fire hotspots as small red-orange dots.
- **Calendar:** the star of this proposal. Present the year × month heatmap as a beautiful, magazine-quality chart, and offer a radial view of the fire season (a circular ring of 12 months) as an alternative.

## Proposal C — "Ember & Glass"

- **Mood:** cinematic and modern, made to impress a jury on a big screen.
- **Layout:** full-bleed and immersive, with a large globe partially cropped on the right edge.
- **Background:** deep night blue, with an ember-orange atmospheric glow around the planet.
- **Panels:** the calendar, key figures and source toggle sit in floating glassmorphism panels on the left (blurred and translucent).
- **Timeline:** a bold timeline scrubber along the bottom, with a stacked area sparkline comparing the MODIS, VIIRS and Harmonized curves.
