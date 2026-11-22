"""Turn cached OSM + 3DEP data into engine-independent outputs in local metres.

Local frame: x = east, y = north, metres, origin = (X0, Y0) in EPSG:32619 (see manifest.json).
z = metres above sea level (NAVD88 from 3DEP).

Outputs (public/tiles -> /data/shrewsbury-data/tiles):
  manifest.json            frame, grid, counts, layer list, sources
  terrain_u16.bin          heightmap, uint16 little-endian, row 0 = south, col 0 = west,
                           z = min + v * scale  (see manifest.terrain)
  landuse_u8.bin           landuse class per terrain cell (same grid), classes in manifest
  geojson/*.geojson        full layers (local metres): buildings, roads, water, waterways,
                           landuse, trees, pois, boundary, places, areas
  tiles/{i}_{j}.json       per-500 m streaming tiles (compact, coords relative to tile SW corner)
  overview.json            town-wide low-detail layer (major roads, water, boundary)
  economy.json             business counts per category and per area
"""
import json, math, random, sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image, ImageDraw
from shapely import STRtree
from shapely.geometry import (LineString, MultiLineString, MultiPolygon, Point, Polygon, box,
                              mapping, shape)
from shapely.ops import linemerge, polygonize, unary_union

from common import CELL, EPSG, OUT, RAW, TILE, grid_origin, to_utm
from categories import COLORS, CATEGORIES, categorize

X0, Y0, NX, NY = grid_origin()
W, H = int(NX * TILE / CELL) + 1, int(NY * TILE / CELL) + 1
random.seed(42)

# ---------------------------------------------------------------- terrain
dem = tifffile.imread(RAW / "dem_10m.tif").astype(np.float64)
dem = dem[::-1, :]  # row 0 = south
assert dem.shape == (H, W), dem.shape
bad = ~np.isfinite(dem) | (dem < -100)
if bad.any():
    dem[bad] = np.nanmedian(dem[~bad])


def zat(x, y):
    """Bilinear terrain height at local (x, y)."""
    fx = np.clip(np.asarray(x) / CELL, 0, W - 1.001); fy = np.clip(np.asarray(y) / CELL, 0, H - 1.001)
    ix = fx.astype(int); iy = fy.astype(int); tx = fx - ix; ty = fy - iy
    a = dem[iy, ix]; b = dem[iy, ix + 1]; c = dem[iy + 1, ix]; d = dem[iy + 1, ix + 1]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def proj(coords):
    lons = [p["lon"] for p in coords]; lats = [p["lat"] for p in coords]
    xs, ys = to_utm.transform(lons, lats)
    return [(round(x - X0, 2), round(y - Y0, 2)) for x, y in zip(xs, ys)]


def proj_pt(lon, lat):
    x, y = to_utm.transform(lon, lat)
    return x - X0, y - Y0

# ---------------------------------------------------------------- OSM geometry
feat = json.loads((RAW / "features.json").read_text())["elements"]
extra = []
if (RAW / "offices.json").exists():
    extra = json.loads((RAW / "offices.json").read_text())["elements"]
bnd_el = [e for e in json.loads((RAW / "boundary.json").read_text())["elements"] if e["type"] == "relation"][0]


def rel_polygon(el):
    outers, inners = [], []
    for m in el.get("members", []):
        if m["type"] != "way" or not m.get("geometry"): continue
        g = [p for p in m["geometry"] if p]
        if len(g) < 2: continue
        ls = LineString(proj(g))
        (inners if m.get("role") == "inner" else outers).append(ls)
    if not outers: return None
    op = list(polygonize(linemerge(outers) if len(outers) > 1 else outers))
    if not op: return None
    poly = unary_union(op)
    if inners:
        ip = list(polygonize(linemerge(inners) if len(inners) > 1 else inners))
        if ip: poly = poly.difference(unary_union(ip))
    return poly if not poly.is_empty else None


