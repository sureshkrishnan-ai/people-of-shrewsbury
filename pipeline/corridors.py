"""Corridor districts: a whole street, walkable end to end, cut into chunks the game streams in and out.

A corridor is listed in src/city/districts.json with  kind: "corridor", street: "<OSM name>", buffer: <m>
(half-width walked either side of the street), optional chunk: <m> (length of street per chunk, default 400)
and spawnAt: "<place name>" (spawn on the street nearest that place; default: the street's middle).

How it is cut (see docs in pipeline/README.md):
  1. spine   — every OSM way with that name, merged; the longest connected run inside the town (+100 m) is kept.
               Divided-road twins and side spurs drop out because only one path through the graph is kept.
  2. cells   — a 10 m lattice aligned with the terrain grid. Every cell within buffer+40 m of the spine is owned
               by exactly one chunk: the one whose stretch of spine [s0, s1) the cell centre projects onto.
               Chunks therefore tile the corridor without gaps or overlaps (terrain meshes meet exactly).
  3. per chunk: the terrain heights over its bounding box, its cell mask (row runs), and the features it owns
               (buildings / trees / POIs by the owning cell of their centre; roads, water and landuse clipped to the
               chunk's box so the painted ground runs on across the seams).

Writes public/districts/<id>.json (index: spine, chunk boxes, spawn, portal) and public/districts/<id>/cNN.json.
All chunks share ONE district frame (origin = corridor centre), so walking between chunks needs no re-origin.

Optional building attributes (from a MassGIS + LiDAR pass, written to $SHREWSBURY_OUT/geojson/buildings_lidar.geojson):
height_m (eave), ridge_m, roof_type flat|gable|hip|shed|complex, ridge_azimuth_deg, height_source. When the file is
present they replace the estimates for the buildings they match (same id, or a LiDAR footprint containing the OSM one's
centre); unmatched LiDAR footprints are added as plain buildings. Absent: the OSM estimates are used.
"""
import heapq, json, math

import numpy as np
from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.ops import linemerge, unary_union
from shapely.strtree import STRtree
from shapely.prepared import prep

import districts as D

PAD = 40          # drawn beyond the walkable edge (m)
LATTICE = 10      # m, = terrain cell
ROOF_KIND = {"flat": 0, "gable": 1, "hip": 2, "shed": 3, "complex": 2, "gambrel": 1, "mansard": 2}


def roof_fields(p):
    """(height dm, roof kind 0 flat|1 gable|2 hip|3 shed, ridge angle (map frame, rad), eave dm or 0 = estimate)."""
    if p.get("height_m") is not None:
        eave = float(p["height_m"]); ridge = float(p.get("ridge_m") or eave)
        kind = ROOF_KIND.get(p.get("roof_type") or "flat", 0)
        ang = math.radians(90 - float(p["ridge_azimuth_deg"])) if p.get("ridge_azimuth_deg") is not None else p.get("ridge", 0)
        return D.dm(max(ridge, eave)), kind, ang, D.dm(max(eave, 2.0))
    return D.dm(p["height"]), 1 if p.get("roof") == "gable" else 0, p.get("ridge", 0), 0


def lidar_buildings():
    fs = D.load("buildings_lidar")
    if fs: print("  buildings_lidar.geojson:", len(fs), "footprints")
    return fs


