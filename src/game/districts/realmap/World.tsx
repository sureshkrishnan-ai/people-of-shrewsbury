'use client'

// Draws a real-map district in the foundation's stylised look: one draped terrain mesh whose canvas
// texture carries the streets, pavements, parks and street names; footprint-extruded buildings merged
// into one mesh (walls) + one (roofs) with painted colours; instanced trees; flat lakes; business signs.
// A district is ~10 draw calls whatever its size, which keeps phones going.

import * as THREE from 'three'
import { useEffect, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { CATEGORY_COLOR, businessesIn, type Business, type BusinessCategory } from '@/city/businesses'
import { Portal } from '../../world/Portal'
import { getDistrict } from '../active'
import { applyGroundGrade } from '../../materials'
import { useQuality } from '../../device'
import { useEconomy } from './economyStore'
import { ensureRealDistrict, realData, roadAt } from '.'
import { heightAt, type RealDistrict, type Ring } from './data'
import { hash, HOUSE_WALLS, COMMERCIAL_WALLS, ROOFS, GROUND } from './palette'

// ---------------------------------------------------------------------------------------------- ground
const ROAD_STYLE: Record<string, { fill: string; edge?: string; line?: string; order: number }> = {
  motorway: { fill: '#55565E', edge: '#E9E2CF', line: '#F2C14E', order: 6 },
  trunk: { fill: '#56575F', edge: '#E9E2CF', line: '#F2C14E', order: 6 },
  primary: { fill: '#5A5B63', edge: '#E9E2CF', line: '#F2C14E', order: 5 },
  secondary: { fill: '#5C5D65', edge: '#E9E2CF', line: '#F2C14E', order: 5 },
  tertiary: { fill: '#5F6068', line: '#F2C14E', order: 4 },
  residential: { fill: '#64656C', order: 3 },
  unclassified: { fill: '#64656C', order: 3 },
  living_street: { fill: '#6A6A70', order: 3 },
  service: { fill: '#6C6D72', order: 2 },
  footway: { fill: '#CFC6B2', order: 1 },
  path: { fill: '#C9B98F', order: 1 },
  pedestrian: { fill: '#D4CBB8', order: 1 },
  cycleway: { fill: '#B98E7A', order: 1 },
  steps: { fill: '#CFC6B2', order: 1 },
}
const LANDUSE_FILL: Record<string, string> = {
  park: GROUND.park, grass: GROUND.lawn, sports: GROUND.sports, cemetery: GROUND.cemetery, golf: GROUND.golf,
  school: GROUND.school, parking: GROUND.parking, wood: GROUND.wood, wetland: GROUND.wetland, farmland: GROUND.farm, sand: GROUND.sand,
}

function paintGround(d: RealDistrict, px: number) {
  const size = (d.terrain.n - 1) * d.terrain.cell
  const o = d.terrain.origin
  const k = px / size
  const cv = document.createElement('canvas')
  cv.width = cv.height = px
  const g = cv.getContext('2d')!
  const X = (x: number) => (x - o) * k
  const path = (r: Ring) => {
    r.forEach(([x, z], i) => (i ? g.lineTo(X(x), X(z)) : g.moveTo(X(x), X(z))))
    g.closePath()
  }
  // base lawn with a soft mottling
  g.fillStyle = GROUND.lawn
  g.fillRect(0, 0, px, px)
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = i % 2 ? 'rgba(255,255,230,0.05)' : 'rgba(30,60,20,0.05)'
    const r = 4 + ((i * 7919) % 23)
    g.beginPath()
    g.arc((i * 104729) % px, (i * 1299709) % px, r, 0, Math.PI * 2)
    g.fill()
  }
  for (const l of [...d.landuse].sort((a, b) => (a.cls === 'parking' ? 1 : 0) - (b.cls === 'parking' ? 1 : 0))) {
    g.beginPath()
    path(l.outer)
    l.holes.forEach(path)
    g.fillStyle = LANDUSE_FILL[l.cls] ?? GROUND.lawn
    g.fill('evenodd')
  }
  // water edge (the lake mesh sits on top; this is the muddy shore below it)
  for (const w of d.water) {
    g.beginPath()
    path(w.outer)
    w.holes.forEach(path)
    g.fillStyle = GROUND.shore
    g.fill('evenodd')
  }
  const roads = [...d.roads].sort((a, b) => (ROAD_STYLE[a.cls]?.order ?? 0) - (ROAD_STYLE[b.cls]?.order ?? 0))
  const stroke = (r: Ring) => {
    g.beginPath()
    r.forEach(([x, z], i) => (i ? g.lineTo(X(x), X(z)) : g.moveTo(X(x), X(z))))
  }
  g.lineJoin = g.lineCap = 'round'
  // pavements first (a pale band either side of every car road), then the asphalt over them
  for (const r of roads) {
    const s = ROAD_STYLE[r.cls]
    if (!s || s.order < 3) continue
    stroke(r.pts)
    g.strokeStyle = GROUND.pavement
    g.lineWidth = (r.width + 3.4) * k
    g.stroke()
  }
  for (const r of roads) {
    const s = ROAD_STYLE[r.cls] ?? ROAD_STYLE.service
    stroke(r.pts)
    g.strokeStyle = s.fill
    g.lineWidth = Math.max(1.2, r.width) * k
    g.stroke()
  }
  // painted lines: edge lines and a dashed / double centre line on the bigger roads
  for (const r of roads) {
    const s = ROAD_STYLE[r.cls]
    if (!s?.line) continue
    stroke(r.pts)
    g.strokeStyle = s.line
    g.lineWidth = Math.max(1, 0.15 * k)
    if (s.order >= 5) g.setLineDash([])
    else g.setLineDash([3 * k, 4 * k])
    g.stroke()
    g.setLineDash([])
  }
  // street names painted along the road, map style, every ~120 m
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const seen = new Map<string, [number, number][]>()
  for (const r of roads) {
    if (!r.name || (ROAD_STYLE[r.cls]?.order ?? 0) < 3 || r.pts.length < 2) continue
    let run = 0
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i]
      const [bx, bz] = r.pts[i + 1]
      run += Math.hypot(bx - ax, bz - az)
      if (run < 45) continue
      const mx = (ax + bx) / 2
      const mz = (az + bz) / 2
      const near = seen.get(r.name) ?? []
      if (near.some(([x, z]) => Math.hypot(x - mx, z - mz) < 120)) continue
      near.push([mx, mz])
      seen.set(r.name, near)
      run = 0
      let a = Math.atan2(bz - az, bx - ax)
      if (a > Math.PI / 2) a -= Math.PI
      if (a < -Math.PI / 2) a += Math.PI
      g.save()
      g.translate(X(mx), X(mz))
      g.rotate(a)
      g.font = `italic 800 ${Math.max(9, Math.min(r.width * 0.55, 4.2) * k)}px "Barlow Condensed", sans-serif`
      g.fillStyle = 'rgba(255,248,232,0.92)'
      g.fillText(r.name.toUpperCase(), 0, 0)
      g.restore()
    }
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function Terrain({ d }: { d: RealDistrict }) {
  const level = useQuality((s) => s.level)
  const px = level <= 1 ? 2048 : 4096
  const { geo, mat } = useMemo(() => {
    const { n, cell, origin, h } = d.terrain
    const size = (n - 1) * cell
    const geo = new THREE.PlaneGeometry(size, size, n - 1, n - 1)
    geo.rotateX(-Math.PI / 2)
    geo.translate(origin + size / 2, 0, origin + size / 2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    // PlaneGeometry rotated: vertex (i, j) runs west→east, north→south — the same order as the grid
    for (let v = 0; v < pos.count; v++) pos.setY(v, h[v])
    geo.computeVertexNormals()
    const mat = new THREE.MeshStandardMaterial({ map: paintGround(d, px), roughness: 0.95 })
    return { geo, mat }
  }, [d, px])
  useEffect(() => () => (geo.dispose(), mat.map?.dispose(), mat.dispose()), [geo, mat])
  return <mesh geometry={geo} material={mat} receiveShadow />
}

// ----------------------------------------------------------------------------------------------- water
function Water({ d }: { d: RealDistrict }) {
  const geo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = []
    for (const w of d.water) {
      const shape = new THREE.Shape(w.outer.map(([x, z]) => new THREE.Vector2(x, -z)))
      shape.holes = w.holes.map((hl) => new THREE.Path(hl.map(([x, z]) => new THREE.Vector2(x, -z))))
      const g = new THREE.ShapeGeometry(shape)
      g.rotateX(-Math.PI / 2)
      g.translate(0, w.level - 0.25, 0)
      parts.push(g)
    }
    return parts.length ? mergeGeos(parts) : null
  }, [d])
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3F7FA6', roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.92 }), [])
  useFrame(({ clock }) => {
    mat.color.setHSL(0.56, 0.42, 0.42 + Math.sin(clock.elapsedTime * 0.4) * 0.015)
  })
  if (!geo) return null
  return <mesh geometry={geo} material={mat} receiveShadow />
}