def way_polygon(el):
    g = el.get("geometry")
    if not g or len(g) < 4: return None
    pts = proj(g)
    if pts[0] != pts[-1]: return None
    p = Polygon(pts)
    if not p.is_valid: p = p.buffer(0)
    return p if not p.is_empty else None


def el_polygon(el):
    return rel_polygon(el) if el["type"] == "relation" else way_polygon(el)


def polys_of(g):
    if g is None: return []
    if isinstance(g, Polygon): return [g]
    if isinstance(g, MultiPolygon): return list(g.geoms)
    return [p for p in getattr(g, "geoms", []) if isinstance(p, Polygon)]


town = rel_polygon(bnd_el)
bbox_local = box(0, 0, NX * TILE, NY * TILE)
print("town area km2", round(town.area / 1e6, 2))

# ---------------------------------------------------------------- POIs (businesses + civic)
pois = []
seen = set()
for el in feat + extra:
    t = el.get("tags", {})
    if not t.get("name"): continue
    cat = categorize(t)
    if not cat: continue
    key = (el["type"], el["id"])
    if key in seen: continue
    seen.add(key)
    if el["type"] == "node": x, y = proj_pt(el["lon"], el["lat"])
    elif "center" in el: x, y = proj_pt(el["center"]["lon"], el["center"]["lat"])
    else:
        pg = el_polygon(el)
        if pg is not None: c = pg.representative_point(); x, y = c.x, c.y
        elif el.get("geometry"): c = LineString(proj(el["geometry"])).interpolate(0.5, normalized=True); x, y = c.x, c.y
        else: continue
    if not bbox_local.contains(Point(x, y)): continue
    category, kind, is_biz = cat
    pois.append(dict(id=f"osm-{el['type'][0]}{el['id']}", name=t["name"], category=category, osm_kind=kind,
                     business=is_biz, x=round(x, 1), y=round(y, 1), z=round(float(zat(x, y)), 1),
                     in_town=town.contains(Point(x, y)),
                     website=t.get("website") or t.get("contact:website"),
                     addr=" ".join(v for v in (t.get("addr:housenumber"), t.get("addr:street")) if v) or None,
                     brand=t.get("brand"), opening_hours=t.get("opening_hours")))
print("pois", len(pois), "businesses", sum(p["business"] for p in pois))

# ---------------------------------------------------------------- buildings
HOUSEY = {"house", "detached", "residential", "semidetached_house", "bungalow", "farm", "cabin", "terrace"}
SMALL = {"garage", "garages", "shed", "carport", "roof", "hut", "greenhouse", "barn"}


def parse_m(v):
    try: return float(str(v).replace("m", "").replace("'", "").strip().split(";")[0])
    except Exception: return None


def building_height(t, area):
    h = parse_m(t.get("height")) if t.get("height") else None
    if h and 2 < h < 120: return h, "osm_height"
    lv = parse_m(t.get("building:levels")) if t.get("building:levels") else None
    if lv and 0 < lv < 40:
        return lv * 3.0 + (1.5 if t.get("building") in HOUSEY else 1.0), "osm_levels"
    b = t.get("building", "yes")
    if b in SMALL: return 3.2, "estimate"
    if b in HOUSEY: return 7.5, "estimate"
    if b in ("apartments", "dormitory"): return 11.0, "estimate"
    if b in ("commercial", "retail", "supermarket", "office"): return 7.0 if area < 3000 else 9.0, "estimate"
    if b in ("industrial", "warehouse", "manufacture"): return 9.0, "estimate"
    if b in ("school", "hospital", "civic", "public", "government"): return 10.0, "estimate"
    if b in ("church", "chapel"): return 11.0, "estimate"
    if area < 60: return 3.2, "estimate"
    if area < 350: return 7.5, "estimate"  # typical New England house
    return 8.0, "estimate"