def spine_of(name, town):
    """The longest connected run of the street inside the town (+100 m), as one LineString (west/south first)."""
    parts = [shape(f["geometry"]) for f in D.roads if f["properties"].get("name") == name and f["properties"]["cls"] not in D.SKIP_ROADS]
    m = linemerge(unary_union(parts))
    lines = [g for g in getattr(m, "geoms", [m]) if g.length > 1]
    key = lambda c: (round(c[0]), round(c[1]))
    adj = {}
    for k, g in enumerate(lines):
        a, b = key(g.coords[0]), key(g.coords[-1])
        adj.setdefault(a, []).append((b, g.length, k, False)); adj.setdefault(b, []).append((a, g.length, k, True))

    def far(src):
        dist = {src: 0}; prev = {}; q = [(0, src)]
        while q:
            d0, u = heapq.heappop(q)
            if d0 > dist[u]: continue
            for v, w, k, rev in adj[u]:
                if d0 + w < dist.get(v, 1e18): dist[v] = d0 + w; prev[v] = (u, k, rev); heapq.heappush(q, (d0 + w, v))
        end = max(dist, key=dist.get)
        return end, dist[end], prev

    best = None
    seen = set()
    for n0 in adj:  # one double sweep per connected component (tree-diameter heuristic)
        if n0 in seen: continue
        a, _, prev = far(n0)
        seen.update(prev.keys()); seen.add(n0)
        b, L, prev = far(a)
        if best is None or L > best[0]: best = (L, a, b, prev)
    _, a, b, prev = best
    coords = []; u = b
    while u != a:
        p, k, rev = prev[u]
        c = list(lines[k].coords)
        c = c[::-1] if not rev else c  # walk b -> a
        coords += c if not coords else c[1:]
        u = p
    g = LineString(coords[::-1])
    g = g.intersection(town.buffer(100))
    if g.geom_type != "LineString": g = max(getattr(g, "geoms", [g]), key=lambda x: x.length)
    if (g.coords[0][0] > g.coords[-1][0]): g = LineString(list(g.coords)[::-1])  # west → east
    return g


