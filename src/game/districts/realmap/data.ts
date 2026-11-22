// Real-map districts: the compact files pipeline/districts.py writes to public/districts/<id>.json,
// decoded into what the game needs (metres, game frame: x east, z south, y up).

import type { AABB } from '../../layout'

/** As stored: coordinates are integer decimetres. */
type RawDistrict = {
  id: string
  name: string
  centre: [number, number]
  half: number
  zBase: number
  terrain: { n: number; cell: number; origin: number; cm: number[] }
  names: string[]
  /** [class, width m, name index, flat [x,z] dm, bridge] */
  roads: [string, number, number, number[], number][]
  /** [ring dm, height dm, gable 0|1, ridge angle, category index | -1, base dm, OSM building type] */
  buildings: [number[], number, number, number, number, number, string][]
  /** [x0, z0, x1, z1] dm */
  colliders: [number, number, number, number][]
  /** [outer ring dm, holes, level m above zBase, name] */
  water: [number[], number[][], number, string | null][]
  /** [class, outer ring dm, holes, name] */
  landuse: [string, number[], number[][], string | null][]
  trees: number[]
  pois: string[]
  spawn: [number, number, number]
  portal: [number, number, number]
}

export type Ring = [number, number][]
export type Road = { cls: string; width: number; name: string | null; pts: Ring; bridge: boolean }
export type BuildingFoot = { ring: Ring; height: number; gable: boolean; ridge: number; category: number; base: number; type: string; cx: number; cz: number }
export type Water = { outer: Ring; holes: Ring[]; level: number; name: string | null }
export type Landuse = { cls: string; outer: Ring; holes: Ring[]; name: string | null }

export type RealDistrict = {
  id: string
  half: number
  zBase: number
  terrain: { n: number; cell: number; origin: number; h: Float32Array }
  roads: Road[]
  buildings: BuildingFoot[]
  colliders: AABB[]
  water: Water[]
  landuse: Landuse[]
  trees: Ring
  pois: string[]
  streets: string[]
  spawn: { x: number; z: number; face: number }
  portal: { x: number; z: number; face: number }
}

const ring = (flat: number[]): Ring => {
  const r: Ring = []
  for (let i = 0; i + 1 < flat.length; i += 2) r.push([flat[i] / 10, flat[i + 1] / 10])
  return r
}

export function decode(raw: RawDistrict): RealDistrict {
  const n = raw.terrain.n
  const h = new Float32Array(n * n)
  for (let i = 0; i < n * n; i++) h[i] = raw.terrain.cm[i] / 100
  const water = raw.water.map(([o, holes, level, name]) => ({ outer: ring(o), holes: holes.map(ring), level, name }))
  // the DEM is the lake's surface: sink the ground under open water so the shore reads as a shore
  const t = { n, cell: raw.terrain.cell, origin: raw.terrain.origin, h }
  for (const w of water) {
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = t.origin + i * t.cell
        const z = t.origin + j * t.cell
        if (inRing(w.outer, x, z) && !w.holes.some((hl) => inRing(hl, x, z))) h[j * n + i] = Math.min(h[j * n + i], w.level - 1.6)
      }
  }
  return {
    id: raw.id,
    half: raw.half,
    zBase: raw.zBase,
    terrain: t,
    roads: raw.roads.map(([cls, width, ni, pts, bridge]) => ({ cls, width, name: ni >= 0 ? raw.names[ni] : null, pts: ring(pts), bridge: !!bridge })),
    buildings: raw.buildings.map(([r, hh, g, ridge, cat, base, type]) => {
      const rr = ring(r)
      let cx = 0
      let cz = 0
      for (const [x, z] of rr) ((cx += x), (cz += z))
      return { ring: rr, height: hh / 10, gable: !!g, ridge, category: cat, base: base / 10, type, cx: cx / rr.length, cz: cz / rr.length }
    }),
    colliders: raw.colliders.map(([x0, z0, x1, z1]) => ({ min: [x0 / 10, -5, z0 / 10], max: [x1 / 10, 80, z1 / 10] }) as AABB),
    water,
    landuse: raw.landuse.map(([cls, o, holes, name]) => ({ cls, outer: ring(o), holes: holes.map(ring), name })),
    trees: ring(raw.trees),
    pois: raw.pois,
    streets: raw.names,
    spawn: { x: raw.spawn[0], z: raw.spawn[1], face: raw.spawn[2] },
    portal: { x: raw.portal[0], z: raw.portal[1], face: raw.portal[2] },
  }
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

/** Bilinear ground height at (x, z). */
export function heightAt(t: RealDistrict['terrain'], x: number, z: number) {
  const fx = Math.min(Math.max((x - t.origin) / t.cell, 0), t.n - 1.001)
  const fz = Math.min(Math.max((z - t.origin) / t.cell, 0), t.n - 1.001)
  const i = Math.floor(fx)
  const j = Math.floor(fz)
  const u = fx - i
  const v = fz - j
  const a = t.h[j * t.n + i]
  const b = t.h[j * t.n + i + 1]
  const c = t.h[(j + 1) * t.n + i]
  const d = t.h[(j + 1) * t.n + i + 1]
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

/** Loads a district's file once (the browser caches it too). */
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
