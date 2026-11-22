"""Shared constants: projection and town grid."""
import json, os
from pathlib import Path
from pyproj import Transformer

ROOT = Path(__file__).resolve().parent.parent
RAW = Path(os.environ.get("SHREWSBURY_RAW", ROOT / "data" / "raw"))
OUT = Path(os.environ.get("SHREWSBURY_OUT", ROOT / "data" / "out"))
EPSG = 32619  # WGS84 / UTM zone 19N
to_utm = Transformer.from_crs(4326, EPSG, always_xy=True)
to_ll = Transformer.from_crs(EPSG, 4326, always_xy=True)
TILE = 500.0   # metres
CELL = 10.0    # terrain grid spacing (m)

def town_bbox_ll():
    b = json.loads((RAW / "boundary.json").read_text())
    r = [e for e in b["elements"] if e["type"] == "relation"][0]["bounds"]
    pad = 0.004
    return r["minlon"]-pad, r["minlat"]-pad, r["maxlon"]+pad, r["maxlat"]+pad

def grid_origin():
    """UTM origin (x0, y0) of the town grid, snapped to the tile size, and size in tiles."""
    w, s, e, n = town_bbox_ll()
    xs, ys = to_utm.transform([w, e, w, e], [s, s, n, n])
    x0 = (min(xs) // TILE) * TILE; y0 = (min(ys) // TILE) * TILE
    nx = int((max(xs) - x0) // TILE) + 1; ny = int((max(ys) - y0) // TILE) + 1
    return x0, y0, nx, ny
