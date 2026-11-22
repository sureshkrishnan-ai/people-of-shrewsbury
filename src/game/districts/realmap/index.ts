// Registers every district in the city config as a real-map district. Its definition exists at once
// (spawn, portal and standing slots come from src/city/data/districts-meta.json, written by the pipeline);
// the heavy part — terrain, streets, buildings, colliders — fills in when its file loads (data.ts).

import { CITY } from '@/city/config'
import metaJson from '@/city/data/districts-meta.json'
import type { AABB } from '../../layout'
import { registerDistrict, getDistrict, type DistrictDef, type Pose, type Spot, type Surface } from '../active'
import { heightAt, inRing, loadDistrict, segDist, type RealDistrict } from './data'
import { businessesIn } from '@/city/businesses'

type Meta = { spawn: [number, number, number]; portal: [number, number, number]; slots: [number, number, number][]; places: [string, number, number][]; streets: string[] }
const META = metaJson as unknown as Record<string, Meta>


const loaded = new Map<string, RealDistrict>()
const listeners = new Set<(id: string) => void>()
export const onRealLoaded = (fn: (id: string) => void) => (listeners.add(fn), () => listeners.delete(fn))
export const realData = (id: string) => loaded.get(id)

// ---- street lookup (HUD label, footsteps) --------------------------------------------------------
type Seg = { ax: number; az: number; bx: number; bz: number; w: number; name: string | null; cls: string }
const ROAD_CELL = 20
const segIndex = new Map<string, Map<number, Seg[]>>()

function indexRoads(d: RealDistrict) {
  const cells = new Map<number, Seg[]>()
  for (const r of d.roads) {
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i]
      const [bx, bz] = r.pts[i + 1]
      const s: Seg = { ax, az, bx, bz, w: r.width, name: r.name, cls: r.cls }
      const k = Math.floor((ax + bx) / 2 / ROAD_CELL) * 1000 + Math.floor((az + bz) / 2 / ROAD_CELL)
      const list = cells.get(k)
      if (list) list.push(s)
      else cells.set(k, [s])
    }
  }
  segIndex.set(d.id, cells)
}

/** The road (segment) nearest (x, z) within `reach` m of its edge. */
export function roadAt(id: string, x: number, z: number, reach = 0): Seg | null {
  const cells = segIndex.get(id)
  if (!cells) return null
  let best: Seg | null = null
  let bd = Infinity
  const ci = Math.floor(x / ROAD_CELL)
  const cj = Math.floor(z / ROAD_CELL)
  for (let i = ci - 1; i <= ci + 1; i++)
    for (let j = cj - 1; j <= cj + 1; j++)
      for (const s of cells.get(i * 1000 + j) ?? []) {
        const d = segDist(x, z, s.ax, s.az, s.bx, s.bz) - s.w / 2
        if (d < reach && d < bd) ((bd = d), (best = s))
      }
  return best
}

const PATHS = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'steps'])
const GREEN = new Set(['park', 'grass', 'sports', 'cemetery', 'golf', 'wood', 'farmland', 'wetland'])

function surfaceAt(id: string, x: number, z: number): Surface {
  const r = roadAt(id, x, z, 0)
  if (r) return PATHS.has(r.cls) ? 'pavers' : 'asphalt'
  const d = loaded.get(id)
  if (d && d.landuse.some((l) => GREEN.has(l.cls) && inRing(l.outer, x, z))) return 'grass'
  return roadAt(id, x, z, 2.5) ? 'pavers' : 'grass'
}

/** The portal ring's two pillars, for a ring facing any direction. */
function portalColliders(px: number, pz: number, face: number): AABB[] {
  return [-1, 1].map((s) => {
    const cx = px + Math.cos(face) * 2.45 * s
    const cz = pz - Math.sin(face) * 2.45 * s
    return { min: [cx - 0.5, -5, cz - 0.5], max: [cx + 0.5, 60, cz + 0.5] } as AABB
  })
}

// ---- definitions ------------------------------------------------------------------------------
const pose = ([x, z, face]: [number, number, number]): Pose => ({ x, z, face })

for (const c of CITY.districts) {
  const m = META[c.id] ?? { spawn: [0, 0, 0], portal: [0, 12, Math.PI], slots: [[3, 3, 0]], places: [], streets: [] }
  const portal = pose(m.portal)
  const spots: Record<string, Spot> = {
    [`${c.id}-street`]: { label: c.title, blurb: `On ${c.title.toLowerCase().replace(/\b\w/g, (a) => a.toUpperCase())}`, slots: m.slots.slice(0, 4) },
    [`${c.id}-corner`]: { label: 'THE CORNER', blurb: 'A little further along the street', slots: m.slots.slice(4, 10).length ? m.slots.slice(4, 10) : m.slots.slice(0, 2) },
  }
  const biz = businessesIn(c.id)
  const def: DistrictDef = {
    id: c.id,
    colliders: [...portalColliders(portal.x, portal.z, portal.face)],
    ground: (x, z) => {
      const d = loaded.get(c.id)
      return d ? heightAt(d.terrain, x, z) : 0
    },
    surface: (x, z) => surfaceAt(c.id, x, z),
    landmarks: [
      { x: portal.x, z: portal.z, r: 5, label: 'PORTAL' },
      ...m.places.map(([label, x, z]) => ({ x, z, r: 30, label: label.toUpperCase() })),
      ...biz.filter((b) => b.pos && b.name).map((b) => ({ x: b.pos![0], z: b.pos![1], r: 9, label: b.name!.toUpperCase() })),
    ],
    area: c.title,
    spawn: pose(m.spawn),
    portal,
    arrival: { x: portal.x + Math.sin(portal.face) * 5, z: portal.z + Math.cos(portal.face) * 5, face: portal.face },
    spots,
    breaks: m.slots.slice(0, 6).map(pose),
    trees: [],
    radio: null,
    orbit: [m.spawn[0], 6, m.spawn[1]],
    half: c.half,
    placeAt: (x, z) => roadAt(c.id, x, z, 3)?.name?.toUpperCase() ?? null,
  }
  registerDistrict(def)
}

/** Fetch a district's map and fill in its definition (idempotent). */
export async function ensureRealDistrict(id: string): Promise<RealDistrict | null> {
  if (loaded.has(id)) return loaded.get(id)!
  if (!CITY.districts.some((d) => d.id === id)) return null
  const data = await loadDistrict(id)
  if (loaded.has(id)) return loaded.get(id)!
  const def = getDistrict(id)
  def.colliders.push(...data.colliders)
  def.trees = data.trees.filter((_, i) => i % 6 === 0).slice(0, 40).map(([x, z]) => ({ x, z }))
  indexRoads(data)
  def.orbit = [def.spawn.x, heightAt(data.terrain, def.spawn.x, def.spawn.z) + 3, def.spawn.z]
  loaded.set(id, data)
  listeners.forEach((fn) => fn(id))
  return data
}