// ------------------------------------------------------------------------------------------- buildings
type Built = { walls: THREE.BufferGeometry; roofs: THREE.BufferGeometry; wallColor: Float32Array; wallEcon: Float32Array; roofColor: Float32Array; roofEcon: Float32Array }

const COMMERCIAL = new Set(['commercial', 'retail', 'office', 'industrial', 'supermarket', 'warehouse', 'school', 'university', 'hospital', 'church', 'civic', 'public', 'apartments', 'hotel'])

function buildBuildings(d: RealDistrict): Built {
  const wp: number[] = []
  const wuv: number[] = []
  const wc: number[] = []
  const we: number[] = []
  const rp: number[] = []
  const rc: number[] = []
  const re: number[] = []
  const tmp = new THREE.Color()
  const grey = new THREE.Color('#B9B5AC')
  for (const b of d.buildings) {
    const big = COMMERCIAL.has(b.type) || b.category >= 0 || b.height > 9
    const seed = hash(b.cx * 31 + b.cz * 17)
    const wall = new THREE.Color(big ? COMMERCIAL_WALLS[seed % COMMERCIAL_WALLS.length] : HOUSE_WALLS[seed % HOUSE_WALLS.length])
    const roof = new THREE.Color(ROOFS[(seed >> 3) % ROOFS.length])
    const cat = b.category >= 0 ? (CITY_CATS[b.category] as BusinessCategory) : null
    const econ = cat ? new THREE.Color(CATEGORY_COLOR[cat]) : grey
    const y0 = b.base - 0.6
    const top = b.base + (b.gable ? Math.max(2.8, b.height * 0.62) : b.height)
    const ring = b.ring
    // walls
    let run = 0
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i]
      const [bx, bz] = ring[(i + 1) % ring.length]
      const len = Math.hypot(bx - ax, bz - az)
      const u0 = run / 3.2
      const u1 = (run + len) / 3.2
      run += len
      const v1 = (top - y0) / 3.0
      // two triangles, outward-facing whatever the ring's winding (DoubleSide would cost fill rate)
      wp.push(ax, y0, az, bx, y0, bz, bx, top, bz, ax, y0, az, bx, top, bz, ax, top, az)
      wuv.push(u0, 0, u1, 0, u1, v1, u0, 0, u1, v1, u0, v1)
      for (let k = 0; k < 6; k++) (wc.push(wall.r, wall.g, wall.b), we.push(econ.r, econ.g, econ.b))
    }
    // roof
    if (b.gable) {
      const ux = Math.cos(b.ridge)
      const uz = Math.sin(b.ridge)
      let a0 = Infinity, a1 = -Infinity, c0 = Infinity, c1 = -Infinity
      for (const [x, z] of ring) {
        const a = x * ux + z * uz
        const c = -x * uz + z * ux
        a0 = Math.min(a0, a); a1 = Math.max(a1, a); c0 = Math.min(c0, c); c1 = Math.max(c1, c)
      }
      const ov = 0.35
      a0 -= ov; a1 += ov; c0 -= ov; c1 += ov
      const rise = Math.min(4.5, Math.max(1.6, (c1 - c0) * 0.36))
      const cm = (c0 + c1) / 2
      const P = (a: number, c: number, y: number) => [a * ux - c * uz, y, a * uz + c * ux]
      const e00 = P(a0, c0, top), e10 = P(a1, c0, top), e01 = P(a0, c1, top), e11 = P(a1, c1, top)
      const r0 = P(a0, cm, top + rise), r1 = P(a1, cm, top + rise)
      const tri = (...v: number[][]) => v.forEach((p) => rp.push(...p))
      tri(e00, e10, r1, e00, r1, r0) // slope one
      tri(e11, e01, r0, e11, r0, r1) // slope two
      tri(e00, r0, e01) // gable ends
      tri(e10, e11, r1)
      // gable-end walls in the wall colour would need UVs; paint them roof colour (reads as trim)
      for (let k = 0; k < 18; k++) (rc.push(roof.r, roof.g, roof.b), re.push(econ.r, econ.g, econ.b))
      // a lighter band where the eaves meet the wall
    } else {
      const contour = ring.map(([x, z]) => new THREE.Vector2(x, z))
      const tris = THREE.ShapeUtils.triangulateShape(contour, [])
      const flat = tmp.copy(roof).lerp(new THREE.Color('#8E8A84'), 0.6)
      for (const t of tris) {
        for (const idx of t) {
          const [x, z] = ring[idx]
          rp.push(x, top + 0.02, z)
          rc.push(flat.r, flat.g, flat.b)
          re.push(econ.r, econ.g, econ.b)
        }
      }
    }
  }
  const walls = new THREE.BufferGeometry()
  walls.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3))
  walls.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2))
  const wallColor = new Float32Array(wc)
  walls.setAttribute('color', new THREE.BufferAttribute(wallColor.slice(), 3))
  walls.computeVertexNormals()
  const roofs = new THREE.BufferGeometry()
  roofs.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3))
  const roofColor = new Float32Array(rc)
  roofs.setAttribute('color', new THREE.BufferAttribute(roofColor.slice(), 3))
  roofs.computeVertexNormals()
  return { walls, roofs, wallColor, wallEcon: new Float32Array(we), roofColor, roofEcon: new Float32Array(re) }
}