buildings = []
for el in feat:
    t = el.get("tags", {})
    if "building" not in t or t.get("building") in ("no",): continue
    for p in polys_of(el_polygon(el)):
        p = p.simplify(0.25)
        if p.is_empty or p.area < 8 or not bbox_local.contains(p.centroid): continue
        h, src = building_height(t, p.area)
        ring = list(p.exterior.coords)[:-1]
        if len(ring) < 3: continue
        xs, ys = zip(*ring)
        zs = zat(np.array(xs), np.array(ys))
        roof = "flat"; ridge = None
        if (t.get("roof:shape") in ("gabled",) or (t.get("building") in HOUSEY | {"yes"} and p.area < 400)) \
                and t.get("roof:shape") not in ("flat",):
            mrr = p.minimum_rotated_rectangle
            if mrr.area > 0 and p.area / mrr.area > 0.82 and len(ring) <= 12:
                roof = "gable"
                c = list(mrr.exterior.coords)
                e0 = (c[1][0] - c[0][0], c[1][1] - c[0][1]); e1 = (c[2][0] - c[1][0], c[2][1] - c[1][1])
                ridge = math.atan2(*(e0[::-1] if math.hypot(*e0) >= math.hypot(*e1) else e1[::-1]))
        buildings.append(dict(id=f"osm-{el['type'][0]}{el['id']}", poly=p, height=round(h, 1), height_source=src,
                              levels=t.get("building:levels"), type=t.get("building"), name=t.get("name"),
                              base=round(float(zs.min()), 2), roof=roof,
                              ridge=None if ridge is None else round(ridge, 3), category=None,
                              in_town=town.intersects(p)))
print("buildings", len(buildings), Counter(b["height_source"] for b in buildings))

# assign business categories to buildings that contain a business POI
btree = STRtree([b["poly"] for b in buildings])
for poi in pois:
    for idx in btree.query(Point(poi["x"], poi["y"]), predicate="intersects"):
        b = buildings[int(idx)]
        if b["category"] is None or poi["business"]: b["category"] = poi["category"]
        poi["building"] = b["id"]
for b in buildings:  # fall back to OSM building type
    if b["category"] is None:
        bt = b["type"]
        if bt in ("retail", "supermarket", "commercial"): b["category"] = "retail"
        elif bt in ("office",): b["category"] = "offices"
        elif bt in ("industrial", "warehouse", "manufacture"): b["category"] = "trades"
        elif bt in ("school", "church", "civic", "public", "government", "hospital", "chapel"): b["category"] = "civic"

# ---------------------------------------------------------------- roads
WIDTH = {"motorway": 14, "trunk": 12, "primary": 11, "secondary": 9, "tertiary": 8, "motorway_link": 6,
         "trunk_link": 6, "primary_link": 6, "secondary_link": 6, "tertiary_link": 6, "residential": 7,
         "unclassified": 6.5, "living_street": 5, "service": 4, "track": 3, "footway": 2, "path": 1.8,
         "cycleway": 2.5, "pedestrian": 4, "steps": 2, "bridleway": 2}
roads = []
for el in feat:
    t = el.get("tags", {})
    hw = t.get("highway")
    if el["type"] != "way" or not hw or hw not in WIDTH or not el.get("geometry"): continue
    if t.get("area") == "yes": continue
    ls = LineString(proj(el["geometry"]))
    ls = ls.intersection(bbox_local)
    if ls.is_empty: continue
    w = WIDTH[hw]
    lanes = parse_m(t.get("lanes")) if t.get("lanes") else None
    if lanes and hw not in ("footway", "path", "cycleway", "service", "track"): w = max(w, lanes * 3.4 + 1)
    for part in (ls.geoms if hasattr(ls, "geoms") else [ls]):
        if not isinstance(part, LineString) or part.length < 1: continue
        part = part.segmentize(10.0)
        roads.append(dict(id=f"osm-w{el['id']}", line=part, cls=hw, width=round(w, 1), name=t.get("name"),
                          ref=t.get("ref"), lanes=lanes, bridge=t.get("bridge") == "yes",
                          tunnel=t.get("tunnel") == "yes", layer=t.get("layer"), oneway=t.get("oneway") == "yes",
                          surface=t.get("surface")))
