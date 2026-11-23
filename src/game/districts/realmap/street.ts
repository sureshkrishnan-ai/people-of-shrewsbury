// Street detail for corridor chunks, placed from the map data alone (generic and stylised — design.md; nothing here
// is a real private detail): curbs, street lamps, utility poles + wires along the corridor's own street, stop signs
// and crosswalks where side streets meet it, and per house a mailbox, a driveway and sometimes a fence or a hedge,
// plus a few parked cars. Pure placement: StreetProps.tsx draws it, World.tsx paints the crosswalks and driveways.

import type { BuildingFoot, RealDistrict, Road } from './data'
import { ownsCell } from './data'
import { hash } from './palette'

export type Prop = { x: number; z: number; face: number }
export type Span = { ax: number; az: number; bx: number; bz: number }
export type Driveway = { ax: number; az: number; bx: number; bz: number; w: number }
export type Crosswalk = { x: number; z: number; face: number; w: number }
export type StreetDetail = {
  curbs: Span[]
  lamps: Prop[]
  poles: Prop[]
  /** wire spans between consecutive poles */
  wires: Span[]
  stops: Prop[]
  crosswalks: Crosswalk[]
  mailboxes: Prop[]
  driveways: Driveway[]
  fences: Span[]
  hedges: Span[]
  cars: (Prop & { color: number })[]
}

const CAR_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street'])
const BIG = new Set(['commercial', 'retail', 'office', 'industrial', 'supermarket', 'warehouse', 'school', 'university', 'hospital', 'church', 'civic', 'public', 'apartments', 'hotel'])
export const isHouse = (b: BuildingFoot) => !BIG.has(b.type) && b.category < 0 && b.height <= 11 && ringArea(b) < 400

function ringArea(b: BuildingFoot) {
  let a = 0
  const r = b.ring
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1])
  return Math.abs(a / 2)
}

/** Walk a road at a fixed spacing; calls back with the point, the unit direction and the left normal. */
function walk(r: Road, step: number, start: number, fn: (x: number, z: number, dx: number, dz: number, k: number) => void) {
  let acc = start
  let k = 0
  for (let i = 0; i + 1 < r.pts.length; i++) {
    const [ax, az] = r.pts[i]
    const [bx, bz] = r.pts[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    if (!len) continue
    const dx = (bx - ax) / len
    const dz = (bz - az) / len
    let t = step - acc
    while (t <= len) {
      fn(ax + dx * t, az + dz * t, dx, dz, k++)
      t += step
    }
    acc = (acc + len) % step
  }
}

type Near = { d: number; x: number; z: number; dx: number; dz: number; r: Road }
function nearestRoad(roads: Road[], x: number, z: number, reach: number): Near | null {
  let best: Near | null = null
  for (const r of roads) {
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i]
      const [bx, bz] = r.pts[i + 1]
      if (Math.min(ax, bx) - reach > x || Math.max(ax, bx) + reach < x || Math.min(az, bz) - reach > z || Math.max(az, bz) + reach < z) continue
      const ddx = bx - ax
      const ddz = bz - az
      const l2 = ddx * ddx + ddz * ddz
      if (!l2) continue
      const t = Math.max(0, Math.min(1, ((x - ax) * ddx + (z - az) * ddz) / l2))
      const qx = ax + ddx * t
      const qz = az + ddz * t
      const d = Math.hypot(x - qx, z - qz) - r.width / 2
      if (d < reach && (!best || d < best.d)) {
        const l = Math.sqrt(l2)
        best = { d, x: qx, z: qz, dx: ddx / l, dz: ddz / l, r }
      }
    }
  }
  return best
}

