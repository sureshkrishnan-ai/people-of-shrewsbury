"""Fetch USGS 3DEP bare-earth DEM (public domain) for the town grid at 10 m, UTM 19N."""
import time, urllib.parse, urllib.request
from common import RAW, grid_origin, TILE, CELL, EPSG

URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"

def main():
    x0, y0, nx, ny = grid_origin()
    out = RAW / "dem_10m.tif"
    if out.exists(): print("cached", out); return
    # grid samples at cell centres-> use edges such that pixel count = extent/CELL + 1
    W = int(nx * TILE / CELL) + 1; H = int(ny * TILE / CELL) + 1
    half = CELL / 2
    p = dict(bbox=f"{x0-half},{y0-half},{x0+nx*TILE+half},{y0+ny*TILE+half}", bboxSR=EPSG, imageSR=EPSG,
             size=f"{W},{H}", format="tiff", pixelType="F32", interpolation="RSP_BilinearInterpolation",
             f="image")
    url = URL + "?" + urllib.parse.urlencode(p)
    print(url)
    t = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": "people-of-shrewsbury-pipeline/0.1"})
    with urllib.request.urlopen(req, timeout=300) as r: body = r.read()
    out.write_bytes(body); print(f"DEM {W}x{H} {len(body)/1e6:.1f} MB {time.time()-t:.0f}s")

if __name__ == "__main__": main()
