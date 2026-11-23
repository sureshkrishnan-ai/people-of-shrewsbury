import type { AABB } from '../layout'
import type { DistrictId } from './registry'

// The currently loaded district. Collision, routing, footsteps, landmarks and
// people all read from here, so only one district exists at a time.

export type Surface = 'asphalt' | 'pavers' | 'grass' | 'kota'
export type Pose = { x: number; z: number; face: number }
export type Spot = { label: string; blurb: string; slots: [number, number, number][] }

export type DistrictDef = {
  id: DistrictId
  colliders: AABB[]
  ground: (x: number, z: number) => number
  surface: (x: number, z: number) => Surface
  landmarks: { x: number; z: number; r: number; label: string }[]
  /** Fallback HUD sub-label when you're not near a landmark. */
  area: string
  /** Where you appear when you enter the game in this district. */
  spawn: Pose
  /** The portal ring (centre, facing) and where travellers step out of it. */
  portal: Pose
  arrival: Pose
  /** Spots people choose to hang out at (onboarding) — keyed by id. */
  spots: Record<string, Spot>
  /** Café-break spots for wandering residents. */
  breaks: Pose[]
  /** Positions birds sing from. */
  trees: { x: number; z: number }[]
  /** The radio the music leaks from while exploring (or none). */
  radio: [number, number, number] | null
  /** Camera orbit centre for the intro screen. */
  orbit: [number, number, number]
  /** Half the side of the walkable square (m). People of City's hand-built districts are all BOUNDS (46). */
  half?: number
  /** Keep a step inside the walkable area (corridors: the band along the street). Returns the point to stand on. */
  walkable?: (px: number, pz: number, x: number, z: number) => [number, number]
  /** Where (x, z) is, by name — a real-map district answers with the nearest street. Checked after landmarks. */
  placeAt?: (x: number, z: number) => string | null
}

/** The HUD label for a point: a landmark you're near, the street you're on, or the district's area. */
export const placeLabelAt = (d: DistrictDef, x: number, z: number) =>
  d.landmarks.find((l) => Math.hypot(l.x - x, l.z - z) < l.r)?.label ?? d.placeAt?.(x, z) ?? d.area

/** How far from the centre you can walk in this district. */
export const halfOf = (d: DistrictDef) => d.half ?? LEGACY_HALF
const LEGACY_HALF = 46

// ---- collider index -------------------------------------------------------------------------------
// The hand-built districts have a few hundred boxes; a real-map district has thousands, so collision and
// camera checks look colliders up in a coarse grid instead of scanning them all. Rebuilt when the
// list changes (a real-map district fills its colliders after its data loads).

const IDX_CELL = 12
type Index = { n: number; arr: AABB[]; cells: Map<number, AABB[]> }
const indexes = new WeakMap<DistrictDef, Index>()
const key = (i: number, j: number) => i * 100_003 + j

function indexOf(d: DistrictDef): Index {
  let ix = indexes.get(d)
  if (ix && ix.n === d.colliders.length && ix.arr === d.colliders) return ix
  ix = { n: d.colliders.length, arr: d.colliders, cells: new Map() }
  for (const b of d.colliders) {
    for (let i = Math.floor(b.min[0] / IDX_CELL); i <= Math.floor(b.max[0] / IDX_CELL); i++)
      for (let j = Math.floor(b.min[2] / IDX_CELL); j <= Math.floor(b.max[2] / IDX_CELL); j++) {
        const k = key(i, j)
        const list = ix.cells.get(k)
        if (list) list.push(b)
        else ix.cells.set(k, [b])
      }
  }
  indexes.set(d, ix)
  return ix
}

/** The colliders that may touch the square of radius r around (x, z) — a superset, each box once. */
export function collidersNear(x: number, z: number, r: number, d: DistrictDef = active.def): AABB[] {
  if (d.colliders.length < 400) return d.colliders
  const ix = indexOf(d)
  const out = new Set<AABB>()
  for (let i = Math.floor((x - r) / IDX_CELL); i <= Math.floor((x + r) / IDX_CELL); i++)
    for (let j = Math.floor((z - r) / IDX_CELL); j <= Math.floor((z + r) / IDX_CELL); j++) ix.cells.get(key(i, j))?.forEach((b) => out.add(b))
  return [...out]
}

const registry = new Map<DistrictId, DistrictDef>()
export const registerDistrict = (d: DistrictDef) => registry.set(d.id, d)
export const getDistrict = (id: DistrictId) => registry.get(id)!

export const active = { def: null as unknown as DistrictDef }

const listeners = new Set<(d: DistrictDef) => void>()
export const onDistrictChange = (fn: (d: DistrictDef) => void) => (listeners.add(fn), () => listeners.delete(fn))

export function activateDistrict(id: DistrictId) {
  const d = registry.get(id)
  if (!d || active.def === d) return
  active.def = d
  listeners.forEach((fn) => fn(d))
}