road_km = sum(r["line"].length for r in roads) / 1000
road_km_in = sum(r["line"].intersection(town).length for r in roads) / 1000
road_km_by_class = Counter()
for r in roads: road_km_by_class[r["cls"]] += r["line"].intersection(town).length / 1000
print("roads", len(roads), "km", round(road_km, 1), "in town", round(road_km_in, 1))

# ---------------------------------------------------------------- water, waterways, landuse
LANDUSE_CLASSES = ["none", "water", "wood", "grass", "park", "residential", "commercial", "industrial",
                   "farmland", "wetland", "cemetery", "golf", "sports", "parking", "school", "sand"]
LC = {n: i for i, n in enumerate(LANDUSE_CLASSES)}


def landuse_class(t):
    n, lu, le, a, wa = t.get("natural"), t.get("landuse"), t.get("leisure"), t.get("amenity"), t.get("water")
    if n == "water" or wa or lu in ("reservoir", "basin") or t.get("waterway") == "riverbank": return "water"
    if n == "wetland": return "wetland"
    if n in ("wood",) or lu == "forest": return "wood"
    if n in ("scrub", "heath", "grassland") or lu in ("grass", "meadow", "village_green", "recreation_ground"): return "grass"
    if n in ("sand", "beach", "bare_rock") or lu in ("quarry", "construction", "brownfield"): return "sand"
    if le in ("park", "garden", "nature_reserve", "playground", "dog_park"): return "park"
    if le == "golf_course": return "golf"
    if le in ("pitch", "sports_centre", "stadium", "track"): return "sports"
    if lu == "residential": return "residential"
    if lu in ("commercial", "retail"): return "commercial"
    if lu in ("industrial", "railway"): return "industrial"
    if lu in ("farmland", "farmyard", "orchard", "vineyard", "allotments", "greenhouse_horticulture"): return "farmland"
    if lu == "cemetery" or a == "grave_yard": return "cemetery"
    if a == "parking": return "parking"
    if a in ("school", "college", "university"): return "school"
    return None


areas_lu = []  # (class, polygon, tags)
for el in feat:
    t = el.get("tags", {})
    if el["type"] == "node" or "building" in t: continue
    c = landuse_class(t)
    if not c: continue
    for p in polys_of(el_polygon(el)):
        p = p.intersection(bbox_local)
        for q in polys_of(p) if not isinstance(p, Polygon) else [p]:
            if q.area > 20: areas_lu.append((c, q, t))
print("landuse/water polygons", len(areas_lu), Counter(c for c, _, _ in areas_lu))

# rasterise to the terrain grid; paint order = big classes first, water last
ORDER = ["residential", "farmland", "commercial", "industrial", "school", "cemetery", "golf", "grass", "wood",
         "park", "sports", "parking", "sand", "wetland", "water"]
img = Image.new("L", (W, H), 0); dr = ImageDraw.Draw(img)


def to_px(coords):  # PIL y grows down; we store row 0 = south so just use y/CELL as row
    return [(x / CELL, y / CELL) for x, y in coords]


for cls in ORDER:
    for c, p, _ in areas_lu:
        if c != cls: continue
        dr.polygon(to_px(p.exterior.coords), fill=LC[c])
        for hole in p.interiors: dr.polygon(to_px(hole.coords), fill=0)
landuse = np.asarray(img, dtype=np.uint8)  # row index == y / CELL, i.e. row 0 = south

water = []
for c, p, t in areas_lu:
    if c != "water": continue
    inside = landuse == LC["water"]
    xs, ys = zip(*p.exterior.coords)
    zs = zat(np.array(xs), np.array(ys))
    water.append(dict(poly=p, name=t.get("name"), kind=t.get("water") or t.get("natural") or t.get("landuse"),
                      level=round(float(np.percentile(zs, 10)), 2)))
