# Data sources (People of Shrewsbury pipeline)

Raw downloads live in `data/raw` -> `/data/shrewsbury-data/raw`; outputs in `out` -> `/data/shrewsbury-data/out`.
Both are git-ignored and fully regenerable with `pipeline/run.sh`.

| Data | Source | Fetched | Licence / attribution |
|---|---|---|---|
| Town boundary (OSM relation 1844192, admin_level=8 "Shrewsbury", Worcester County) | OpenStreetMap via Overpass API (`boundary.json`) | 2026-11-22 | ODbL — "© OpenStreetMap contributors" |
| Buildings, roads, paths, water, waterways, landuse, parks, trees, POIs | OpenStreetMap via Overpass (one bbox query, `features.json`, 44 MB) | 2026-11-22 | ODbL — "© OpenStreetMap contributors" |
| Office / craft / healthcare POIs | OpenStreetMap via Overpass (`offices.json`) | NOT YET — Overpass returned 502/504 on three servers; re-run `fetch_osm.py` | ODbL |
| Terrain | USGS 3DEP bare-earth DEM, `3DEPElevation/ImageServer/exportImage`, resampled to a 10 m UTM 19N grid (`dem_10m.tif`) | 2026-11-22 | Public domain (USGS); credit "USGS 3D Elevation Program" |
| Census ACS 5-year profile (population, income, employment by industry) + County Business Patterns ZIP 01545 | api.census.gov (`fetch_census.py`) | NOT YET — the API now requires a free key; set `CENSUS_API_KEY` | Public domain (US Census Bureau); cite dataset + year |
| BLS (LAUS / QCEW) | — | not fetched; placeholder in `census.json` | Public domain |

## Building heights
- OSM: only 88 of 23,296 buildings carry `building:levels` (none usable `height`). Those use levels x 3 m + roof.
- All others are **estimates** by type/size (house 7.5 m, shed/garage 3.2 m, commercial 7–9 m, industrial 9 m,
  apartments 11 m, school/civic 10 m, church 11 m). Every building has `height_source` = `osm_height` | `osm_levels` | `estimate`.
- MassGIS Building Structures (2-D) footprints and MassGIS/USGS LiDAR (first-return DSM, which could give real roof
  heights as DSM − DEM) were **not** used in v0. That is the main upgrade path for heights.

## Not real / approximations
- Trees: 515 OSM-mapped trees + ~14k trees scattered on a jittered 14 m grid inside OSM `natural=wood`/`landuse=forest`
  (`source: scatter`). OSM maps little of the town's woodland, so this undercounts forest.
- Gable roofs are assigned to small near-rectangular house-like footprints; ridge along the long side (not surveyed).
- Business categories are a mapping of OSM tags (`pipeline/categories.py`), not an official classification.
- Area summaries use simple buffers: Town Center = 700 m around the OSM `place=town` node; Route 9 / Route 20 = 250 m
  either side of ways with `ref` MA 9 / US 20, clipped to the town.