const CITY_CATS = ['food', 'retail', 'services', 'health', 'auto', 'trades', 'finance', 'fitness', 'lodging', 'offices', 'civic']

function windowTexture() {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 64
  const g = cv.getContext('2d')!
  g.fillStyle = '#FFFFFF'
  g.fillRect(0, 0, 64, 64)
  // clapboard lines
  g.fillStyle = 'rgba(0,0,0,0.06)'
  for (let y = 0; y < 64; y += 5) g.fillRect(0, y, 64, 1)
  // one window per 3.2 m × 3 m cell, with white trim
  g.fillStyle = '#F7F3EA'
  g.fillRect(19, 15, 26, 30)
  g.fillStyle = '#4A5868'
  g.fillRect(22, 18, 20, 24)
  g.fillStyle = '#F7F3EA'
  g.fillRect(31, 18, 2, 24)
  g.fillRect(22, 29, 20, 2)
  const t = new THREE.CanvasTexture(cv)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function Buildings({ d }: { d: RealDistrict }) {
  const econ = useEconomy((s) => s.on)
  const built = useMemo(() => buildBuildings(d), [d])
  const mats = useMemo(() => {
    const walls = new THREE.MeshStandardMaterial({ map: windowTexture(), vertexColors: true, roughness: 0.85 })
    applyGroundGrade(walls)
    const roofs = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide })
    return { walls, roofs }
  }, [])
  useEffect(() => {
    const wc = built.walls.attributes.color as THREE.BufferAttribute
    ;(wc.array as Float32Array).set(econ ? built.wallEcon : built.wallColor)
    wc.needsUpdate = true
    const rc = built.roofs.attributes.color as THREE.BufferAttribute
    ;(rc.array as Float32Array).set(econ ? built.roofEcon : built.roofColor)
    rc.needsUpdate = true
  }, [econ, built])
  useEffect(() => () => (built.walls.dispose(), built.roofs.dispose()), [built])
  return (
    <>
      <mesh geometry={built.walls} material={mats.walls} castShadow receiveShadow />
      <mesh geometry={built.roofs} material={mats.roofs} castShadow receiveShadow />
    </>
  )
}