waterways = []
for el in feat:
    t = el.get("tags", {})
    if el["type"] == "way" and t.get("waterway") in ("stream", "river", "canal", "brook", "ditch", "drain") and el.get("geometry"):
        ls = LineString(proj(el["geometry"])).intersection(bbox_local)
        for part in (ls.geoms if hasattr(ls, "geoms") else [ls]):
            if isinstance(part, LineString) and part.length > 1:
                waterways.append(dict(line=part.segmentize(10), kind=t["waterway"], name=t.get("name")))

# ---------------------------------------------------------------- trees
trees = []
for el in feat:
    t = el.get("tags", {})
    if el["type"] == "node" and t.get("natural") == "tree":
        x, y = proj_pt(el["lon"], el["lat"])
        if bbox_local.contains(Point(x, y)): trees.append((x, y, "osm"))
# scatter in woods: deterministic jittered grid, 1 tree per ~14 m x 14 m cell
step = 14.0
wood_mask = (landuse == LC["wood"]) | (landuse == LC["wetland"]) * 0
for iy in range(int(H * CELL / step)):
    for ix in range(int(W * CELL / step)):
        x = ix * step + random.uniform(0, step); y = iy * step + random.uniform(0, step)
        r, c = int(y / CELL), int(x / CELL)
        if r < H and c < W and landuse[r, c] == LC["wood"]: trees.append((x, y, "scatter"))
# drop scattered trees that land in buildings or on roads (cheap check via road buffer tree)
rtree = STRtree([r["line"] for r in roads if r["cls"] not in ("footway", "path")])
kept = []
for x, y, src in trees:
    pt = Point(x, y)
    if src == "scatter":
        if len(btree.query(pt, predicate="intersects")): continue
        if len(rtree.query(pt.buffer(6), predicate="intersects")): continue
    kept.append((round(x, 1), round(y, 1), round(float(zat(x, y)), 1), src))
trees = kept
print("trees", len(trees), Counter(t[3] for t in trees))

# ---------------------------------------------------------------- places (teleport list) + areas
def find_named(pred):
    """First OSM element matching pred, preferring ones inside the town boundary."""
    hits = [el for el in feat if el.get("tags", {}).get("name") and pred(el["tags"])]
    for el in hits:
        try:
            if town.contains(Point(el_center(el))): return el
        except Exception: pass
    return hits[0] if hits else None


def el_center(el):
    if el["type"] == "node": return proj_pt(el["lon"], el["lat"])
    pg = el_polygon(el)
    if pg is not None and not pg.is_empty:
        c = pg.representative_point(); return c.x, c.y
    ls = LineString(proj(el["geometry"])); c = ls.interpolate(0.5, normalized=True); return c.x, c.y


def road_point(pred, near=None):
    cands = [r for r in roads if pred(r)]
    if not cands: return None
    if near:
        best = min(cands, key=lambda r: r["line"].distance(Point(near)))
        p = best["line"].interpolate(best["line"].project(Point(near)))
    else:
        tot = unary_union([r["line"] for r in cands]).intersection(town)
        p = tot.interpolate(0.5, normalized=True) if hasattr(tot, "interpolate") else tot.representative_point()
        if isinstance(tot, MultiLineString):
            longest = max(tot.geoms, key=lambda g: g.length); p = longest.interpolate(0.5, normalized=True)
    return p.x, p.y


places = []


def add_place(name, xy, kind):
    if xy: places.append(dict(name=name, x=round(xy[0], 1), y=round(xy[1], 1), z=round(float(zat(*xy)), 1), kind=kind))


townnode = find_named(lambda t: t.get("place") == "town" and t["name"] == "Shrewsbury")
centre = el_center(townnode) if townnode else town.centroid.coords[0]
for nm in ["Shrewsbury Town Common", "Shrewsbury Town Hall", "Shrewsbury Public Library"]:
    el = find_named(lambda t, nm=nm: t["name"] == nm)
    if el: add_place(nm, el_center(el), "civic")
