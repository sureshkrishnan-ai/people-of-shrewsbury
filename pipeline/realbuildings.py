"""Real building heights, roof shapes and LiDAR trees for the game districts (square districts and corridor chunks).

Reads (all optional, from $SHREWSBURY_OUT/geojson; written by the sibling data pipeline, see SOURCES.md):
  buildings_lidar.geojson     MassGIS footprints + USGS 3DEP LiDAR: height_m (eave), ridge_m, top_m, roof_type,
                              ridge_azimuth_deg, confidence, flags
  buildings_overture.geojson  whole town, Overture Maps footprints with a height each (height_source lidar|overture|estimate)
  trees_lidar.geojson         LiDAR tree tops (height_m, crown_radius_m) + canopy polygons

merged(region) -> [(footprint, props)] for every building whose footprint centre is in `region`:
  1. OSM buildings (they carry the type, category and POI link). A LiDAR footprint replaces the OSM one when it matches
     (same osm_id, or the LiDAR footprint contains the OSM centre); flag no_lidar_roof (in MassGIS but no roof in the
     2021 LiDAR: likely demolished) drops the building. Heights: LiDAR (confidence >= 0.4) > Overture > estimate.
  2. LiDAR (MassGIS) footprints OSM lacks, then Overture footprints OSM lacks, each only where it does not overlap a
     footprint already taken (> 30 % of the smaller one).
props: top (m above base), eave (m, or None = renderer estimates), roof flat|gable|hip|shed, ang (ridge, map-frame rad),
spire (m above base of a steeple / cupola top, or 0), src lidar|overture|osm|estimate, id, type, category.

Roof pitch: LiDAR pitches come out low (median ~26 deg; the fit averages dormers and eaves), so gable and hip roofs are
drawn at 30-45 deg (a New England range): the measured ridge height is kept and the eave moves. `complex` roofs become a
gable along the long axis (rectangular, elongated footprints) or a hip (the rest), with the measured eave and ridge.
"""
import math

from shapely.geometry import Point, Polygon, box, shape
from shapely.strtree import STRtree
from shapely.prepared import prep

import districts as D

SRC_CODE = {"estimate": 0, "osm": 1, "overture": 2, "lidar": 3}
PITCH_MIN, PITCH_MAX = 30.0, 45.0
OV = 0.35  # roof overhang the renderer adds (m)


def _poly(g):
    if g.geom_type == "MultiPolygon": g = max(g.geoms, key=lambda a: a.area)
    return g


