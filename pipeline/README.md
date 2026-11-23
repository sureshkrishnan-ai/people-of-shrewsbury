# Map pipeline — real Shrewsbury, MA data for the game

The walkable districts are generated from open data, not drawn by hand. This folder turns
OpenStreetMap + USGS terrain (+ optional Census) into the files the game loads.

Originally written as an engine-independent pipeline in a sibling project (`people-of-shrewsbury`
data prep); copied here with small changes (env-var paths) plus `districts.py`, which cuts the
town-wide outputs into the game's districts.

## Sources and credit (keep these when you publish)

| Data | Source | Licence |
|---|---|---|
| Roads, buildings, water, parks, trees, businesses (POIs) | © OpenStreetMap contributors, via Overpass API | ODbL 1.0 — attribution + share-alike for the database |
| Terrain (10 m bare-earth DEM) | USGS 3D Elevation Program (3DEP), elevation.nationalmap.gov | Public domain |
| Town statistics (optional) | US Census Bureau API: ACS 5-year profile, County Business Patterns | Public domain; cite dataset + year |
| Building footprints ("roofprints") | MassGIS Building Structures (2-D) | Free, no use restrictions; credit "MassGIS (Bureau of Geographic Information)" |
| Building heights, roof shapes, trees | USGS 3DEP LiDAR MA_CentralEastern_1_2021 (via the sibling pipeline's `lidar.py` / `trees_lidar.py`) | Public domain; credit "USGS 3D Elevation Program" |
| Town-wide building heights | Overture Maps Foundation buildings (incl. Microsoft ML Buildings heights) | ODbL 1.0 — "© Overture Maps Foundation", "© OpenStreetMap contributors" |

The game credits OSM on the title screen and the `/about` page. If you add MassGIS layers, credit them too.

## Frame

`process.py` works in UTM 19N (EPSG:32619) metres relative to a town-grid origin (see `manifest.json`):
x = east, y = north, z = metres above sea level. `districts.py` converts each district to the game frame:
**x = east, z = south, y = up**, origin at the district centre, `y = 0` at its lowest ground.

## Run it

```bash
cd pipeline
uv venv && uv pip install -r pyproject.toml          # numpy, shapely, pyproj, tifffile, pillow
export SHREWSBURY_RAW=/path/to/raw SHREWSBURY_OUT=/path/to/out   # defaults: ../data/raw, ../data/out (git-ignored)
python fetch_osm.py        # Overpass, ~45 MB, cached in $SHREWSBURY_RAW (be polite: run rarely)
python fetch_terrain.py    # USGS 3DEP DEM, cached
CENSUS_API_KEY=... python fetch_census.py   # optional; free key from api.census.gov/data/key_signup.html
python process.py          # town-wide layers, tiles, economy.json, manifest.json -> $SHREWSBURY_OUT
python districts.py        # -> ../public/districts/*.json, ../src/city/data/{businesses,economy}.json
```

Districts (centre, size) are listed in `../src/city/districts.json`, shared with the game. Corridor districts
(`kind: "corridor"`: a whole street) are cut by `corridors.py` (called from `districts.py`) into an index file plus
chunk files in `public/districts/<id>/`; the docstring at the top of `corridors.py` explains the cut.
Change a centre or add a district there and re-run `districts.py`.

## Limits (be honest in the UI)

- OSM coverage of Shrewsbury buildings is partial (about 14k footprints in town); some streets show no houses.
- Building heights (`realbuildings.py`): **LiDAR** where the LiDAR pass ran (eave, ridge, roof shape, steeples), else
  **Overture** (USGS LiDAR or Microsoft ML heights, calibrated), else an estimate by type and size. Every building keeps its
  source (record field 9; `?heights=1` tints walls: LiDAR green, Overture blue, OSM yellow, estimate red).
- Roof pitch is drawn at 30–45° for LiDAR gables and hips (the fit reads low); the measured ridge height is kept.
  `complex` roofs are simplified to a gable or hip; steeples / cupolas are placed at the ridge end nearer the street (the
  LiDAR gives their height, not their exact position).
- Trees: LiDAR tree tops (real height + crown radius, conifer vs broadleaf guessed from crown shape) where the LiDAR tree
  pass ran; elsewhere OSM-mapped trees plus a scatter inside mapped woods, and the game adds decorative street trees.
- Inputs `buildings_lidar.geojson`, `buildings_overture.geojson`, `trees_lidar.geojson` come from the sibling data pipeline
  (`people-of-shrewsbury/pipeline`: `lidar.py [--all]`, `trees_lidar.py [--all]`, `overture.py`); absent files fall back to OSM.
- Business POIs: 163 in town on OSM at the last run — far fewer than really exist. That gap is
  exactly what the business-listing flow fills.