mainst = road_point(lambda r: r["name"] == "Main Street", near=centre)
add_place("Main Street (Town Center)", mainst, "street")
lake = max((w for w in water if w["name"] and "Quinsigamond" in w["name"]), key=lambda w: w["poly"].area, default=None)
if lake:
    # a shore point: nearest point of lake boundary to the town centre, stepped 25 m inland
    ring = lake["poly"].exterior
    ref = Point(centre)
    p = ring.interpolate(ring.project(ref))
    add_place(lake["name"] + " (shore)", (p.x + (ref.x - p.x) / max(1, ref.distance(p)) * 25,
                                          p.y + (ref.y - p.y) / max(1, ref.distance(p)) * 25), "water")
for nm, pred in [("Dean Park", lambda t: t["name"] == "Dean Park" and t.get("leisure")),
                 ("White City", lambda t: "White City" in t["name"]),
                 ("Prospect Park", lambda t: t["name"] == "Prospect Park"),
                 ("Shrewsbury High School", lambda t: t["name"] == "Shrewsbury High School")]:
    el = find_named(pred)
    if el: add_place(el["tags"]["name"], el_center(el), "place")
add_place("Route 9 (Boston Turnpike)", road_point(lambda r: r["ref"] and "MA 9" in r["ref"].split(";")), "street")
add_place("Route 20 (Hartford Turnpike)", road_point(lambda r: r["ref"] and "US 20" in r["ref"].split(";")), "street")
print("places", [p["name"] for p in places])

# areas for the economy summary
corr = {}
r9 = unary_union([r["line"] for r in roads if r["ref"] and "MA 9" in r["ref"].split(";")])
r20 = unary_union([r["line"] for r in roads if r["ref"] and "US 20" in r["ref"].split(";")])
if centre: corr["Town Center / Main Street"] = Point(centre).buffer(700)
if not r9.is_empty: corr["Route 9 corridor"] = r9.buffer(250).intersection(town)
if not r20.is_empty: corr["Route 20 corridor"] = r20.buffer(250).intersection(town)

# ---------------------------------------------------------------- outputs
out = OUT; (out / "geojson").mkdir(parents=True, exist_ok=True); (out / "tiles").mkdir(exist_ok=True)


def r1(g):  # round geometry coords to 0.1 m
    from shapely import set_precision
    return set_precision(g, 0.1)


def write_fc(name, feats):
    fc = {"type": "FeatureCollection", "crs_note": f"local metres: x=E,y=N, origin EPSG:{EPSG} ({X0},{Y0})",
          "features": feats}
    (out / "geojson" / f"{name}.geojson").write_text(json.dumps(fc, separators=(",", ":")))


def F(geom, props): return {"type": "Feature", "geometry": mapping(geom) if not isinstance(geom, dict) else geom,
                            "properties": {k: v for k, v in props.items() if v is not None}}


write_fc("boundary", [F(r1(town), {"name": "Town of Shrewsbury", "source": "OSM relation %d" % bnd_el["id"]})])
write_fc("buildings", [F(r1(b["poly"]), {k: v for k, v in b.items() if k != "poly"}) for b in buildings])
write_fc("roads", [F(r1(r["line"]), {k: v for k, v in r.items() if k != "line"}) for r in roads])
write_fc("water", [F(r1(w["poly"]), {k: v for k, v in w.items() if k != "poly"}) for w in water])
write_fc("waterways", [F(r1(w["line"]), {k: v for k, v in w.items() if k != "line"}) for w in waterways])
write_fc("landuse", [F(r1(p), {"class": c, "name": t.get("name")}) for c, p, t in areas_lu if c != "water"])
write_fc("trees", [F({"type": "Point", "coordinates": [x, y, z]}, {"source": s}) for x, y, z, s in trees])
write_fc("pois", [F({"type": "Point", "coordinates": [p["x"], p["y"], p["z"]]}, p) for p in pois])
write_fc("places", [F({"type": "Point", "coordinates": [p["x"], p["y"], p["z"]]}, p) for p in places])
write_fc("areas", [F(r1(g), {"name": n}) for n, g in corr.items()])