/** Everything for one chunk (or a square district). `street` is the corridor's own street (poles, stop signs). */
export function streetDetail(d: RealDistrict, street: string | null): StreetDetail {
  const out: StreetDetail = { curbs: [], lamps: [], poles: [], wires: [], stops: [], crosswalks: [], mailboxes: [], driveways: [], fences: [], hedges: [], cars: [] }
  const owns = (x: number, z: number) => d.chunk === null || ownsCell(d.terrain, x, z)
  const car = d.roads.filter((r) => CAR_ROADS.has(r.cls) && !r.bridge)
  const main = car.filter((r) => r.name === street)
  const blocked = (x: number, z: number, pad: number) => !!nearestRoad(car, x, z, pad) // on (or within pad of) a carriageway

  for (const r of car) {
    const off = r.width / 2
    // curbs: one span per polyline segment, both sides
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i]
      const [bx, bz] = r.pts[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      if (len < 0.5 || !owns((ax + bx) / 2, (az + bz) / 2)) continue
      const nx = -(bz - az) / len
      const nz = (bx - ax) / len
      for (const s of [1, -1]) out.curbs.push({ ax: ax + nx * (off + 0.1) * s, az: az + nz * (off + 0.1) * s, bx: bx + nx * (off + 0.1) * s, bz: bz + nz * (off + 0.1) * s })
    }
    // street lamps: tighter on the main roads, alternating sides
    const big = r.cls !== 'residential' && r.cls !== 'unclassified' && r.cls !== 'living_street'
    walk(r, big ? 32 : 48, hash(r.pts[0][0] + r.pts[0][1]) % 20, (x, z, dx, dz, k) => {
      const s = k % 2 ? 1 : -1
      const px = x - dz * (off + 1.1) * s
      const pz = z + dx * (off + 1.1) * s
      if (!owns(px, pz) || blocked(px, pz, 0.6)) return
      out.lamps.push({ x: px, z: pz, face: Math.atan2(dz * s, -dx * s) })
    })
    // parked cars along the curb of residential streets, now and then
    if (!big)
      walk(r, 23, 7, (x, z, dx, dz, k) => {
        const hsh = hash(x * 3.1 + z * 7.7 + k)
        if (hsh % 9) return
        const s = hsh & 16 ? 1 : -1
        const px = x - dz * (off - 1.15) * s
        const pz = z + dx * (off - 1.15) * s
        if (!owns(px, pz) || r.width < 6) return
        out.cars.push({ x: px, z: pz, face: Math.atan2(dx, dz), color: hsh >> 5 })
      })
  }

  // utility poles with wires along the corridor street, one side (the right side going east)
  for (const r of main) {
    const off = r.width / 2 + 2.3
    let prev: Prop | null = null
    walk(r, 40, 12, (x, z, dx, dz) => {
      const px = x + dz * off
      const pz = z - dx * off
      if (blocked(px, pz, 0.8)) return void (prev = null)
      const p = { x: px, z: pz, face: Math.atan2(dx, dz) }
      if (owns(px, pz)) out.poles.push(p)
      if (prev && (owns(px, pz) || owns(prev.x, prev.z))) out.wires.push({ ax: prev.x, az: prev.z, bx: px, bz: pz })
      prev = p
    })
  }

  // side streets meeting the corridor street: a stop sign on the right and a crosswalk across the mouth
  if (main.length)
    for (const r of car) {
      if (r.name === street || r.pts.length < 2) continue
      for (const end of [0, r.pts.length - 1]) {
        const [ex, ez] = r.pts[end]
        const m = nearestRoad(main, ex, ez, 4)
        if (!m) continue
        const [ix, iz] = r.pts[end === 0 ? 1 : r.pts.length - 2]
        const l = Math.hypot(ix - ex, iz - ez) || 1
        const ux = (ix - ex) / l // into the side street
        const uz = (iz - ez) / l
        const back = m.r.width / 2 + 2.2
        const cx = ex + ux * back
        const cz = ez + uz * back
        if (!owns(cx, cz)) continue
        out.crosswalks.push({ x: cx, z: cz, face: Math.atan2(ux, uz), w: r.width })
        // traffic drives on the right: the stop sign faces cars coming out of the side street, on their right
        const sx = cx + ux * 1.6 - uz * (r.width / 2 + 0.9)
        const sz = cz + uz * 1.6 + ux * (r.width / 2 + 0.9)
        out.stops.push({ x: sx, z: sz, face: Math.atan2(ux, uz) })
      }
    }

  // houses: mailbox at the curb, a driveway beside the house, and a fence or hedge along some lot fronts
  for (const b of d.buildings) {
    if (!isHouse(b) || !owns(b.cx, b.cz)) continue
    const n = nearestRoad(car, b.cx, b.cz, 45)
    if (!n) continue
    const vx = b.cx - n.x
    const vz = b.cz - n.z
    const vl = Math.hypot(vx, vz) || 1
    const ox = vx / vl
    const oz = vz / vl
    const off = n.r.width / 2
    const seed = hash(b.cx * 13 + b.cz * 29)
    const side = seed & 1 ? 1 : -1
    // driveway: from the road edge to the house, 4 m to one side of its centre
    const sx = n.dx * side * 5
    const sz = n.dz * side * 5
    const reach = Math.max(4, vl - 4)
    out.driveways.push({ ax: n.x + ox * off + sx, az: n.z + oz * off + sz, bx: n.x + ox * reach + sx, bz: n.z + oz * reach + sz, w: 3 })
    const mx = n.x + ox * (off + 0.7) + n.dx * side * 3.2
    const mz = n.z + oz * (off + 0.7) + n.dz * side * 3.2
    if (owns(mx, mz) && !blocked(mx, mz, 0.4)) out.mailboxes.push({ x: mx, z: mz, face: Math.atan2(-ox, -oz) })
    const kind = seed % 5
    if (kind > 1) continue
    const fx = n.x + ox * (off + 2.4)
    const fz = n.z + oz * (off + 2.4)
    const span = { ax: fx - n.dx * side * 2, az: fz - n.dz * side * 2, bx: fx - n.dx * side * 9, bz: fz - n.dz * side * 9 }
    if (blocked(span.bx, span.bz, 0.5)) continue
    ;(kind === 0 ? out.hedges : out.fences).push(span)
  }
  return out
}
