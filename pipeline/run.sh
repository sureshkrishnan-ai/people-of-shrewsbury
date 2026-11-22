#!/usr/bin/env bash
# Full map refresh: OSM + terrain (+ Census if CENSUS_API_KEY) -> town layers -> game districts.
# Caches and intermediate outputs live in $SHREWSBURY_RAW / $SHREWSBURY_OUT (defaults: pipeline/data/raw, pipeline/data/out).
set -euo pipefail
cd "$(dirname "$0")"
export SHREWSBURY_RAW=${SHREWSBURY_RAW:-$PWD/data/raw} SHREWSBURY_OUT=${SHREWSBURY_OUT:-$PWD/data/out}
UV=${UV:-uv}
$UV run python fetch_osm.py || echo "fetch_osm: some query failed (cached results are kept)"
$UV run python fetch_terrain.py
$UV run python process.py
$UV run python fetch_census.py || echo "fetch_census: skipped (set CENSUS_API_KEY)"
$UV run python districts.py