zmin = float(dem.min()); scale = 0.01
((dem - zmin) / scale).round().clip(0, 65535).astype("<u2").tofile(out / "terrain_u16.bin")
landuse.astype(np.uint8).tofile(out / "landuse_u8.bin")

# ----- streaming tiles: compact JSON, coordinates relative to tile SW corner, 0.1 m ints
tiles = defaultdict(lambda: {"b": [], "r": [], "t": [], "w": []})


def q(v, o): return int(round((v - o) * 10))


def tile_of(x, y): return int(x // TILE), int(y // TILE)


for b in buildings:
    i, j = tile_of(b["poly"].centroid.x, b["poly"].centroid.y)
    ox, oy = i * TILE, j * TILE
    rings = [[c for xy in list(b["poly"].exterior.coords)[:-1] for c in (q(xy[0], ox), q(xy[1], oy))]]
    rings += [[c for xy in list(h.coords)[:-1] for c in (q(xy[0], ox), q(xy[1], oy))] for h in b["poly"].interiors]
    rec = [rings, b["base"], b["height"], 1 if b["roof"] == "gable" else 0, b["ridge"] or 0,
           CATEGORIES.index(b["category"]) if b["category"] else -1, 1 if b["height_source"] == "estimate" else 0]
    tiles[(i, j)]["b"].append(rec)
road_names = sorted({r["name"] for r in roads if r["name"]})
classes = sorted(WIDTH)
for r in roads:
    for i in range(NX):
        for j in range(NY):
            pass
    # split by tile
    minx, miny, maxx, maxy = r["line"].bounds
    for i in range(int(minx // TILE), int(maxx // TILE) + 1):
        for j in range(int(miny // TILE), int(maxy // TILE) + 1):
            seg = r["line"].intersection(box(i * TILE, j * TILE, (i + 1) * TILE, (j + 1) * TILE))
            for part in (seg.geoms if hasattr(seg, "geoms") else [seg]):
                if not isinstance(part, LineString) or part.length < 0.5: continue
                ox, oy = i * TILE, j * TILE
                pts = [c for xy in part.coords for c in (q(xy[0], ox), q(xy[1], oy))]
                tiles[(i, j)]["r"].append([pts, classes.index(r["cls"]), r["width"],
                                           road_names.index(r["name"]) if r["name"] else -1,
                                           1 if r["bridge"] else 0])
for x, y, z, s in trees:
    i, j = tile_of(x, y); tiles[(i, j)]["t"] += [q(x, i * TILE), q(y, j * TILE)]
sizes = []
for (i, j), d in tiles.items():
    if not (0 <= i < NX and 0 <= j < NY): continue
    s = json.dumps(d, separators=(",", ":"))
    (out / "tiles" / f"{i}_{j}.json").write_text(s); sizes.append(len(s))

# ----- overview (low detail, town-wide)
MAJOR = {"motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link"}
ov = {"boundary": [[round(x, 1), round(y, 1)] for x, y in town.simplify(5).exterior.coords] if isinstance(town, Polygon)
      else [[round(x, 1), round(y, 1)] for x, y in max(town.geoms, key=lambda g: g.area).simplify(5).exterior.coords],
      "roads": [[classes.index(r["cls"]), r["width"], [c for xy in r["line"].simplify(3).coords for c in (round(xy[0]), round(xy[1]))]]
                for r in roads if r["cls"] in MAJOR or r["cls"] in ("residential", "unclassified")],
      "water": [[w["level"], [[c for xy in w["poly"].simplify(3).exterior.coords for c in (round(xy[0]), round(xy[1]))]]
                 + [[c for xy in h.coords for c in (round(xy[0]), round(xy[1]))] for h in w["poly"].simplify(3).interiors]]
                for w in water if w["poly"].area > 400],
      "labels": []}
# street label anchors every ~180 m along named roads
for r in roads:
    if not r["name"] or r["cls"] in ("footway", "path", "cycleway", "service", "track", "steps"): continue
    L = r["line"].length
    for k in range(int(L // 180) + 1):
        d = min(L, 90 + k * 180)
        if d > L: break
        p = r["line"].interpolate(d); p2 = r["line"].interpolate(min(L, d + 5)); p1 = r["line"].interpolate(max(0, d - 5))
        ov["labels"].append([road_names.index(r["name"]), round(p.x, 1), round(p.y, 1),
                             round(math.atan2(p2.y - p1.y, p2.x - p1.x), 2)])
(out / "overview.json").write_text(json.dumps(ov, separators=(",", ":")))

# ----- economy summary
biz = [p for p in pois if p["business"] and p["in_town"]]
by_area = {n: Counter(p["category"] for p in biz if g.contains(Point(p["x"], p["y"]))) for n, g in corr.items()}
economy = {"source": "OpenStreetMap POIs (shop/amenity/office/craft/healthcare/leisure/tourism) inside the town boundary",
           "total_businesses": len(biz), "by_category": dict(Counter(p["category"] for p in biz).most_common()),
           "by_area": {n: dict(c.most_common()) for n, c in by_area.items()},
           "by_osm_kind": dict(Counter(p["osm_kind"] for p in biz).most_common()),
           "civic_pois": sum(1 for p in pois if not p["business"] and p["in_town"]),
           "colors": COLORS}
(out / "economy.json").write_text(json.dumps(economy, indent=1))

manifest = {
    "name": "Town of Shrewsbury, MA", "frame": {"epsg": EPSG, "origin": [X0, Y0], "axes": "x=east,y=north,z=up (m)"},
    "grid": {"tile": TILE, "nx": NX, "ny": NY},
    "terrain": {"file": "terrain_u16.bin", "w": W, "h": H, "cell": CELL, "min": round(zmin, 3), "scale": scale,
                "max": round(float(dem.max()), 2), "order": "row-major, row 0 = south (y=0), col 0 = west"},
    "landuse": {"file": "landuse_u8.bin", "classes": LANDUSE_CLASSES},
    "tile_format": {"b": "[rings(dm ints rel. tile SW), base_z, height, gable, ridge_rad, category_idx, is_estimate]",
                    "r": "[pts(dm ints), class_idx, width_m, name_idx, bridge]", "t": "flat [x,y] dm ints"},
    "road_classes": classes, "road_names": road_names, "categories": CATEGORIES, "category_colors": COLORS,
    "tiles": sorted(f"{i}_{j}" for (i, j) in tiles if 0 <= i < NX and 0 <= j < NY),
    "places": places,
    "counts": {"buildings": len(buildings), "buildings_in_town": sum(b["in_town"] for b in buildings),
               "height_sources": dict(Counter(b["height_source"] for b in buildings)),
               "gable_roofs": sum(b["roof"] == "gable" for b in buildings),
               "road_segments": len(roads), "road_km_bbox": round(road_km, 1), "road_km_in_town": round(road_km_in, 1),
               "road_km_in_town_by_class": {k: round(v, 1) for k, v in road_km_by_class.most_common()},
               "water_polygons": len(water), "trees": len(trees), "pois": len(pois),
               "businesses_in_town": len(biz), "tiles": len(sizes),
               "tile_bytes_total": sum(sizes), "tile_bytes_max": max(sizes),
               "town_area_km2": round(town.area / 1e6, 2)},
    "sources": ["© OpenStreetMap contributors (ODbL)", "USGS 3DEP 1/3 arc-second DEM via elevation.nationalmap.gov (public domain)"],
}
(out / "manifest.json").write_text(json.dumps(manifest, indent=1))
print(json.dumps(manifest["counts"], indent=1))