// ----------------------------------------------------------------------------------------------- trees
function treeSpots(d: RealDistrict): Ring {
  const out: Ring = [...d.trees]
  // decorative street trees along residential streets (not mapped on OSM — marked as such in the README)
  const def = getDistrict(d.id)
  for (const r of d.roads) {
    if (!['residential', 'tertiary', 'secondary', 'unclassified', 'living_street'].includes(r.cls)) continue
    let acc = hash(r.pts[0][0] * 13 + r.pts[0][1]) % 17
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i]
      const [bx, bz] = r.pts[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      acc += len
      if (acc < 19) continue
      acc = 0
      const nx = -(bz - az) / (len || 1)
      const nz = (bx - ax) / (len || 1)
      const side = hash(ax * 7 + az * 3) % 2 ? 1 : -1
      const off = r.width / 2 + 2.6
      const x = ax + nx * off * side
      const z = az + nz * off * side
      if (Math.abs(x) > d.half + 30 || Math.abs(z) > d.half + 30) continue
      if (roadAt(d.id, x, z, 0.6)) continue
      if (Math.hypot(x - def.portal.x, z - def.portal.z) < 7) continue
      if (def.colliders.some((c) => x > c.min[0] - 2 && x < c.max[0] + 2 && z > c.min[2] - 2 && z < c.max[2] + 2)) continue
      out.push([x, z])
    }
  }
  return out
}