class Source:
    def __init__(self):
        self.lid = [f for f in D.load("buildings_lidar")]
        self.lid_geo = [_poly(shape(f["geometry"])) for f in self.lid]
        self.lid_tree = STRtree(self.lid_geo) if self.lid_geo else None
        self.lid_by_osm = {}
        for k, f in enumerate(self.lid):
            o = f["properties"].get("osm_id")
            if o: self.lid_by_osm.setdefault(o, k)
        self.ov = [f for f in D.load("buildings_overture")]
        self.ov_geo = [_poly(shape(f["geometry"])) for f in self.ov]
        self.ov_tree = STRtree(self.ov_geo) if self.ov_geo else None
        self.ov_by_osm = {f["properties"]["osm_id"]: k for k, f in enumerate(self.ov) if f["properties"].get("osm_id")}
        self.osm_ids = {f["properties"]["id"] for f in D.buildings}
        print(f"  real buildings: {len(self.lid)} LiDAR, {len(self.ov)} Overture footprints")
        t = D.load("trees_lidar")
        self.trees = [(f["geometry"]["coordinates"][0], f["geometry"]["coordinates"][1], f["properties"]["height_m"], f["properties"]["crown_radius_m"])
                      for f in t if f["properties"].get("kind") == "tree"]
        self.canopy = [shape(f["geometry"]) for f in t if f["properties"].get("kind") == "canopy"]
        # coverage: 50 m cells the LiDAR tree pass looked at (it found a tree or canopy there)
        self.cover = set()
        for x, y, _, _ in self.trees: self.cover.add((int(x // 50), int(y // 50)))
        for g in self.canopy:
            x0, y0, x1, y1 = g.bounds
            for i in range(int(x0 // 50), int(x1 // 50) + 1):
                for j in range(int(y0 // 50), int(y1 // 50) + 1): self.cover.add((i, j))
        print(f"  LiDAR trees: {len(self.trees)} tops, {len(self.canopy)} canopy polygons, {len(self.cover)} covered 50 m cells")

    def covered(self, x, y): return (int(x // 50), int(y // 50)) in self.cover


_S = None
def src():
    global _S
    if _S is None: _S = Source()
    return _S


def _axis_frame(g, ang):
    """Footprint extent along / across a ridge angle (map frame): (a0, a1, c0, c1)."""
    ux, uy = math.cos(ang), math.sin(ang)
    a = [x * ux + y * uy for x, y in g.exterior.coords]
    c = [-x * uy + y * ux for x, y in g.exterior.coords]
    return min(a), max(a), min(c), max(c)


def _long_axis(g):
    r = g.minimum_rotated_rectangle
    pts = list(r.exterior.coords)
    e = [(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(2)]
    L = [math.hypot(*v) for v in e]
    k = 0 if L[0] >= L[1] else 1
    return math.atan2(e[k][1], e[k][0]), max(L) / max(min(L), 0.1), g.area / max(r.area, 1e-6)


def _lidar_props(g, q):
    """Roof from a LiDAR record; pitch clamped (see module doc)."""
    eave = float(q["height_m"]); ridge = max(float(q.get("ridge_m") or eave), eave)
    rt = q.get("roof_type") or "flat"
    if rt == "none": rt = "flat"
    if q.get("ridge_azimuth_deg") is not None: ang = math.radians(90 - float(q["ridge_azimuth_deg"]))
    else: ang = _long_axis(g)[0]
    complex_ = rt == "complex"
    if complex_:
        la, aspect, rect = _long_axis(g)
        rt = "gable" if rect > 0.8 and aspect >= 1.4 else "hip"
        if q.get("ridge_azimuth_deg") is None or rt == "gable": ang = la
    if ridge - eave < 0.4 and rt in ("gable", "hip"): rt = "flat"
    if rt in ("gable", "hip"):
        a0, a1, c0, c1 = _axis_frame(g, ang)
        half = (c1 - c0) / 2 + OV
        rise = ridge - eave
        pitch = math.degrees(math.atan2(rise, half))
        lo = 0.0 if complex_ else PITCH_MIN
        p = min(max(pitch, lo), PITCH_MAX)
        rise = half * math.tan(math.radians(p))
        eave = max(2.4, ridge - rise)
    if rt == "flat": eave = ridge
    top = float(q.get("top_m") or ridge)
    return {"top": ridge, "eave": eave, "roof": rt, "ang": ang, "spire_top": top}


def _spire(g, p, top):
    """A steeple / cupola when the LiDAR top stands > 3 m over the ridge on a church/civic building or a large roof."""
    if top <= p["top"] + 3: return 0
    civic = p.get("type") in ("church", "chapel", "civic", "public", "townhall", "school") or p.get("category") in ("church", "civic", "religion", "community")
    if not civic and (g.area < 80 or "trees_over_roof" in p.get("flags", []) or "tree_dominated" in p.get("flags", [])): return 0
    return min(top, p["top"] + 40)


def merged(region):
    S = src()
    preg = prep(region)
    out = []
    taken = []
    used_l, used_o = set(), set()

    def lidar_ok(q): return q.get("height_m") is not None and float(q.get("confidence") or 0) >= 0.4

    for f in D.buildings:
        g = _poly(shape(f["geometry"]))
        c = g.representative_point()
        if not preg.contains(c) or g.area < 8: continue
        p = dict(f["properties"])
        k = S.lid_by_osm.get(p["id"])
        if (k is None or k in used_l) and S.lid_tree is not None:
            k = None
            for h in S.lid_tree.query(c):
                if int(h) not in used_l and S.lid_geo[h].contains(c): k = int(h); break
        q = S.lid[k]["properties"] if k is not None else None
        if q is not None:
            used_l.add(k)
            if "no_lidar_roof" in (q.get("flags") or []): continue  # likely demolished since the footprints were drawn
        o = S.ov_by_osm.get(p["id"])
        if o is not None: used_o.add(o)
        if q is not None and lidar_ok(q):
            g = S.lid_geo[k]
            r = _lidar_props(g, q); p["flags"] = q.get("flags") or []
            p.update(top=r["top"], eave=r["eave"], roof=r["roof"], ang=r["ang"], src="lidar")
            p["spire"] = _spire(g, p, r["spire_top"])
        elif o is not None and S.ov[o]["properties"].get("height_source") != "estimate" and S.ov[o]["properties"].get("ridge_m"):
            ovp = S.ov[o]["properties"]
            _ovr(g, p, ovp)
        else:
            _est(p)
        out.append((g, p)); taken.append(g)

    tt = STRtree(taken) if taken else None
    def overlaps(g):
        if tt is None: return False
        for h in tt.query(g):
            o = taken[h]
            if o.intersects(g) and o.intersection(g).area > 0.3 * min(o.area, g.area): return True
        return False

    extra = []
    for k, f in enumerate(S.lid):
        if k in used_l: continue
        g = S.lid_geo[k]; q = f["properties"]
        if g.area < 8 or not preg.contains(g.representative_point()) or "no_lidar_roof" in (q.get("flags") or []): continue
        if overlaps(g): continue
        p = {"id": q.get("id") or f"lidar-{k}", "type": "yes", "flags": q.get("flags") or []}
        if lidar_ok(q):
            r = _lidar_props(g, q)
            p.update(top=r["top"], eave=r["eave"], roof=r["roof"], ang=r["ang"], src="lidar"); p["spire"] = _spire(g, p, r["spire_top"])
        else:
            p.update(height=min(max(float(q.get("ridge_m") or 6), 3), 15)); _est(p, keep=True)
        extra.append((g, p))
    for k, f in enumerate(S.ov):
        if k in used_o: continue
        q = f["properties"]
        if q.get("osm_id") in S.osm_ids: continue
        g = S.ov_geo[k]
        if g.area < 8 or not preg.contains(g.representative_point()): continue
        if overlaps(g) or any(e.intersects(g) and e.intersection(g).area > 0.3 * min(e.area, g.area) for e, _ in extra if e.distance(g) < 1): continue
        p = {"id": q["id"], "type": "yes"}
        if q.get("ridge_m") and q.get("height_source") != "estimate": _ovr(g, p, q)
        else:
            p["height"] = 6.5 if g.area < 250 else 8; _est(p, keep=True)
        extra.append((g, p))
    return out + extra


def _ovr(g, p, q):
    if q.get("height_source") == "lidar" and q.get("height_m") is not None:
        r = _lidar_props(g, q); p.update(top=r["top"], eave=r["eave"], roof=r["roof"], ang=r["ang"], src="lidar", spire=0)
        return
    ridge = float(q["ridge_m"]); eave = float(q.get("height_m") or ridge * 0.7)
    roof = p.get("roof") if p.get("roof") in ("gable", "flat") else ("gable" if g.area < 260 else "flat")
    ang = p.get("ridge") if p.get("ridge") is not None and roof == "gable" and "ridge" in p else _long_axis(g)[0]
    if roof == "gable":
        a0, a1, c0, c1 = _axis_frame(g, ang)
        half = (c1 - c0) / 2 + OV
        rise = min(max(ridge - eave, half * math.tan(math.radians(PITCH_MIN))), half * math.tan(math.radians(PITCH_MAX)))
        eave = max(2.4, ridge - rise)
        if ridge - eave < 0.4: roof = "flat"
    if roof == "flat": ridge = eave = max(eave, 2.6)
    p.update(top=ridge, eave=eave, roof=roof, ang=ang, src="overture", spire=0)


def _est(p, keep=False):
    roof = p.get("roof") if p.get("roof") in ("gable", "flat") else "flat"
    p.update(top=float(p.get("height") or 6), eave=None, roof=roof, ang=p.get("ridge", 0) or 0, spire=0,
             src="osm" if p.get("height_source") in ("osm_height", "osm_levels") else "estimate")


ROOF_CODE = {"flat": 0, "gable": 1, "hip": 2, "shed": 3}


def record(g, p, cx, cy, zbase, cat_index):
    """Game record: [ring dm, top dm, roof, ridge angle (game), category, base dm, type, eave dm (0 = estimate), spire dm (0), source code]."""
    g = g.simplify(0.25, preserve_topology=True)
    ring = list(g.exterior.coords)[:-1]
    if len(ring) < 3: return None
    if Polygon(ring).exterior.is_ccw: ring = ring[::-1]
    base = min(D.zat(x, y) for x, y in ring) - zbase
    roof = ROOF_CODE[p["roof"]]
    return [D.ring_dm(ring, cx, cy), D.dm(p["top"]), roof, round(-p["ang"], 3) if roof else 0, cat_index, D.dm(base), p.get("type", "yes"),
            D.dm(p["eave"]) if p.get("eave") else 0, D.dm(p["spire"]) if p.get("spire") else 0, SRC_CODE[p["src"]]]


def trees_in(region, footprints, roads_near):
    """LiDAR trees whose trunk is in `region`, not on a building or a road; largest first. -> [x, y, h, r, evergreen]."""
    S = src()
    preg = prep(region)
    fb = STRtree(footprints) if footprints else None
    rb = [g for g in roads_near]
    rt = STRtree(rb) if rb else None
    out = []
    for x, y, h, r in S.trees:
        pt = Point(x, y)
        if not preg.contains(pt): continue
        if fb is not None and any(footprints[i].distance(pt) < 0.8 for i in fb.query(pt.buffer(1))): continue
        if rt is not None and any(rb[i].contains(pt) for i in rt.query(pt)): continue
        # conifers: tall and narrow (white pine, hemlock, spruce); broad crowns are the oaks and maples
        ever = 1 if r / max(h, 1) < 0.19 and h > 9 else 0
        out.append([x, y, h, r, ever])
    out.sort(key=lambda t: -(t[2] * t[3]))
    return out


def road_shapes(region):
    """Road surfaces (not paths) near a region, buffered to the drawn width + 0.5 m."""
    out = []
    for f in D.roads:
        p = f["properties"]
        if p["cls"] in D.SKIP_ROADS or p["cls"] in D.PATHS or p.get("tunnel"): continue
        g = shape(f["geometry"])
        if not g.intersects(region): continue
        out.append(g.buffer((p.get("width") or 6) / 2 + 0.5, quad_segs=2))
    return out


def tree_record(t, cx, cy):
    x, y, h, r, e = t
    return [D.dm(x - cx), D.dm(-(y - cy)), D.dm(h), D.dm(r), e]
