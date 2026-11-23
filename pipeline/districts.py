"""Cut the town-wide pipeline outputs into one compact file per walkable district.

Reads   $SHREWSBURY_OUT (default data/out): manifest.json, terrain_u16.bin, geojson/*.geojson,
        economy.json, census.json  (written by process.py / fetch_census.py)
        src/city/districts.json    (the district list, shared with the game)
Writes  public/districts/<id>.json  one file per district, loaded by the game when you enter it
        src/city/data/businesses.json  every OSM business / civic POI in town, with its district
        src/city/data/economy.json     counts for the /economy page (category, district, census)

Game frame: x = east, z = SOUTH (three.js: -z is north), y = up, metres, origin = district centre,
y = 0 at the district's lowest terrain sample. Coordinates are stored as integer decimetres (dm).

Data: (c) OpenStreetMap contributors, ODbL. Terrain: USGS 3DEP (public domain).
"""
import json, math, sys
from pathlib import Path

import numpy as np
from shapely.geometry import LineString, Point, Polygon, box, mapping, shape
from shapely.ops import unary_union

from common import OUT

FORK = Path(__file__).resolve().parent.parent
CFG = json.loads((FORK / "src" / "city" / "districts.json").read_text())["districts"]
DST = FORK / "public" / "districts"
DATA = FORK / "src" / "city" / "data"
man = json.loads((OUT / "manifest.json").read_text())
T = man["terrain"]
terr = np.frombuffer((OUT / T["file"]).read_bytes(), dtype="<u2").reshape(T["h"], T["w"]).astype(np.float64) * T["scale"] + T["min"]
CELL = T["cell"]


def zat(x, y):
    fx = min(max(x / CELL, 0), T["w"] - 1.001); fy = min(max(y / CELL, 0), T["h"] - 1.001)
    ix, iy = int(fx), int(fy); tx, ty = fx - ix, fy - iy
    a, b, c, d = terr[iy, ix], terr[iy, ix + 1], terr[iy + 1, ix], terr[iy + 1, ix + 1]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def load(name):
    p = OUT / "geojson" / f"{name}.geojson"
    return json.loads(p.read_text())["features"] if p.exists() else []


buildings, roads, water, landuse, trees, pois = (load(n) for n in ("buildings", "roads", "water", "landuse", "trees", "pois"))
CATS = man["categories"]
ROAD_CLASSES = man["road_classes"]
# Paths are drawn narrower and paler; tracks and bridleways are dropped (mostly in the woods).
SKIP_ROADS = {"bridleway", "track", "proposed", "construction", "raceway", "abandoned"}
PATHS = {"footway", "path", "pedestrian", "cycleway", "steps"}
LANDUSE_KEEP = ["park", "grass", "sports", "cemetery", "golf", "school", "parking", "wood", "wetland", "farmland", "sand"]


def dm(v): return int(round(v * 10))


def district_of(x, y):
    for d in CFG:
        if d.get("kind") == "corridor": continue
        cx, cy = d["centre"]; h = d["half"]
        if abs(x - cx) <= h and abs(y - cy) <= h: return d["id"]
    return None


def colliders_for(poly, gx):
    """Axis-aligned boxes covering a footprint (1 m strips merged vertically), in game dm [x0,z0,x1,z1]."""
    minx, miny, maxx, maxy = poly.bounds
    if (maxx - minx) * (maxy - miny) < 1.5 * poly.area:  # nearly axis-aligned: one box (shrunk a little)
        return [[dm(gx(minx) + 0.15), dm(-(maxy - gx.cy) + 0.15), dm(gx(maxx) - 0.15), dm(-(miny - gx.cy) - 0.15)]]
    out, prev = [], None
    y = miny
    while y < maxy:
        y1 = min(y + 1.0, maxy)
        part = poly.intersection(box(minx - 1, y, maxx + 1, y1))
        spans = []
        for g in getattr(part, "geoms", [part]):
            if g.is_empty or g.area < 0.05: continue
            b = g.bounds; spans.append((round(b[0], 1), round(b[2], 1)))
        spans.sort()
        if prev and len(prev["spans"]) == len(spans) and all(abs(a[0] - b[0]) < 0.4 and abs(a[1] - b[1]) < 0.4 for a, b in zip(prev["spans"], spans)):
            prev["y1"] = y1
            prev["spans"] = [(min(a[0], b[0]), max(a[1], b[1])) for a, b in zip(prev["spans"], spans)]
        else:
            if prev: out.append(prev)
            prev = {"y0": y, "y1": y1, "spans": spans}
        y = y1
    if prev: out.append(prev)
    res = []
    for r in out:
        for x0, x1 in r["spans"]:
            res.append([dm(gx(x0)), dm(-(r["y1"] - gx.cy)), dm(gx(x1)), dm(-(r["y0"] - gx.cy))])
    return res