function Trees({ d }: { d: RealDistrict }) {
  const level = useQuality((s) => s.level)
  const spots = useMemo(() => {
    const all = treeSpots(d)
    const cap = level <= 0 ? 900 : level === 1 ? 1800 : 3200
    return all.length > cap ? all.filter((_, i) => i % Math.ceil(all.length / cap) === 0) : all
  }, [d, level])
  const { canopy, trunk, cMat, tMat } = useMemo(() => {
    const canopy = new THREE.IcosahedronGeometry(1, 1)
    canopy.translate(0, 1.0, 0)
    const trunk = new THREE.CylinderGeometry(0.16, 0.22, 1, 6)
    trunk.translate(0, 0.5, 0)
    const cMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true })
    const tMat = new THREE.MeshStandardMaterial({ color: '#6B4F3A', roughness: 0.9 })
    return { canopy, trunk, cMat, tMat }
  }, [])
  const refs = useMemo(() => ({ c: null as THREE.InstancedMesh | null, t: null as THREE.InstancedMesh | null }), [])
  useEffect(() => {
    const { c, t } = refs
    if (!c || !t) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const col = new THREE.Color()
    const greens = ['#5E8C3A', '#6E9A40', '#4F7D34', '#7DA548', '#8A9A3A', '#C9772E', '#B5502E']
    spots.forEach(([x, z], i) => {
      const s = hash(x * 91 + z * 37)
      const y = heightAt(d.terrain, x, z)
      const hgt = 3 + (s % 5) * 0.7
      const r = 1.8 + (s % 7) * 0.25
      // autumn: a few maples turn in October and November
      const month = new Date().getMonth()
      const autumn = month === 9 || month === 10
      col.set(greens[autumn ? s % greens.length : s % 5])
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (s % 628) / 100)
      m.compose(new THREE.Vector3(x, y + hgt * 0.55, z), q, new THREE.Vector3(r, r * 1.15, r))
      c.setMatrixAt(i, m)
      c.setColorAt(i, col)
      m.compose(new THREE.Vector3(x, y - 0.2, z), q, new THREE.Vector3(1, hgt * 0.75, 1))
      t.setMatrixAt(i, m)
    })
    c.count = t.count = spots.length
    c.instanceMatrix.needsUpdate = t.instanceMatrix.needsUpdate = true
    if (c.instanceColor) c.instanceColor.needsUpdate = true
    c.computeBoundingSphere()
    t.computeBoundingSphere()
  }, [spots, d, refs])
  return (
    <>
      <instancedMesh ref={(r) => void (refs.c = r)} args={[canopy, cMat, Math.max(1, spots.length)]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={(r) => void (refs.t = r)} args={[trunk, tMat, Math.max(1, spots.length)]} castShadow frustumCulled={false} />
    </>
  )
}

