// Real-map districts: the compact files pipeline/districts.py writes to public/districts/<id>.json,
// decoded into what the game needs (metres, game frame: x east, z south, y up).

import type { AABB } from '../../layout'

/** As stored: coordinates are integer decimetres. */
type RawDistrict = {
  id: string
  name: string
  centre: [number, number]
  half?: number
  zBase: number
  /** square district: n×n samples from (origin, origin); corridor chunk: nx×nz from (ox, oz) + cell mask (row runs) */
  terrain: { n?: number; nx?: number; nz?: number; cell: number; origin?: number; ox?: number; oz?: number; cm: number[]; mask?: number[][] }
  /** corridor chunk number */
  chunk?: number
  names: string[]
  /** [class, width m, name index, flat [x,z] dm, bridge] */
  roads: [string, number, number, number[], number][]
  /** [ring dm, height dm (top), roof 0 flat|1 gable|2 hip|3 shed, ridge angle, category index | -1, base dm, OSM building type,
   *  eave dm (measured; 0/absent = estimate), steeple/cupola top dm (0/absent = none), height source 0 estimate|1 OSM|2 Overture|3 LiDAR] */
  buildings: [number[], number, number, number, number, number, string, number?, number?, number?][]
  /** [x0, z0, x1, z1] dm */
  colliders: [number, number, number, number][]
  /** [outer ring dm, holes, level m above zBase, name] */
  water: [number[], number[][], number, string | null][]
  /** [class, outer ring dm, holes, name] */
  landuse: [string, number[], number[][], string | null][]
  trees: number[]
  /** LiDAR trees, largest first: flat [x dm, z dm, height dm, crown radius dm, evergreen 0|1] */
  ltrees?: number[]
  /** share of the ground the LiDAR tree pass covered (0..1); covered ground gets no invented street trees */
  lidarCover?: number
  pois: string[]
  spawn?: [number, number, number]
  portal?: [number, number, number]
}

export type Ring = [number, number][]
export type Road = { cls: string; width: number; name: string | null; pts: Ring; bridge: boolean }
export type RoofKind = 'flat' | 'gable' | 'hip' | 'shed'
const ROOF_KINDS: RoofKind[] = ['flat', 'gable', 'hip', 'shed']
/** Where a building's height came from (pipeline/realbuildings.py). */
export type HeightSource = 'estimate' | 'osm' | 'overture' | 'lidar'
const HEIGHT_SOURCES: HeightSource[] = ['estimate', 'osm', 'overture', 'lidar']
/** height = top of the building above its base; eave = measured wall height (null: estimated from height);
 *  spire = top of a steeple or cupola above the base (0: none). */
export type BuildingFoot = { ring: Ring; height: number; gable: boolean; roof: RoofKind; eave: number | null; ridge: number; category: number; base: number; type: string; cx: number; cz: number; spire: number; src: HeightSource }
/** A LiDAR tree: trunk position, total height and crown radius (m). */
export type LidarTree = { x: number; z: number; h: number; r: number; ever: boolean }
export type Terrain = { nx: number; nz: number; cell: number; ox: number; oz: number; h: Float32Array; mask: number[][] | null }
export type Water = { outer: Ring; holes: Ring[]; level: number; name: string | null }
export type Landuse = { cls: string; outer: Ring; holes: Ring[]; name: string | null }

export type RealDistrict = {
  id: string
  /** "town-center" for a square district, "main-street#3" for a corridor chunk */
  key: string
  /** corridor chunk number, or null */
  chunk: number | null
  half: number
  zBase: number
  terrain: Terrain
  roads: Road[]
  buildings: BuildingFoot[]
  colliders: AABB[]
  water: Water[]
  landuse: Landuse[]
  trees: Ring
  /** LiDAR trees, largest first (empty where the LiDAR tree pass has not run) */
  ltrees: LidarTree[]
  lidarCover: number
  pois: string[]
  streets: string[]
}

const ring = (flat: number[]): Ring => {
  const r: Ring = []
  for (let i = 0; i + 1 < flat.length; i += 2) r.push([flat[i] / 10, flat[i + 1] / 10])
  return r
}