class GX:
    def __init__(self, cx, cy): self.cx, self.cy = cx, cy
    def __call__(self, x): return x - self.cx


def ring_dm(coords, cx, cy):
    return [v for x, y in coords for v in (dm(x - cx), dm(-(y - cy)))]


def build(d):
    cx, cy = d["centre"]; h = d["half"]
    win = box(cx - h, cy - h, cx + h, cy + h)
    pad = box(cx - h - 40, cy - h - 40, cx + h + 40, cy + h + 40)  # draw a little beyond the walkable edge
    gx = GX(cx, cy)
    # terrain grid (10 m) over the padded window
    n = int((2 * h + 80) // 10) + 1
    xs = [cx - h - 40 + i * 10 for i in range(n)]
    ys = [cy + h + 40 - j * 10 for j in range(n)]  # row 0 = north (game z = -h-40)
    grid = [[zat(x, y) for x in xs] for y in ys]
    zbase = min(min(r) for r in grid)
    out = {"id": d["id"], "name": d["name"], "centre": [cx, cy], "half": h, "zBase": round(zbase, 2),
           "terrain": {"n": n, "cell": 10, "origin": -(h + 40), "cm": [int(round((z - zbase) * 100)) for r in grid for z in r]},
           "names": [], "roads": [], "buildings": [], "colliders": [], "water": [], "landuse": [], "trees": [], "pois": []}
    names = {}

    def nm(s):
        if not s: return -1
        if s not in names: names[s] = len(names); out["names"].append(s)
        return names[s]

    for f in roads:
        p = f["properties"]
        if p["cls"] in SKIP_ROADS or p.get("tunnel"): continue
        g = shape(f["geometry"])
        if not g.intersects(pad): continue
        g = g.intersection(pad)
        for part in getattr(g, "geoms", [g]):
            if part.length < 2: continue
            seg = max(1, int(part.length // 6))
            pts = [part.interpolate(i / seg, normalized=True) for i in range(seg + 1)]
            width = p.get("width") or 6
            if p["cls"] in PATHS: width = min(width, 2.2)
            out["roads"].append([p["cls"], round(float(width), 1), nm(p.get("name") or p.get("ref")), ring_dm([(q.x, q.y) for q in pts], cx, cy), 1 if p.get("bridge") else 0])

    poi_by_building = {}
    for f in pois:
        q = f["properties"]
        if q.get("building"): poi_by_building.setdefault(q["building"], q)

    for f in buildings:
        p = f["properties"]
        g = shape(f["geometry"])
        if g.geom_type == "MultiPolygon": g = max(g.geoms, key=lambda a: a.area)
        c = g.representative_point()
        if not pad.contains(c) or g.area < 8: continue
        g = g.simplify(0.25, preserve_topology=True)
        ring = list(g.exterior.coords)[:-1]
        if len(ring) < 3: continue
        if Polygon(ring).exterior.is_ccw: ring = ring[::-1]  # clockwise in map frame = counter-clockwise seen from above in game frame
        poi = poi_by_building.get(p["id"])
        cat = p.get("category") or (poi and poi.get("category"))
        base = min(zat(x, y) for x, y in ring) - zbase
        roof = 1 if p.get("roof") == "gable" else 0
        out["buildings"].append([ring_dm(ring, cx, cy), dm(p["height"]), roof, round(-p.get("ridge", 0), 3) if roof else 0,
                                 CATS.index(cat) if cat in CATS else -1, dm(base), p.get("type", "yes")])
        if win.contains(c): out["colliders"] += colliders_for(g, gx)

    for f in water:
        g = shape(f["geometry"])
        if not g.intersects(pad): continue
        g = g.intersection(pad).simplify(0.5)
        for part in getattr(g, "geoms", [g]):
            if part.geom_type != "Polygon" or part.area < 20: continue
            out["water"].append([ring_dm(list(part.exterior.coords)[:-1], cx, cy), [ring_dm(list(i.coords)[:-1], cx, cy) for i in part.interiors],
                                 round(f["properties"].get("level", zbase) - zbase, 2), f["properties"].get("name")])

    for f in landuse:
        cls = f["properties"]["class"]
        if cls not in LANDUSE_KEEP: continue
        g = shape(f["geometry"])
        if not g.intersects(pad): continue
        g = g.intersection(pad).simplify(0.5)
        for part in getattr(g, "geoms", [g]):
            if part.geom_type != "Polygon" or part.area < 30: continue
            out["landuse"].append([cls, ring_dm(list(part.exterior.coords)[:-1], cx, cy), [ring_dm(list(i.coords)[:-1], cx, cy) for i in part.interiors], f["properties"].get("name")])

    for f in trees:
        x, y = f["geometry"]["coordinates"][:2]
        if abs(x - cx) <= h + 40 and abs(y - cy) <= h + 40: out["trees"] += [dm(x - cx), dm(-(y - cy))]
    if len(out["trees"]) > 2 * 2500:  # phones: cap the instanced trees
        step = len(out["trees"]) // 2 / 2500
        t = out["trees"]; out["trees"] = [v for k in range(2500) for v in t[2 * int(k * step):2 * int(k * step) + 2]]

    for f in pois:
        q = f["properties"]
        if abs(q["x"] - cx) <= h and abs(q["y"] - cy) <= h:
            out["pois"].append(q["id"])

    out["places"] = [[p["name"], round(p["x"] - cx, 1), round(-(p["y"] - cy), 1)] for p in man.get("places", [])
                     if abs(p["x"] - cx) <= h and abs(p["y"] - cy) <= h and p.get("kind") != "street"]

    # spawn: the point of the district's main street (or any named street) nearest the centre
    want = d.get("spawnStreet")
    best = None
    for f in roads:
        p = f["properties"]
        if p["cls"] in SKIP_ROADS or p["cls"] in PATHS or p["cls"] == "service" or not p.get("name"): continue
        if want and p["name"] != want: continue
        g = shape(f["geometry"])
        if not g.intersects(win): continue
        dd = g.distance(Point(cx, cy))
        if best is None or dd < best[0]: best = (dd, g)
    if best:
        g = best[1]; t = g.project(Point(cx, cy))
        a = g.interpolate(t); b = g.interpolate(min(g.length, t + 14) if t + 14 <= g.length else max(0, t - 14))
        face = math.atan2((b.x - a.x), -(b.y - a.y))  # game yaw: atan2(dx, dz)
        out["spawn"] = [round(a.x - cx, 1), round(-(a.y - cy), 1), round(face, 3)]
        # standing slots along the pavement either side of the spawn street (for residents and onboarding)
        foot = [shape(f["geometry"]) for f in buildings if pad.contains(shape(f["geometry"]).representative_point())]
        slots = []
        for k, dt in enumerate([6, -6, 11, -11, 16, -16, 22, -22, 28, -28, 34, -34]):
            tt = min(max(t + dt, 0), g.length)
            p0 = g.interpolate(tt); p1 = g.interpolate(min(g.length, tt + 1)) if tt + 1 <= g.length else g.interpolate(tt - 1)
            dx, dy = p1.x - p0.x, p1.y - p0.y; l = math.hypot(dx, dy) or 1
            side = 1 if k % 2 == 0 else -1
            off = 5.5
            px, py = p0.x - dy / l * off * side, p0.y + dx / l * off * side
            if any(fp.distance(Point(px, py)) < 1.2 for fp in foot): continue
            # face the street
            fx, fy = p0.x - px, p0.y - py
            slots.append([round(px - cx, 1), round(-(py - cy), 1), round(math.atan2(fx, -fy), 3)])
        out["slots"] = slots[:10]
        # the portal stands beside the street (on the side with room), facing back across it
        tb = g.project(b); b1 = g.interpolate(min(g.length, tb + 1)) if tb + 1 <= g.length else g.interpolate(tb - 1)
        dx, dy = b1.x - b.x, b1.y - b.y; l = math.hypot(dx, dy) or 1
        foot0 = [shape(f["geometry"]) for f in buildings if pad.contains(shape(f["geometry"]).representative_point())]
        px, py = b.x, b.y
        for side in (1, -1):
            qx, qy = b.x - dy / l * 10 * side, b.y + dx / l * 10 * side
            if not any(fp.distance(Point(qx, qy)) < 5 for fp in foot0):
                px, py = qx, qy; break
        pface = math.atan2(b.x - px, -(b.y - py)) if (px, py) != (b.x, b.y) else face
        out["portal"] = [round(px - cx, 1), round(-(py - cy), 1), round(pface, 3)]
    else:
        out["spawn"] = [0, 0, 0]; out["portal"] = [0, 12, math.pi]; out["slots"] = [[3, 3, 0], [-3, 3, 0], [3, -3, 0]]
    return out


def main():
    DST.mkdir(parents=True, exist_ok=True); DATA.mkdir(parents=True, exist_ok=True)
    summary = {}; meta = {}
    for d in CFG:
        if d.get("kind") == "corridor": continue
        o = build(d)
        s = json.dumps(o, separators=(",", ":"))
        (DST / f"{d['id']}.json").write_text(s)
        summary[d["id"]] = {"buildings": len(o["buildings"]), "roads": len(o["roads"]), "colliders": len(o["colliders"]),
                            "water": len(o["water"]), "trees": len(o["trees"]) // 2, "pois": len(o["pois"]),
                            "streets": len(o["names"]), "bytes": len(s)}
        print(d["id"], summary[d["id"]])
        meta[d["id"]] = {"spawn": o["spawn"], "portal": o["portal"], "slots": o["slots"], "places": o["places"], "streets": o["names"]}
    import corridors  # whole streets, streamed in chunks (corridors.py)
    corridor_pos = corridors.main(CFG, DST, summary, meta)
    (DATA / "districts-meta.json").write_text(json.dumps(meta, separators=(",", ":"), ensure_ascii=False))
    # town-wide business list (OSM POIs; no stories, no photos — those come from owners with consent)
    biz = []
    for f in pois:
        q = f["properties"]
        along = {c: pos[q["id"]] for c, pos in corridor_pos.items() if q["id"] in pos}
        if not q.get("in_town") and not district_of(q["x"], q["y"]) and not along: continue
        dist = district_of(q["x"], q["y"])
        cx, cy = next((c["centre"] for c in CFG if c["id"] == dist), (0, 0))
        biz.append({"id": q["id"], "name": q.get("name"), "category": q["category"], "osmKind": q["osm_kind"],
                    "business": bool(q["business"]), "addr": q.get("addr"), "website": q.get("website"),
                    "brand": q.get("brand"), "inTown": bool(q.get("in_town")), "district": dist,
                    "pos": [round(q["x"] - cx, 1), round(-(q["y"] - cy), 1)] if dist else None,
                    **({"corridors": along} if along else {})})
    biz.sort(key=lambda b: (b["district"] or "~", b["name"] or ""))
    (DATA / "businesses.json").write_text(json.dumps({"source": "OpenStreetMap contributors (ODbL), " + man.get("generated", "pipeline run"),
                                                      "businesses": biz}, indent=0, ensure_ascii=False))
    econ = json.loads((OUT / "economy.json").read_text())
    census = json.loads((OUT / "census.json").read_text()) if (OUT / "census.json").exists() else None
    by_dist = {}
    for b in biz:
        if b["business"] and b["district"]:
            by_dist.setdefault(b["district"], {}).setdefault(b["category"], 0)
            by_dist[b["district"]][b["category"]] += 1
    (DATA / "economy.json").write_text(json.dumps({
        "categories": CATS, "colors": man["category_colors"], "town": {"total": econ["total_businesses"], "byCategory": econ["by_category"], "byOsmKind": econ.get("by_osm_kind", {})},
        "byDistrict": by_dist, "census": census, "districts": summary, "counts": man["counts"], "sources": man["sources"]}, indent=1))


if __name__ == "__main__":
    main()
