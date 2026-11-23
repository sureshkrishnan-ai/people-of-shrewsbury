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
| (planned) parcels / building footprints | MassGIS | Check the layer's terms before use |

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
- Building heights are mostly **estimates** from footprint size and type (only ~90 have OSM levels).
- Roof shape: gable vs flat is a heuristic; ridge direction follows the footprint's long side.
- Trees: OSM-mapped trees plus a scatter inside mapped woods; the game adds decorative street trees.
- Business POIs: 163 in town on OSM at the last run — far fewer than really exist. That gap is
  exactly what the business-listing flow fills.