export function decode(raw: RawDistrict): RealDistrict {
  const rt = raw.terrain
  const nx = rt.nx ?? rt.n!
  const nz = rt.nz ?? rt.n!
  const h = new Float32Array(nx * nz)
  for (let i = 0; i < nx * nz; i++) h[i] = rt.cm[i] / 100
  const water = raw.water.map(([o, holes, level, name]) => ({ outer: ring(o), holes: holes.map(ring), level, name }))
  // the DEM is the lake's surface: sink the ground under open water so the shore reads as a shore
  const t: Terrain = { nx, nz, cell: rt.cell, ox: rt.ox ?? rt.origin!, oz: rt.oz ?? rt.origin!, h, mask: rt.mask ?? null }
  for (const w of water) {
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const x = t.ox + i * t.cell
        const z = t.oz + j * t.cell
        if (inRing(w.outer, x, z) && !w.holes.some((hl) => inRing(hl, x, z))) h[j * nx + i] = Math.min(h[j * nx + i], w.level - 1.6)
      }
  }
  const chunk = raw.chunk ?? null
  return {
    id: raw.id,
    key: chunk === null ? raw.id : `${raw.id}#${chunk}`,
    chunk,
    half: raw.half ?? 0,
    zBase: raw.zBase,
    terrain: t,
    roads: raw.roads.map(([cls, width, ni, pts, bridge]) => ({ cls, width, name: ni >= 0 ? raw.names[ni] : null, pts: ring(pts), bridge: !!bridge })),
    buildings: raw.buildings.map(([r, hh, g, ridge, cat, base, type, eave, spire, src]) => {
      const rr = ring(r)
      let cx = 0
      let cz = 0
      for (const [x, z] of rr) ((cx += x), (cz += z))
      const roof = ROOF_KINDS[g] ?? 'flat'
      return { ring: rr, height: hh / 10, gable: roof === 'gable', roof, eave: eave ? eave / 10 : null, ridge, category: cat, base: base / 10, type, cx: cx / rr.length, cz: cz / rr.length, spire: (spire ?? 0) / 10, src: HEIGHT_SOURCES[src ?? (eave ? 3 : 0)] ?? 'estimate' }
    }),
    colliders: raw.colliders.map(([x0, z0, x1, z1]) => ({ min: [x0 / 10, -5, z0 / 10], max: [x1 / 10, 80, z1 / 10] }) as AABB),
    water,
    landuse: raw.landuse.map(([cls, o, holes, name]) => ({ cls, outer: ring(o), holes: holes.map(ring), name })),
    trees: ring(raw.trees),
    ltrees: lidarTrees(raw.ltrees ?? []),
    lidarCover: raw.lidarCover ?? 0,
    pois: raw.pois,
    streets: raw.names,
  }
}

function lidarTrees(f: number[]): LidarTree[] {
  const out: LidarTree[] = []
  for (let i = 0; i + 4 < f.length; i += 5) out.push({ x: f[i] / 10, z: f[i + 1] / 10, h: f[i + 2] / 10, r: f[i + 3] / 10, ever: f[i + 4] === 1 })
  return out
}

export function inRing(r: Ring, x: number, z: number) {
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i]
    const [xj, zj] = r[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/** Does this terrain draw the 10 m cell under (x, z)? (Always, for a square district; the mask, for a corridor chunk.) */
export function ownsCell(t: Terrain, x: number, z: number) {
  const i = Math.floor((x - t.ox) / t.cell)
  const j = Math.floor((z - t.oz) / t.cell)
  if (i < 0 || j < 0 || i >= t.nx - 1 || j >= t.nz - 1) return false
  if (!t.mask) return true
  const row = t.mask[j]
  for (let k = 0; k + 1 < row.length; k += 2) if (i >= row[k] && i < row[k + 1]) return true
  return false
}

/** Bilinear ground height at (x, z). */
export function heightAt(t: Terrain, x: number, z: number) {
  const fx = Math.min(Math.max((x - t.ox) / t.cell, 0), t.nx - 1.001)
  const fz = Math.min(Math.max((z - t.oz) / t.cell, 0), t.nz - 1.001)
  const i = Math.floor(fx)
  const j = Math.floor(fz)
  const u = fx - i
  const v = fz - j
  const a = t.h[j * t.nx + i]
  const b = t.h[j * t.nx + i + 1]
  const c = t.h[(j + 1) * t.nx + i]
  const d = t.h[(j + 1) * t.nx + i + 1]
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

/** Distance from (x, z) to segment a–b. */
export function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax
  const dz = bz - az
  const l2 = dx * dx + dz * dz
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz))
}

const cache = new Map<string, Promise<RealDistrict>>()

/** Loads a district's file (or a corridor chunk: "main-street/c03") once; the browser caches it too. */
export function loadDistrict(id: string): Promise<RealDistrict> {
  let p = cache.get(id)
  if (!p) {
    p = fetch(`/districts/${id}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`district ${id}: ${r.status}`)
        return r.json() as Promise<RawDistrict>
      })
      .then(decode)
    p.catch(() => cache.delete(id))
    cache.set(id, p)
  }
  return p
}

/** A corridor's index file (pipeline/corridors.py): the street's spine and its chunks' boxes. */
export type CorridorIndex = {
  id: string
  kind: 'corridor'
  street: string
  buffer: number
  length: number
  zBase: number
  /** flat [x, z] dm, west → east */
  spine: number[]
  /** box = [x0, z0, x1, z1] m in the district frame */
  chunks: { file: string; box: [number, number, number, number]; bytes: number; buildings: number }[]
}

const indexCache = new Map<string, Promise<CorridorIndex>>()
export function loadCorridorIndex(id: string): Promise<CorridorIndex> {
  let p = indexCache.get(id)
  if (!p) {
    p = fetch(`/districts/${id}.json`).then((r) => {
      if (!r.ok) throw new Error(`corridor ${id}: ${r.status}`)
      return r.json() as Promise<CorridorIndex>
    })
    p.catch(() => indexCache.delete(id))
    indexCache.set(id, p)
  }
  return p
}
/** Drop a chunk's decoded data from memory (it was streamed out). */
export const forgetDistrict = (file: string) => cache.delete(file)