// -------------------------------------------------------------------------------------- business signs
function signTexture(b: Business) {
  const cv = document.createElement('canvas')
  cv.width = 512
  cv.height = 160
  const g = cv.getContext('2d')!
  const col = CATEGORY_COLOR[b.category]
  g.fillStyle = '#FBF6EC'
  g.fillRect(0, 0, 512, 160)
  g.fillStyle = col
  g.fillRect(0, 0, 512, 30)
  g.fillRect(0, 150, 512, 10)
  g.fillStyle = '#1C1F2B'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const name = (b.name ?? 'Business').toUpperCase()
  let fs = 70
  g.font = `italic 800 ${fs}px "Barlow Condensed", sans-serif`
  while (g.measureText(name).width > 480 && fs > 28) g.font = `italic 800 ${(fs -= 4)}px "Barlow Condensed", sans-serif`
  g.fillText(name, 256, 92)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export type SignPlace = { b: Business; x: number; z: number; face: number }

/** Where a business's sign stands: on the pavement between it and the nearest street, facing the street. */
export function signPlaces(d: RealDistrict): SignPlace[] {
  const out: SignPlace[] = []
  for (const b of businessesIn(d.id)) {
    if (!b.pos || !b.name) continue
    const [px, pz] = b.pos
    const r = roadAt(d.id, px, pz, 60)
    if (!r) {
      out.push({ b, x: px, z: pz, face: 0 })
      continue
    }
    // nearest point on that segment
    const dx = r.bx - r.ax
    const dz = r.bz - r.az
    const l2 = dx * dx + dz * dz || 1
    const t = Math.max(0, Math.min(1, ((px - r.ax) * dx + (pz - r.az) * dz) / l2))
    const qx = r.ax + dx * t
    const qz = r.az + dz * t
    const vx = px - qx
    const vz = pz - qz
    const vl = Math.hypot(vx, vz) || 1
    const off = Math.min(vl, r.w / 2 + 1.6)
    out.push({ b, x: qx + (vx / vl) * off, z: qz + (vz / vl) * off, face: Math.atan2(-vx, -vz) })
  }
  return out
}

function Signs({ d }: { d: RealDistrict }) {
  const econ = useEconomy((s) => s.on)
  const places = useMemo(() => signPlaces(d), [d])
  const post = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2B2E38', roughness: 0.6 }), [])
  const postGeo = useMemo(() => new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6).translate(0, 1.3, 0), [])
  const boardGeo = useMemo(() => new THREE.BoxGeometry(2.4, 0.75, 0.08), [])
  const beaconGeo = useMemo(() => new THREE.CylinderGeometry(0.5, 0.5, 30, 10, 1, true).translate(0, 15, 0), [])
  const boards = useMemo(
    () => places.map((p) => [new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 }), new THREE.MeshStandardMaterial({ map: signTexture(p.b), roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0.08 })] as const),
    [places],
  )
  useEffect(() => () => boards.forEach(([a, b]) => (a.dispose(), b.map?.dispose(), b.dispose())), [boards])
  return (
    <>
      {places.map((p, i) => {
        const y = heightAt(d.terrain, p.x, p.z)
        const faceMats = [boards[i][0], boards[i][0], boards[i][0], boards[i][0], boards[i][1], boards[i][1]]
        return (
          <group key={p.b.id} position={[p.x, y, p.z]} rotation={[0, p.face, 0]}>
            <mesh geometry={postGeo} material={post} position={[-1.05, 0, 0]} castShadow />
            <mesh geometry={postGeo} material={post} position={[1.05, 0, 0]} castShadow />
            <mesh geometry={boardGeo} material={faceMats} position={[0, 2.25, 0]} castShadow />
            {econ && (
              <mesh geometry={beaconGeo}>
                <meshBasicMaterial color={CATEGORY_COLOR[p.b.category]} transparent opacity={0.35} depthWrite={false} toneMapped={false} />
              </mesh>
            )}
          </group>
        )
      })}
    </>
  )
}

// ------------------------------------------------------------------------------------------------ root
function mergeGeos(parts: THREE.BufferGeometry[]) {
  const pos: number[] = []
  for (const g of parts) {
    const ng = g.index ? g.toNonIndexed() : g
    pos.push(...(ng.attributes.position.array as Float32Array))
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.computeVertexNormals()
  return out
}

/** The whole district. Mounted only while it's the active one (DistrictWorld). */
export function RealWorld({ id }: { id: string }) {
  const [d, setD] = useState<RealDistrict | null>(() => realData(id) ?? null)
  useEffect(() => {
    let live = true
    ensureRealDistrict(id).then((x) => live && setD(x))
    return () => void (live = false)
  }, [id])
  const def = getDistrict(id)
  if (!d) return null
  const py = heightAt(d.terrain, def.portal.x, def.portal.z)
  return (
    <group name={`district-${id}`}>
      <Terrain d={d} />
      <Water d={d} />
      <Buildings d={d} />
      <Trees d={d} />
      <Signs d={d} />
      <group position={[0, py, 0]}>
        <Portal pose={def.portal} />
      </group>
    </group>
  )
}
