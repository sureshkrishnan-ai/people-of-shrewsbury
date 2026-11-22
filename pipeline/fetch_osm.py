"""Fetch OpenStreetMap data for the Town of Shrewsbury, MA from Overpass (cached).

Two polite queries: (1) the town boundary relation, (2) all features in the
boundary's bounding box (+300 m). Results cached under data/raw/.
"""
import json, sys, time, urllib.parse, urllib.request
from pathlib import Path

import os
RAW = Path(os.environ.get("SHREWSBURY_RAW", Path(__file__).resolve().parent.parent / "data" / "raw"))
URL = os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter")
UA = "people-of-shrewsbury-pipeline/0.1 (open-data map project)"

def overpass(q: str, out: Path):
    if out.exists():
        print("cached", out); return json.loads(out.read_text())
    data = urllib.parse.urlencode({"data": q}).encode()
    req = urllib.request.Request(URL, data=data, headers={"User-Agent": UA})
    t = time.time()
    with urllib.request.urlopen(req, timeout=600) as r:
        body = r.read()
    out.write_bytes(body)
    print(f"fetched {out.name} {len(body)/1e6:.1f} MB in {time.time()-t:.0f}s")
    return json.loads(body)

BOUNDARY_Q = """[out:json][timeout:120];
area["name"="Massachusetts"]["admin_level"="4"]->.ma;
rel(area.ma)["boundary"="administrative"]["admin_level"="8"]["name"="Shrewsbury"];
out geom;"""

def main():
    RAW.mkdir(parents=True, exist_ok=True)
    b = overpass(BOUNDARY_Q, RAW / "boundary.json")
    rels = [e for e in b["elements"] if e["type"] == "relation"]
    assert len(rels) == 1, f"expected one relation, got {len(rels)}"
    bb = rels[0]["bounds"]
    pad = 0.004
    s, w, n, e = bb["minlat"]-pad, bb["minlon"]-pad, bb["maxlat"]+pad, bb["maxlon"]+pad
    print("bbox", s, w, n, e)
    time.sleep(30)
    q = f"""[out:json][timeout:600][bbox:{s},{w},{n},{e}];
(
  way["building"]; rel["building"];
  way["building:part"];
  way["highway"];
  way["railway"];
  way["natural"]; rel["natural"];
  way["water"]; rel["water"];
  way["waterway"];
  way["landuse"]; rel["landuse"];
  way["leisure"]; rel["leisure"];
  way["amenity"]; node["amenity"];
  node["natural"="tree"];
  node["place"]; node["shop"]; node["tourism"]; node["historic"];
  way["historic"]; way["tourism"]; way["shop"];
);
out geom qt;"""
    overpass(q, RAW / "features.json")
    if not (RAW / "offices.json").exists():
        time.sleep(15)
    q2 = f"""[out:json][timeout:180][bbox:{s},{w},{n},{e}];
(node["office"]; way["office"]; node["craft"]; way["craft"]; node["healthcare"]; way["healthcare"];);
out center tags;"""
    overpass(q2, RAW / "offices.json")

if __name__ == "__main__":
    main()