def build_corridor(d, town):
    B = float(d.get("buffer", 180)); CH = float(d.get("chunk", 400))
    spine = spine_of(d["street"], town)
    L = spine.length
    nchunks = max(1, round(L / CH)); CH = L / nchunks
    minx, miny, maxx, maxy = spine.bounds
    cx = round((minx + maxx) / 2 / LATTICE) * LATTICE; cy = round((miny + maxy) / 2 / LATTICE) * LATTICE
    gx = D.GX(cx, cy)
    walk = spine.buffer(B, quad_segs=4); draw = spine.buffer(B + PAD, quad_segs=4)
    # cell ownership on the global 10 m lattice (cell (i, j) = [i*10, i*10+10] x [j*10, j*10+10] in pipeline metres)
    x0, y0, x1, y1 = draw.bounds
    I0, J0, I1, J1 = int(x0 // LATTICE), int(y0 // LATTICE), int(x1 // LATTICE) + 1, int(y1 // LATTICE) + 1
    owner = {}
    pdraw = prep(draw)
    for j in range(J0, J1):
        for i in range(I0, I1):
            p = Point(i * LATTICE + 5, j * LATTICE + 5)
            if pdraw.contains(p):
                owner[(i, j)] = min(nchunks - 1, int(spine.project(p) // CH))
    own = lambda x, y: owner.get((int(x // LATTICE), int(y // LATTICE)), -1)
    zbase = min(D.zat(i * LATTICE, j * LATTICE) for (i, j) in owner)

    names = {}
    def nm(s, out):
        if not s: return -1
        if s not in out["_n"]: out["_n"][s] = len(out["names"]); out["names"].append(s)
        return out["_n"][s]

    chunks = [{"names": [], "_n": {}, "roads": [], "buildings": [], "colliders": [], "water": [], "landuse": [], "trees": [], "pois": []} for _ in range(nchunks)]
    cells_of = [[] for _ in range(nchunks)]
    for (i, j), k in owner.items(): cells_of[k].append((i, j))
    boxes = []
    for k, cs in enumerate(cells_of):
        ii = [c[0] for c in cs]; jj = [c[1] for c in cs]
        boxes.append((min(ii), min(jj), max(ii) + 1, max(jj) + 1))  # lattice vertex range
    mbox = [box(b[0] * LATTICE - 2, b[1] * LATTICE - 2, b[2] * LATTICE + 2, b[3] * LATTICE + 2) for b in boxes]

    # roads (clipped per chunk box)
    for f in D.roads:
        p = f["properties"]
        if p["cls"] in D.SKIP_ROADS or p.get("tunnel"): continue
        g0 = shape(f["geometry"])
        if not g0.intersects(draw): continue
        for k, mb in enumerate(mbox):
            if not g0.intersects(mb): continue
            g = g0.intersection(mb)
            for part in getattr(g, "geoms", [g]):
                if part.geom_type != "LineString" or part.length < 2: continue
                seg = max(1, int(part.length // 6))
                pts = [part.interpolate(t / seg, normalized=True) for t in range(seg + 1)]
                width = p.get("width") or 6
                if p["cls"] in D.PATHS: width = min(width, 2.2)
                chunks[k]["roads"].append([p["cls"], round(float(width), 1), nm(p.get("name") or p.get("ref"), chunks[k]),
                                           D.ring_dm([(q.x, q.y) for q in pts], cx, cy), 1 if p.get("bridge") else 0])

    # buildings: OSM footprints, with LiDAR attributes / MassGIS footprints where available
    poi_by_building = {}
    for f in D.pois:
        q = f["properties"]
        if q.get("building"): poi_by_building.setdefault(q["building"], q)
    lid = [f for f in lidar_buildings() if draw.intersects(shape(f["geometry"]))]
    lid_geo = [shape(f["geometry"]) for f in lid]
    tree = STRtree(lid_geo) if lid_geo else None
    lid_by_id = {f["properties"].get("id") or f["properties"].get("osm_id"): k for k, f in enumerate(lid)}
    used = set()
    items = []
    for f in D.buildings:
        g = shape(f["geometry"])
        if g.geom_type == "MultiPolygon": g = max(g.geoms, key=lambda a: a.area)
        c = g.representative_point()
        if not draw.contains(c) or g.area < 8: continue
        p = dict(f["properties"])
        k = lid_by_id.get(p["id"])
        if k is None and tree is not None:
            for h in tree.query(c):
                if lid_geo[h].contains(c) and h not in used: k = int(h); break
        if k is not None:
            used.add(k); q = lid[k]["properties"]
            p.update({a: q[a] for a in ("height_m", "ridge_m", "roof_type", "ridge_azimuth_deg", "height_source") if q.get(a) is not None})
            lg = lid_geo[k]
            if lg.geom_type == "MultiPolygon": lg = max(lg.geoms, key=lambda a: a.area)
            g = lg
        items.append((g, p))
    for k, f in enumerate(lid):
        if k in used: continue
        g = lid_geo[k]
        if g.geom_type == "MultiPolygon": g = max(g.geoms, key=lambda a: a.area)
        if g.area >= 8 and draw.contains(g.representative_point()): items.append((g, dict(f["properties"], id=f"lidar-{k}", type=f["properties"].get("type", "yes"), height=f["properties"].get("height_m", 6))))
    lidar_n = 0
    for g, p in items:
        c = g.representative_point(); k = own(c.x, c.y)
        if k < 0: continue
        g = g.simplify(0.25, preserve_topology=True)
        ring = list(g.exterior.coords)[:-1]
        if len(ring) < 3: continue
        if Polygon(ring).exterior.is_ccw: ring = ring[::-1]
        poi = poi_by_building.get(p["id"])
        cat = p.get("category") or (poi and poi.get("category"))
        base = min(D.zat(x, y) for x, y in ring) - zbase
        hgt, roof, ang, eave = roof_fields(p)
        lidar_n += 1 if eave else 0
        rec = [D.ring_dm(ring, cx, cy), hgt, roof, round(-ang, 3) if roof else 0, D.CATS.index(cat) if cat in D.CATS else -1, D.dm(base), p.get("type", "yes")]
        if eave: rec.append(eave)
        chunks[k]["buildings"].append(rec)
        if walk.buffer(5).contains(c): chunks[k]["colliders"] += D.colliders_for(g, gx)

    for f in D.water:
        g0 = shape(f["geometry"])
        if not g0.intersects(draw): continue
        for k, mb in enumerate(mbox):
            if not g0.intersects(mb): continue
            g = g0.intersection(mb).simplify(0.5)
            for part in getattr(g, "geoms", [g]):
                if part.geom_type != "Polygon" or part.area < 20: continue
                chunks[k]["water"].append([D.ring_dm(list(part.exterior.coords)[:-1], cx, cy), [D.ring_dm(list(i.coords)[:-1], cx, cy) for i in part.interiors],
                                           round(f["properties"].get("level", zbase) - zbase, 2), f["properties"].get("name")])
    for f in D.landuse:
        cls = f["properties"]["class"]
        if cls not in D.LANDUSE_KEEP: continue
        g0 = shape(f["geometry"])
        if not g0.intersects(draw): continue
        for k, mb in enumerate(mbox):
            if not g0.intersects(mb): continue
            g = g0.intersection(mb).simplify(0.5)
            for part in getattr(g, "geoms", [g]):
                if part.geom_type != "Polygon" or part.area < 30: continue
                chunks[k]["landuse"].append([cls, D.ring_dm(list(part.exterior.coords)[:-1], cx, cy), [D.ring_dm(list(i.coords)[:-1], cx, cy) for i in part.interiors], f["properties"].get("name")])
    for f in D.trees:
        x, y = f["geometry"]["coordinates"][:2]
        k = own(x, y)
        if k >= 0: chunks[k]["trees"] += [D.dm(x - cx), D.dm(-(y - cy))]
    for ch in chunks:
        if len(ch["trees"]) > 2 * 1200:
            t = ch["trees"]; step = len(t) // 2 / 1200
            ch["trees"] = [v for q in range(1200) for v in t[2 * int(q * step):2 * int(q * step) + 2]]
    corridor_pos = {}
    for f in D.pois:
        q = f["properties"]
        k = own(q["x"], q["y"])
        if k >= 0 and walk.buffer(20).contains(Point(q["x"], q["y"])):
            chunks[k]["pois"].append(q["id"]); corridor_pos[q["id"]] = [round(q["x"] - cx, 1), round(-(q["y"] - cy), 1)]

    # terrain per chunk: heights over the chunk's lattice box (rows north → south), + its cell mask as row runs
    files = []
    for k, ch in enumerate(chunks):
        bi0, bj0, bi1, bj1 = boxes[k]
        nx, nz = bi1 - bi0 + 1, bj1 - bj0 + 1
        cm = [int(round((D.zat(i * LATTICE, j * LATTICE) - zbase) * 100)) for j in range(bj1, bj0 - 1, -1) for i in range(bi0, bi1 + 1)]
        runs = []
        for r, j in enumerate(range(bj1 - 1, bj0 - 1, -1)):  # cell row r (north first) spans lattice rows r..r+1
            row, start = [], None
            for i in range(bi0, bi1 + 1):
                inside = owner.get((i, j)) == k and i < bi1
                if inside and start is None: start = i - bi0
                if not inside and start is not None: row += [start, i - bi0]; start = None
            runs.append(row)
        ch["terrain"] = {"nx": nx, "nz": nz, "cell": LATTICE, "ox": bi0 * LATTICE - cx, "oz": -(bj1 * LATTICE - cy), "cm": cm, "mask": runs}
        ch["id"] = d["id"]; ch["chunk"] = k; ch["zBase"] = round(zbase, 2)
        del ch["_n"]
        files.append(ch)

    # spawn: on the street nearest the named place (or the middle), facing along it
    places = [p for p in D.man.get("places", []) if p.get("kind") != "street" and walk.contains(Point(p["x"], p["y"]))]
    at = next((p for p in D.man.get("places", []) if p["name"] == d.get("spawnAt")), None)
    t = spine.project(Point(at["x"], at["y"])) if at else L / 2
    a = spine.interpolate(t); b = spine.interpolate(min(L, t + 14))
    face = math.atan2(b.x - a.x, -(b.y - a.y))
    foot = [shape(f["geometry"]) for f in D.buildings if a.buffer(80).contains(shape(f["geometry"]).representative_point())]
    slots = []
    for q, dt in enumerate([6, -6, 11, -11, 16, -16, 22, -22, 28, -28, 34, -34]):
        tt = min(max(t + dt, 0), L - 1)
        p0 = spine.interpolate(tt); p1 = spine.interpolate(tt + 1)
        dx, dy = p1.x - p0.x, p1.y - p0.y; l = math.hypot(dx, dy) or 1
        side = 1 if q % 2 == 0 else -1
        px, py = p0.x - dy / l * 5.5 * side, p0.y + dx / l * 5.5 * side
        if any(fp.distance(Point(px, py)) < 1.2 for fp in foot): continue
        slots.append([round(px - cx, 1), round(-(py - cy), 1), round(math.atan2(p0.x - px, -(p0.y - py)), 3)])
    dx, dy = b.x - a.x, b.y - a.y; l = math.hypot(dx, dy) or 1
    px, py = b.x, b.y
    for side in (1, -1):
        qx, qy = b.x - dy / l * 10 * side, b.y + dx / l * 10 * side
        if not any(fp.distance(Point(qx, qy)) < 5 for fp in foot): px, py = qx, qy; break
    portal = [round(px - cx, 1), round(-(py - cy), 1), round(math.atan2(b.x - px, -(b.y - py)), 3)]
    spine_s = spine.simplify(2)
    index = {"id": d["id"], "kind": "corridor", "name": d["name"], "street": d["street"], "centre": [cx, cy], "buffer": B,
             "length": round(L), "zBase": round(zbase, 2), "spine": D.ring_dm(list(spine_s.coords), cx, cy),
             "chunks": [], "spawn": [round(a.x - cx, 1), round(-(a.y - cy), 1), round(face, 3)], "portal": portal, "slots": slots[:10],
             "places": [[p["name"], round(p["x"] - cx, 1), round(-(p["y"] - cy), 1)] for p in places]}
    return index, files, corridor_pos, own, (cx, cy), lidar_n


def main(cfg, dst, summary, meta):
    town = shape(D.load("boundary")[0]["geometry"])
    positions = {}
    for d in cfg:
        if d.get("kind") != "corridor": continue
        index, files, cpos, _, _, lidar_n = build_corridor(d, town)
        folder = dst / d["id"]; folder.mkdir(parents=True, exist_ok=True)
        for old in folder.glob("c*.json"): old.unlink()
        total = 0
        for ch in files:
            s = json.dumps(ch, separators=(",", ":"))
            name = f"c{ch['chunk']:02d}.json"
            (folder / name).write_text(s); total += len(s)
            t = ch["terrain"]
            index["chunks"].append({"file": f"{d['id']}/{name}", "box": [t["ox"], t["oz"], t["ox"] + (t["nx"] - 1) * t["cell"], t["oz"] + (t["nz"] - 1) * t["cell"]],
                                    "bytes": len(s), "buildings": len(ch["buildings"])})
        streets = sorted({n for ch in files for n in ch["names"]})
        s = json.dumps(index, separators=(",", ":"))
        (dst / f"{d['id']}.json").write_text(s); total += len(s)
        summary[d["id"]] = {"kind": "corridor", "length_m": index["length"], "chunks": len(files), "buildings": sum(len(c["buildings"]) for c in files),
                            "lidar_buildings": lidar_n, "colliders": sum(len(c["colliders"]) for c in files), "trees": sum(len(c["trees"]) // 2 for c in files),
                            "pois": len(cpos), "streets": len(streets), "bytes": total, "largest_chunk": max(c["bytes"] for c in index["chunks"])}
        print(d["id"], summary[d["id"]])
        meta[d["id"]] = {"spawn": index["spawn"], "portal": index["portal"], "slots": index["slots"], "places": index["places"], "streets": streets}
        positions[d["id"]] = cpos
    return positions
